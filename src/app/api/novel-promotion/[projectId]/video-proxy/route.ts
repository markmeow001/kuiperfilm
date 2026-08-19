import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest } from 'next/server'
import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
    fetchPublicResource,
    SsrfSafeFetchError,
} from '@/lib/http/ssrf-safe-fetch'
import { isNovelPromotionVideoReferenceInProject } from '@/lib/novel-promotion/project-scope'

const VIDEO_PROXY_TIMEOUT_MS = 120_000
const VIDEO_PROXY_MAX_BYTES = 256 * 1024 * 1024
const VIDEO_PROXY_CONTENT_TYPES = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
    'application/octet-stream',
] as const

/**
 * 代理下载单个视频文件
 * 用于解决 COS 跨域下载问题
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const { searchParams } = new URL(request.url)
    const videoKey = searchParams.get('key')
    // Optional caller-supplied filename. Falls back to a sane default
    // when omitted so the browser still saves the file as .mp4 instead
    // of "video-proxy" (the route segment) or "video-proxy.html".
    const callerFilename = searchParams.get('filename')

    if (!videoKey || videoKey.length > 8192) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
    if (isErrorResponse(authResult)) return authResult

    // A key/URL is not authorization. It must exactly match a panel video or
    // persisted multi-shot output inside this project before we sign or fetch.
    if (!await isNovelPromotionVideoReferenceInProject(projectId, videoKey)) {
        throw new ApiError('NOT_FOUND')
    }

    // 生成签名 URL 并下载
    const callerSuppliedUrl = videoKey.startsWith('http://') || videoKey.startsWith('https://')
    let fetchUrl: string
    if (callerSuppliedUrl) {
        fetchUrl = videoKey
    } else {
        fetchUrl = toFetchableUrl(getSignedUrl(videoKey, 3600))
    }

    let generatedStorageOrigin: string | null = null
    if (!callerSuppliedUrl) {
        try {
            generatedStorageOrigin = new URL(fetchUrl).origin
        } catch {
            throw new ApiError('INVALID_PARAMS')
        }
    }

    let response: Response
    try {
        response = await fetchPublicResource(fetchUrl, {
            timeoutMs: VIDEO_PROXY_TIMEOUT_MS,
            maxResponseBytes: VIDEO_PROXY_MAX_BYTES,
            allowedContentTypes: VIDEO_PROXY_CONTENT_TYPES,
            ...(generatedStorageOrigin
                ? { trustedInternalOrigins: [generatedStorageOrigin] }
                : {}),
        })
    } catch (error) {
        if (error instanceof SsrfSafeFetchError) {
            const invalidRequest = new Set([
                'INVALID_URL',
                'UNSUPPORTED_PROTOCOL',
                'BLOCKED_HOST',
                'BLOCKED_ADDRESS',
                'TOO_MANY_REDIRECTS',
                'INVALID_REDIRECT',
                'UNSUPPORTED_CONTENT_TYPE',
                'INVALID_CONTENT_LENGTH',
                'RESPONSE_TOO_LARGE',
            ]).has(error.code)
            throw new ApiError(invalidRequest ? 'INVALID_PARAMS' : 'NETWORK_ERROR', {
                reason: error.code,
            })
        }
        throw error
    }
    if (!response.ok) {
        void response.body?.cancel().catch(() => undefined)
        throw new Error(`Failed to fetch video: ${response.statusText}`)
    }

    _ulogInfo(`[视频代理] 安全下载已建立: ${new URL(fetchUrl).hostname}`)

    // 获取内容类型和长度
    const contentType = response.headers.get('content-type')!
    const contentLength = response.headers.get('content-length')

    // Sanitize filename to ASCII-safe + always end with `.mp4` so the
    // browser saves it as a real video file regardless of how it
    // arrived. Strip path separators / control chars / quotes that
    // would corrupt the Content-Disposition header.
    const safeFilenameBase = (() => {
        const fallback = `video-${(videoKey.split('/').pop() || 'multi-shot').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60)}`
        const raw = (callerFilename || '').trim()
        if (!raw) return fallback
        const cleaned = raw
            .replace(/\.mp4$/i, '')
            .replace(/[\\\/\r\n\t"'<>]/g, '_')
            .replace(/[^一-鿿A-Za-z0-9._\- ]+/g, '_')
            .trim()
        return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback
    })()
    const downloadFilename = `${safeFilenameBase}.mp4`

    // 流式返回视频数据 — Content-Disposition: attachment so the
    // browser triggers a download dialog instead of inline playback,
    // and `filename*=UTF-8''<encoded>` so non-ASCII names (Chinese
    // episode names) round-trip correctly. Browsers that don't grok
    // the RFC 5987 form fall back to the bare `filename=` token.
    const headers: HeadersInit = {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${downloadFilename}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`,
    }
    if (contentLength) {
        headers['Content-Length'] = contentLength
    }

    return new Response(response.body, { headers })
})

/**
 * Same-origin image proxy for canvas WebGL textures (导演台 全景/平面背景).
 *
 * COS/R2 signed URLs don't return CORS headers, so a browser THREE.TextureLoader
 * (crossOrigin='anonymous') fails to load them — and even if it didn't, a
 * cross-origin texture taints the WebGL canvas so the screenshot toDataURL()
 * throws. Loading the image through THIS same-origin endpoint avoids both: no
 * CORS needed, and the capture stays untainted.
 *
 * GET /api/canvas/asset?key=<cosKey>
 *   - auth required
 *   - the key MUST belong to the caller (own /playground-ref/<userId>/ namespace)
 *   - server fetches the object (server→COS has no CORS) and streams it back
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { logError as _ulogError } from '@/lib/logging/core'
import { getSignedUrl, contentTypeForKey } from '@/lib/cos'
import { isSafeReference } from '@/lib/playground/reference-guard'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const key = new URL(request.url).searchParams.get('key') ?? ''
  // Reuse the reference guard: a bare COS key must be in the caller's namespace.
  // (Blocks proxying another user's object — IDOR.)
  if (!key || !isSafeReference(key, userId) || /^https?:\/\//.test(key)) {
    throw new ApiError('FORBIDDEN', { code: 'ASSET_NOT_ALLOWED' })
  }

  const signed = getSignedUrl(key, 600)
  // Bound the proxy: an abort timeout so a slow/hung COS fetch can't pin a
  // worker thread, and a size cap so an oversized object can't balloon memory.
  const MAX_BYTES = 15 * 1024 * 1024
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15_000)
  let upstream: Response
  try {
    upstream = await fetch(signed, { signal: ac.signal })
  } catch (err) {
    _ulogError(`[canvas.asset] upstream fetch failed key=${key} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INTERNAL_ERROR', { code: 'ASSET_FETCH_FAILED' })
  } finally {
    clearTimeout(timer)
  }
  if (!upstream.ok) {
    _ulogError(`[canvas.asset] upstream ${upstream.status} key=${key}`)
    throw new ApiError('NOT_FOUND', { code: 'ASSET_NOT_FOUND' })
  }

  // Only serve images — never reflect an error page verbatim. R2/COS 上的
  // 舊物件(2026-07-08 ContentType 修復前上傳的)一律回 octet-stream,
  // 不能只信上游 header:上游型別不合法時退回用 key 副檔名推斷,推得出
  // 合法圖片型別才放行。否則導演台的既有背景圖全被這裡 403 擋死。
  const upstreamType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const inferredType = contentTypeForKey(key)
  const contentType = ALLOWED_TYPES.includes(upstreamType)
    ? upstreamType
    : ALLOWED_TYPES.includes(inferredType)
      ? inferredType
      : null
  if (!contentType) {
    _ulogError(`[canvas.asset] rejected content-type upstream="${upstreamType}" inferred="${inferredType}" key=${key}`)
    throw new ApiError('FORBIDDEN', { code: 'ASSET_NOT_IMAGE' })
  }
  // Reject early when the upstream advertises an oversized body.
  const declaredLen = Number(upstream.headers.get('content-length') ?? 0)
  if (declaredLen > MAX_BYTES) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASSET_TOO_LARGE' })
  }

  const buf = Buffer.from(await upstream.arrayBuffer())
  // Guard against a missing/lying content-length (chunked responses).
  if (buf.length > MAX_BYTES) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASSET_TOO_LARGE' })
  }
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=600',
    },
  })
})

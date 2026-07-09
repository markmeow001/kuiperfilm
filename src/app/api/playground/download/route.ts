/**
 * GET /api/playground/download?url=<https storage URL | own key>&filename=<name>
 *
 * Same-origin download proxy for playground results. Result media lives on
 * R2/COS (a different origin), so a client `<a download>` is ignored by the
 * browser and the file just opens in a new tab instead of saving. This route
 * fetches the object server-side and re-streams it with
 * `Content-Disposition: attachment`, forcing a real "save to disk" regardless
 * of the storage origin's CORS.
 *
 * SSRF / cross-user guarded with the shared reference guard (isSafeReference):
 * only the caller's own storage key or an https (non-internal) storage URL is
 * fetchable — same rule as the /api/playground/run reference boundary.
 */

import { NextRequest } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isSafeReference } from '@/lib/playground/reference-guard'
import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const rawUrl = (searchParams.get('url') || '').trim()
  const callerFilename = searchParams.get('filename')
  if (!rawUrl) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'URL_REQUIRED',
      details: { message: 'url is required' },
    })
  }

  // SSRF / cross-user guard — identical rule to the run reference boundary:
  // own key, own https signed URL, or a relative local-storage files path.
  if (!isSafeReference(rawUrl, userId)) {
    throw new ApiError('FORBIDDEN', {
      code: 'DOWNLOAD_NOT_ALLOWED',
      details: { message: 'download source must be your own key or an https storage URL' },
    })
  }

  // Resolve to a fetchable URL: https → as-is; relative local path → absolute
  // against this origin; bare COS key → signed.
  const fetchUrl = /^https?:\/\//.test(rawUrl)
    ? rawUrl
    : rawUrl.startsWith('/')
      ? new URL(rawUrl, request.url).toString()
      : toFetchableUrl(getSignedUrl(rawUrl, 3600))

  const upstream = await fetch(fetchUrl)
  if (!upstream.ok || !upstream.body) {
    // Fail explicitly (CLAUDE.md §3 不静默吞错) rather than return an empty file.
    throw new Error(`playground download: upstream fetch failed ${upstream.status} ${upstream.statusText}`)
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
  const contentLength = upstream.headers.get('content-length')

  // Extension from URL first (authoritative), else from content-type, so the
  // saved file opens in the right app.
  const extFromUrl = (rawUrl.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase()
  const extFromType = (contentType.split(';')[0].split('/')[1] || '').toLowerCase().replace('jpeg', 'jpg')
  const ext = (extFromUrl || extFromType || 'bin').replace(/[^a-z0-9]/g, '') || 'bin'

  // Sanitize caller filename to ASCII/CJK-safe; append the resolved extension.
  const base = (() => {
    const fallback = 'kuiperai'
    const raw = (callerFilename || '').trim()
    if (!raw) return fallback
    const cleaned = raw
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[\\/\r\n\t"'<>]/g, '_')
      .replace(/[^一-鿿A-Za-z0-9._\- ]+/g, '_')
      .trim()
    return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback
  })()
  const filename = `${base}.${ext}`

  const headers: HeadersInit = {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  }
  if (contentLength) headers['Content-Length'] = contentLength

  _ulogInfo(`[playground.download] userId=${userId} ct=${contentType} file=${filename}`)
  return new Response(upstream.body, { status: 200, headers })
})

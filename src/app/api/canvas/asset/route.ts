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
import { getSignedUrl } from '@/lib/cos'
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
  let upstream: Response
  try {
    upstream = await fetch(signed)
  } catch (err) {
    _ulogError(`[canvas.asset] upstream fetch failed key=${key} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INTERNAL_ERROR', { code: 'ASSET_FETCH_FAILED' })
  }
  if (!upstream.ok) {
    _ulogError(`[canvas.asset] upstream ${upstream.status} key=${key}`)
    throw new ApiError('NOT_FOUND', { code: 'ASSET_NOT_FOUND' })
  }

  const buf = await upstream.arrayBuffer()
  const contentType = upstream.headers.get('content-type') ?? 'image/png'
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=600',
    },
  })
})

/**
 * Use a canvas image node's generated result (e.g. a 720全景图) as a 导演台
 * background. (2026-06-29)
 *
 * The run-result COS key lives in `images/playground-runs/<taskId>/…` — NOT the
 * caller's `/playground-ref/<userId>/` namespace, so it can't pass the canvas
 * asset proxy / reference guard, and the client only holds a signed URL anyway.
 * This endpoint takes the runId, verifies the caller owns that task, and copies
 * the result into the caller's own ref namespace server-side (no CORS) → returns
 * a durable key + signed URL the 全景球 can load via /api/canvas/asset.
 *
 * POST /api/canvas/use-as-background { runId } → { key, url }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { logError as _ulogError } from '@/lib/logging/core'
import { getSignedUrl, uploadToCOS, generateUniqueKey } from '@/lib/cos'

const PLAYGROUND_PROJECT_ID = 'playground'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  let body: { runId?: unknown }
  try {
    body = (await request.json()) as { runId?: unknown }
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_JSON_BODY' })
  }
  const runId = typeof body.runId === 'string' ? body.runId : ''
  if (!runId) throw new ApiError('INVALID_PARAMS', { code: 'RUN_ID_REQUIRED' })

  const task = await prisma.task.findUnique({ where: { id: runId } })
  if (!task || task.projectId !== PLAYGROUND_PROJECT_ID || task.userId !== userId) {
    throw new ApiError('NOT_FOUND', { code: 'RUN_NOT_FOUND' })
  }
  if (task.status !== 'completed') {
    throw new ApiError('INVALID_PARAMS', { code: 'RUN_NOT_READY' })
  }

  const result = (task.result && typeof task.result === 'object' ? task.result : {}) as { resultUrls?: unknown }
  const urls = Array.isArray(result.resultUrls) ? result.resultUrls : []
  const resultKey = urls.find((u): u is string => typeof u === 'string' && u.length > 0 && !u.startsWith('http'))
  if (!resultKey) throw new ApiError('NOT_FOUND', { code: 'RUN_RESULT_MISSING' })

  // Copy the result into the caller's ref namespace (server-side fetch → upload,
  // no CORS, no compression so the equirect aspect is preserved).
  const newKey = generateUniqueKey(`playground-ref/${userId}/bg`)
  const MAX_BYTES = 25 * 1024 * 1024
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 60_000)
    let upstream: Response
    try {
      upstream = await fetch(getSignedUrl(resultKey, 600), { signal: ac.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
    const len = Number(upstream.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) throw new Error(`too large (${len})`)
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length})`)
    await uploadToCOS(buf, newKey)
  } catch (err) {
    _ulogError(`[canvas.use-as-background] copy failed runId=${runId} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INTERNAL_ERROR', { code: 'BACKGROUND_COPY_FAILED' })
  }

  return NextResponse.json({ key: newKey, url: getSignedUrl(newKey, 3600) })
})

/**
 * Turn a canvas image node's generated result into a durable reference the
 * caller owns — used by 角色 nodes to ingest an upstream 图片 node ("把生成图
 * 变成角色参考图"). (2026-07-13)
 *
 * Same shape as /api/canvas/use-as-background: the run-result COS key lives in
 * `images/playground-runs/<taskId>/…` (NOT the caller's `/playground-ref/…`
 * namespace), so it can't pass the reference guard when fed downstream as a
 * cast reference, and the client only holds a signed URL. This endpoint takes
 * the runId, verifies the caller owns that completed task, and copies the
 * result into the caller's own ref namespace server-side (no CORS) → returns a
 * durable key + signed URL. The only difference from use-as-background is the
 * key prefix (`ref` vs `bg`), so downstream/debugging can tell them apart.
 *
 * POST /api/canvas/use-as-reference { runId } → { key, url }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { logError as _ulogError } from '@/lib/logging/core'
import { getSignedUrl, uploadToCOS, generateUniqueKey } from '@/lib/cos'
import { pickRunResultKey } from '@/lib/canvas/run-result-key'

const PLAYGROUND_PROJECT_ID = 'playground'
const MAX_BYTES = 25 * 1024 * 1024

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

  const resultKey = pickRunResultKey(task.result)
  if (!resultKey) throw new ApiError('NOT_FOUND', { code: 'RUN_RESULT_MISSING' })

  // Copy the result into the caller's ref namespace (server-side fetch → upload,
  // no CORS). The copied key lives under `/playground-ref/<userId>/` so it later
  // passes isSafeReference when the 角色 node feeds it downstream as a cast ref.
  const newKey = generateUniqueKey(`playground-ref/${userId}/ref`)
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
    _ulogError(`[canvas.use-as-reference] copy failed runId=${runId} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INTERNAL_ERROR', { code: 'REFERENCE_COPY_FAILED' })
  }

  return NextResponse.json({ key: newKey, url: getSignedUrl(newKey, 3600) })
})

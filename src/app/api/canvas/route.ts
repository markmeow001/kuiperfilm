/**
 * 无限画布 persistence API (2026-06-27, M1.5).
 *
 * GET  /api/canvas        → the caller's latest canvas ({ canvas } | { canvas: null })
 * POST /api/canvas        → upsert the caller's canvas (body = canvasSaveSchema) → { canvas }
 *
 * Independent of NovelPromotion projects (like /api/playground). Auth-scoped to
 * the caller; an id in the body that isn't theirs → 404 (no silent re-create).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { logError as _ulogError } from '@/lib/logging/core'
import { getLatestCanvasForUser, upsertCanvasForUser } from '@/lib/canvas/canvas-repository'
import { canvasSaveSchema, MAX_CANVAS_BYTES } from '@/lib/canvas/canvas-validation'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const canvas = await getLatestCanvasForUser(session.user.id)
  return NextResponse.json({ canvas })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  let body: unknown
  try {
    body = await request.json()
  } catch (err) {
    _ulogError(`[canvas.save] invalid JSON body userId=${userId} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_JSON_BODY' })
  }

  const parsed = canvasSaveSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CANVAS_PAYLOAD_INVALID',
      details: { issues: parsed.error.issues.slice(0, 5) },
    })
  }

  // Byte-cap guard for the @db.Text column (defense beyond the count caps).
  const blobSize = JSON.stringify(parsed.data.nodes).length + JSON.stringify(parsed.data.edges).length
  if (blobSize > MAX_CANVAS_BYTES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CANVAS_TOO_LARGE',
      details: { got: blobSize, max: MAX_CANVAS_BYTES },
    })
  }

  try {
    const canvas = await upsertCanvasForUser(userId, parsed.data)
    return NextResponse.json({ canvas })
  } catch (err) {
    if (err instanceof Error && err.message === 'CANVAS_NOT_FOUND') {
      throw new ApiError('NOT_FOUND', { code: 'CANVAS_NOT_FOUND' })
    }
    throw err
  }
})

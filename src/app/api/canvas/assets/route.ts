import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireEditorAuth, requireUserAuth } from '@/lib/api-auth'
import { CANVAS_ASSET_TYPES, canvasAssetCreateSchema, type CanvasAssetType } from '@/lib/canvas/canvas-assets-contract'
import { createCanvasAsset, listCanvasAssets, resolveCanvasAssetScope } from '@/lib/canvas/canvas-assets'

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const params = new URL(request.url).searchParams
  const canvasId = params.get('canvasId') || ''
  const rawType = params.get('type')
  const type = rawType && CANVAS_ASSET_TYPES.includes(rawType as CanvasAssetType) ? rawType as CanvasAssetType : undefined
  if (!canvasId || (rawType && !type)) throw new ApiError('INVALID_PARAMS', { code: 'CANVAS_ASSET_QUERY_INVALID' })
  const scope = await resolveCanvasAssetScope(canvasId, auth.session.user.id, {
    write: false,
    // requireUserAuth intentionally does not expose a trusted DB role. Asset
    // reads stay least-privilege; admin override is only used on the editor-
    // authenticated mutation path where `role` was freshly loaded.
    isAdmin: false,
  })
  return NextResponse.json({ assets: await listCanvasAssets(scope, type) })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireEditorAuth()
  if (isErrorResponse(auth)) return auth
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_JSON_BODY' })
  }
  const parsed = canvasAssetCreateSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', { code: 'CANVAS_ASSET_PAYLOAD_INVALID', details: { issues: parsed.error.issues.slice(0, 5) } })
  }
  const scope = await resolveCanvasAssetScope(parsed.data.canvasId, auth.session.user.id, {
    write: true,
    isAdmin: auth.role === 'admin',
  })
  return NextResponse.json({ asset: await createCanvasAsset(parsed.data, auth.session.user.id, scope) })
})

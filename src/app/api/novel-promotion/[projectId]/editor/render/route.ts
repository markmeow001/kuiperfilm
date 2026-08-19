import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

function renderDisabled(): never {
  throw new ApiError('CONFLICT', {
    code: 'VIDEO_EDITOR_RENDER_DISABLED',
    message: 'Video editor render is disabled until its scoped delivery contract is rebuilt.',
  })
}

export const POST = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  return renderDisabled()
})

export const GET = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult
  return renderDisabled()
})

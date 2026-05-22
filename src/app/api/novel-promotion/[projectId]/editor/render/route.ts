import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { toSignedUrlIfCos } from '@/lib/workers/utils'

/**
 * POST /api/novel-promotion/[projectId]/editor/render
 * Start a video editor render task
 */
export const POST = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => null)
  const locale = resolveRequiredTaskLocale(request, body)
  const editorProjectId = typeof body?.editorProjectId === 'string' ? body.editorProjectId : ''

  if (!editorProjectId) {
    throw new ApiError('INVALID_PARAMS', { message: 'editorProjectId is required' })
  }

  // Verify editor project exists and is not currently rendering
  const editorProject = await prisma.videoEditorProject.findUnique({
    where: { id: editorProjectId },
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND', { message: 'Editor project not found' })
  }

  if (editorProject.renderStatus === 'pending' || editorProject.renderStatus === 'rendering') {
    return NextResponse.json({
      success: false,
      message: 'Render already in progress',
      taskId: editorProject.renderTaskId,
      status: editorProject.renderStatus,
    }, { status: 409 })
  }

  // Submit render task
  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: editorProject.episodeId,
    type: TASK_TYPE.VIDEO_EDITOR_RENDER,
    targetType: 'VideoEditorProject',
    targetId: editorProjectId,
    payload: { editorProjectId },
    dedupeKey: `video_editor_render:${editorProjectId}`,
    maxAttempts: 2,
  })

  // Update editor project with task reference
  await prisma.videoEditorProject.update({
    where: { id: editorProjectId },
    data: {
      renderStatus: 'pending',
      renderTaskId: result.taskId,
    },
  })

  return NextResponse.json({
    success: true,
    taskId: result.taskId,
    status: 'pending',
  })
})

/**
 * GET /api/novel-promotion/[projectId]/editor/render?id={editorProjectId}
 * Query render status
 */
export const GET = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await params

  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult

  const editorProjectId = request.nextUrl.searchParams.get('id')
  if (!editorProjectId) {
    throw new ApiError('INVALID_PARAMS', { message: 'id query param is required' })
  }

  const editorProject = await prisma.videoEditorProject.findUnique({
    where: { id: editorProjectId },
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND', { message: 'Editor project not found' })
  }

  // Read progress from task if available
  let progress = 0
  if (editorProject.renderTaskId) {
    const task = await prisma.task.findUnique({
      where: { id: editorProject.renderTaskId },
      select: { progress: true },
    })
    progress = task?.progress ?? 0
  }

  // Sign output URL if render is completed
  const outputUrl = editorProject.outputUrl
    ? toSignedUrlIfCos(editorProject.outputUrl, 3600)
    : null

  return NextResponse.json({
    status: editorProject.renderStatus || null,
    progress,
    outputUrl,
  })
})

import { NextRequest, NextResponse } from 'next/server'
import { uploadToCOS, generateUniqueKey, cosKeyToSignedUrl, deleteCOSObject } from '@/lib/cos'
import sharp from 'sharp'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  findNovelPromotionPanelInProject,
  NovelPromotionProjectScopeError,
  updateNovelPromotionPanelInProject,
} from '@/lib/novel-promotion/project-scope'

/**
 * POST /api/novel-promotion/[projectId]/upload-panel-image
 * Upload a user image to replace a panel's AI-generated image
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const formData = await request.formData()
  const file = formData.get('file') as File
  const panelId = formData.get('panelId') as string

  if (!file || !panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Resolve ownership before image processing or any external storage write.
  const panel = await findNovelPromotionPanelInProject(projectId, panelId)
  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  // Read and compress the image
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const processed = await sharp(buffer)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  // Generate unique key and upload
  const key = generateUniqueKey(`panel-${panelId}-upload`, 'jpg')
  await uploadToCOS(processed, key)

  const previousImageUrl = panel.imageUrl

  // Update panel with new image
  try {
    await updateNovelPromotionPanelInProject(projectId, panel.id, {
      imageUrl: key,
      previousImageUrl: previousImageUrl,
    })
  } catch (error) {
    // A project transfer/delete racing the upload must not leave a durable
    // object that no longer has an owned database row.
    await deleteCOSObject(key).catch(() => undefined)
    if (error instanceof NovelPromotionProjectScopeError) {
      throw new ApiError('NOT_FOUND')
    }
    throw error
  }

  const signedUrl = cosKeyToSignedUrl(key)

  return NextResponse.json({
    success: true,
    imageUrl: signedUrl,
    cosKey: key,
  })
})

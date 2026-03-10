import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToCOS, generateUniqueKey, cosKeyToSignedUrl } from '@/lib/cos'
import sharp from 'sharp'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

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

  // Read and compress the image
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const processed = await sharp(buffer)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  // Generate unique key and upload
  const key = generateUniqueKey(`panel-${panelId}-upload`, 'jpg')
  await uploadToCOS(processed, key)

  // Find the panel and save old imageUrl for undo
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const previousImageUrl = panel.imageUrl

  // Update panel with new image
  await prisma.novelPromotionPanel.update({
    where: { id: panelId },
    data: {
      imageUrl: key,
      previousImageUrl: previousImageUrl,
    },
  })

  const signedUrl = cosKeyToSignedUrl(key)

  return NextResponse.json({
    success: true,
    imageUrl: signedUrl,
    cosKey: key,
  })
})

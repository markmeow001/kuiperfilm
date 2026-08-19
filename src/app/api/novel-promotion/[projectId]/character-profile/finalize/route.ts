import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler, getRequestId } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

const finalizeCharacterVisualBodySchema = z.object({
  characterId: z.string().trim().min(1).max(191),
  appearanceId: z.string().trim().min(1).max(191),
}).strict()

interface ReadyAppearance {
  id: string
  imageMediaId: string | null
  imageUrl: string | null
  imageUrls: string | null
  selectedIndex: number | null
}

function nonEmpty(value: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveVisualReference(appearance: ReadyAppearance): string | null {
  const mediaId = nonEmpty(appearance.imageMediaId)
  if (mediaId) return mediaId
  const imageUrl = nonEmpty(appearance.imageUrl)
  if (imageUrl) return imageUrl
  if (!appearance.imageUrls) return null
  try {
    const parsed: unknown = JSON.parse(appearance.imageUrls)
    if (!Array.isArray(parsed)) return null
    const urls = parsed.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )
    if (urls.length === 0) return null
    const selectedIndex = appearance.selectedIndex
    if (selectedIndex !== null && Number.isInteger(selectedIndex) && selectedIndex >= 0) {
      return urls[selectedIndex] ?? null
    }
    return urls[0] ?? null
  } catch {
    return null
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  let input: z.infer<typeof finalizeCharacterVisualBodySchema>
  try {
    input = finalizeCharacterVisualBodySchema.parse(await request.json())
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      message: error instanceof Error ? error.message : 'invalid request body',
    })
  }

  const requestId = getRequestId(request)
  if (!requestId) {
    throw new ApiError('INTERNAL_ERROR', { message: 'request id is unavailable' })
  }

  const result = await prisma.$transaction(async (tx) => {
    const character = await tx.novelPromotionCharacter.findFirst({
      where: { id: input.characterId, novelPromotionProject: { projectId } },
      select: {
        id: true,
        name: true,
        profileConfirmed: true,
        appearances: {
          where: { id: input.appearanceId },
          take: 1,
          select: {
            id: true,
            imageMediaId: true,
            imageUrl: true,
            imageUrls: true,
            selectedIndex: true,
          },
        },
      },
    })
    if (!character) throw new ApiError('NOT_FOUND', { message: 'character not found' })

    const appearance = character.appearances[0] as ReadyAppearance | undefined
    if (!appearance) {
      throw new ApiError('NOT_FOUND', { message: 'appearance not found for character' })
    }
    if (character.profileConfirmed) return { alreadyFinal: true }
    const visualRef = resolveVisualReference(appearance)
    if (!visualRef) {
      throw new ApiError('CONFLICT', { message: 'character visual is not ready' })
    }

    const updated = await tx.novelPromotionCharacter.updateMany({
      where: {
        id: input.characterId,
        profileConfirmed: false,
        novelPromotionProject: { projectId },
      },
      data: { profileConfirmed: true },
    })
    if (updated.count === 0) return { alreadyFinal: true }

    await tx.auditLog.create({
      data: {
        userId: authResult.session.user.id,
        projectId,
        action: 'character.visual_finalize',
        entityType: 'NovelPromotionCharacter',
        entityId: character.id,
        snapshot: {
          characterName: character.name,
          appearanceId: appearance.id,
          imageMediaId: appearance.imageMediaId,
          visualRef,
          previousProfileConfirmed: false,
          profileConfirmed: true,
          requestId,
        },
      },
    })
    return { alreadyFinal: false }
  }).catch((error: unknown) => {
    if (error instanceof ApiError) throw error
    throw new ApiError('INTERNAL_ERROR', {
      message: 'failed to persist character visual finalization',
    })
  })

  return NextResponse.json({
    success: true,
    alreadyFinal: result.alreadyFinal,
    character: { id: input.characterId, profileConfirmed: true },
  })
})

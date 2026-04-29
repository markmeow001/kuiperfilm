import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface ImportCharacterBody {
  globalCharacterId?: unknown
  includeAppearances?: unknown
}

/**
 * Phase 11.2 — POST /api/projects/[projectId]/import-character
 *
 * Imports a GlobalCharacter (asset hub) into a project as a NovelPromotionCharacter.
 * - Validates: GlobalCharacter must belong to the current user (else 403).
 * - Records `sourceGlobalCharacterId` for traceability.
 * - When includeAppearances=true, also clones GlobalCharacterAppearance rows
 *   into CharacterAppearance. imageMediaId is reused as-is across users —
 *   this is a known Phase 11.5 limitation (cross-user MediaObject reference).
 * - Does NOT touch the EpisodeCharacter junction; episode assignment happens
 *   later via the manual UI (role='manual' written then).
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Project ownership.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')
  if (project.userId !== session.user.id) throw new ApiError('FORBIDDEN')

  const body = (await request.json()) as ImportCharacterBody
  const globalCharacterId = typeof body.globalCharacterId === 'string' ? body.globalCharacterId : null
  if (!globalCharacterId) throw new ApiError('INVALID_PARAMS')
  const includeAppearances = body.includeAppearances !== false // default true

  // Resolve NovelPromotionProject.
  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) throw new ApiError('NOT_FOUND')

  // Load source GlobalCharacter with appearances.
  const globalCharacter = await prisma.globalCharacter.findUnique({
    where: { id: globalCharacterId },
    include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
  })
  if (!globalCharacter) throw new ApiError('NOT_FOUND')
  if (globalCharacter.userId !== session.user.id) throw new ApiError('FORBIDDEN')

  type GAppearance = (typeof globalCharacter.appearances)[number]
  const appearancesToClone: GAppearance[] = includeAppearances ? globalCharacter.appearances : []

  const created = await prisma.$transaction(async (tx) => {
    const character = await tx.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: novelProject.id,
        name: globalCharacter.name,
        aliases: globalCharacter.aliases,
        voiceId: globalCharacter.voiceId,
        voiceType: globalCharacter.voiceType,
        customVoiceUrl: globalCharacter.customVoiceUrl,
        customVoiceMediaId: globalCharacter.customVoiceMediaId,
        profileData: globalCharacter.profileData,
        profileConfirmed: globalCharacter.profileConfirmed,
        sourceGlobalCharacterId: globalCharacter.id,
      },
      select: { id: true },
    })

    if (appearancesToClone.length > 0) {
      // NOTE (Phase 11.5 known limitation): imageMediaId is copied as-is even
      // though the source MediaObject belongs to the GlobalCharacter's owner.
      // Cross-user MediaObject reference is acknowledged here — see
      // master plan Phase 11.5 follow-up notes. Do NOT add a compatibility
      // shim; the proper fix is media-ownership rework in a later phase.
      await tx.characterAppearance.createMany({
        data: appearancesToClone.map((ga) => ({
          characterId: character.id,
          appearanceIndex: ga.appearanceIndex,
          changeReason: ga.changeReason,
          description: ga.description,
          descriptions: ga.descriptions,
          imageUrl: ga.imageUrl,
          imageUrls: ga.imageUrls,
          imageMediaId: ga.imageMediaId,
          selectedIndex: ga.selectedIndex,
          previousImageUrl: ga.previousImageUrl,
          previousImageUrls: ga.previousImageUrls,
          previousDescription: ga.previousDescription,
          previousDescriptions: ga.previousDescriptions,
        })),
      })
    }

    return character.id
  }, { timeout: 30000 })

  const fresh = await prisma.novelPromotionCharacter.findUnique({
    where: { id: created },
    include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
  })

  return NextResponse.json({ success: true, character: fresh })
})

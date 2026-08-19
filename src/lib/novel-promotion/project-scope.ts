import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getMultiShotClipUrls } from '@/lib/storyboard/multi-shot-clips'
import type { StoryboardBatchVideoPanelSource } from '@/lib/novel-promotion/storyboard-batch-video-quote'

const scopedPanelInclude = {
  storyboard: {
    select: {
      id: true,
      episodeId: true,
    },
  },
} satisfies Prisma.NovelPromotionPanelInclude

const scopedEpisodeStoryboardMediaInclude = {
  storyboards: {
    include: {
      panels: { orderBy: { panelIndex: 'asc' as const } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  clips: {
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.NovelPromotionEpisodeInclude

export type ScopedNovelPromotionPanel = Prisma.NovelPromotionPanelGetPayload<{
  include: typeof scopedPanelInclude
}>

export type ScopedNovelPromotionPanelSet = {
  panels: ScopedNovelPromotionPanel[]
  storyboardId: string
  episodeId: string
}

export type ScopedNovelPromotionEpisodeStoryboardMedia =
  Prisma.NovelPromotionEpisodeGetPayload<{
    include: typeof scopedEpisodeStoryboardMediaInclude
  }>

export class NovelPromotionProjectScopeError extends Error {
  readonly code = 'NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'

  constructor(
    resource:
      | 'episode'
      | 'storyboard'
      | 'panel-set'
      | 'panel'
      | 'voice-line'
      | 'character-appearance'
      | 'location'
      | 'location-image',
    resourceId: string,
    projectId: string,
  ) {
    super(`${resource} ${resourceId} does not belong to project ${projectId}`)
    this.name = 'NovelPromotionProjectScopeError'
  }
}

export async function findNovelPromotionEpisodeInProject(projectId: string, episodeId: string) {
  return await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: { id: true },
  })
}

export async function findNovelPromotionEpisodeStoryboardMediaInProject(
  projectId: string,
  episodeId: string,
): Promise<ScopedNovelPromotionEpisodeStoryboardMedia | null> {
  return await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    include: scopedEpisodeStoryboardMediaInclude,
  })
}

/**
 * Authorize a video-proxy source by the exact durable value stored inside the
 * requested project. A signed/public-looking URL is not ownership evidence.
 */
export async function isNovelPromotionVideoReferenceInProject(
  projectId: string,
  videoReference: string,
): Promise<boolean> {
  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboard: { episode: { novelPromotionProject: { projectId } } },
      OR: [
        { videoUrl: videoReference },
        { lipSyncVideoUrl: videoReference },
      ],
    },
    select: { id: true },
  })
  if (panel) return true

  const storyboards = await prisma.novelPromotionStoryboard.findMany({
    where: {
      episode: { novelPromotionProject: { projectId } },
      OR: [
        { multiShotVideoUrl: videoReference },
        { multiShotClipUrls: { not: null } },
      ],
    },
    select: {
      multiShotVideoUrl: true,
      multiShotClipUrls: true,
    },
  })
  return storyboards.some((storyboard) => (
    storyboard.multiShotVideoUrl === videoReference
    || getMultiShotClipUrls(storyboard).includes(videoReference)
  ))
}

export async function findCharacterAppearanceInProject(
  projectId: string,
  appearanceId: string,
) {
  return await prisma.characterAppearance.findFirst({
    where: {
      id: appearanceId,
      character: { novelPromotionProject: { projectId } },
    },
  })
}

export async function findNovelPromotionLocationInProject(
  projectId: string,
  locationId: string,
) {
  return await prisma.novelPromotionLocation.findFirst({
    where: {
      id: locationId,
      novelPromotionProject: { projectId },
    },
    include: {
      images: { orderBy: { imageIndex: 'asc' } },
    },
  })
}

export function novelPromotionLocationImageInProjectWhere(
  projectId: string,
  locationImageId: string,
): Prisma.LocationImageWhereInput {
  return {
    id: locationImageId,
    location: { novelPromotionProject: { projectId } },
  }
}

export async function findNovelPromotionStoryboardInProject(projectId: string, storyboardId: string) {
  return await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
    select: {
      id: true,
      episodeId: true,
      clipId: true,
    },
  })
}

export async function findNovelPromotionPanelInProject(
  projectId: string,
  panelId: string,
): Promise<ScopedNovelPromotionPanel | null> {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      id: panelId,
      storyboard: { episode: { novelPromotionProject: { projectId } } },
    },
    include: scopedPanelInclude,
  })
}

export async function findNovelPromotionVoiceLineInProject(projectId: string, voiceLineId: string) {
  return await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      id: voiceLineId,
      episode: { novelPromotionProject: { projectId } },
    },
    select: {
      id: true,
      episodeId: true,
      audioUrl: true,
    },
  })
}

export async function findNovelPromotionPanelByStoryboardIndexInProject(
  projectId: string,
  storyboardId: string,
  panelIndex: number,
): Promise<ScopedNovelPromotionPanel | null> {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId,
      panelIndex,
      storyboard: { episode: { novelPromotionProject: { projectId } } },
    },
    include: scopedPanelInclude,
  })
}

export async function findNovelPromotionPanelSetInProject(
  projectId: string,
  panelIds: readonly string[],
): Promise<ScopedNovelPromotionPanelSet | null> {
  const uniquePanelIds = Array.from(new Set(panelIds))
  if (uniquePanelIds.length === 0 || uniquePanelIds.length !== panelIds.length) {
    return null
  }

  const rows = await prisma.novelPromotionPanel.findMany({
    where: {
      id: { in: uniquePanelIds },
      storyboard: { episode: { novelPromotionProject: { projectId } } },
    },
    include: scopedPanelInclude,
  })

  if (rows.length !== uniquePanelIds.length) return null

  const byId = new Map(rows.map((panel) => [panel.id, panel]))
  const panels = uniquePanelIds.map((id) => byId.get(id))
  if (panels.some((panel) => !panel)) return null

  const orderedPanels = panels as ScopedNovelPromotionPanel[]
  const storyboardId = orderedPanels[0].storyboardId
  const episodeId = orderedPanels[0].storyboard.episodeId
  // Auto-group can legally span several storyboard rows inside one episode.
  // The ordered first panel owns the output target; only cross-episode mixes
  // are invalid.
  if (!orderedPanels.every((panel) => panel.storyboard.episodeId === episodeId)) return null

  return { panels: orderedPanels, storyboardId, episodeId }
}

export async function requireNovelPromotionPanelInProject(projectId: string, panelId: string) {
  const panel = await findNovelPromotionPanelInProject(projectId, panelId)
  if (!panel) {
    throw new NovelPromotionProjectScopeError('panel', panelId, projectId)
  }
  return panel
}

export async function requireNovelPromotionStoryboardInProject(projectId: string, storyboardId: string) {
  const storyboard = await findNovelPromotionStoryboardInProject(projectId, storyboardId)
  if (!storyboard) {
    throw new NovelPromotionProjectScopeError('storyboard', storyboardId, projectId)
  }
  return storyboard
}

export async function requireNovelPromotionVoiceLineInProject(projectId: string, voiceLineId: string) {
  const voiceLine = await findNovelPromotionVoiceLineInProject(projectId, voiceLineId)
  if (!voiceLine) {
    throw new NovelPromotionProjectScopeError('voice-line', voiceLineId, projectId)
  }
  return voiceLine
}

export async function requireNovelPromotionPanelSetInProject(
  projectId: string,
  panelIds: readonly string[],
) {
  const panelSet = await findNovelPromotionPanelSetInProject(projectId, panelIds)
  if (!panelSet) {
    throw new NovelPromotionProjectScopeError('panel-set', panelIds.join(','), projectId)
  }
  return panelSet
}

export async function updateNovelPromotionPanelInProject(
  projectId: string,
  panelId: string,
  data: Prisma.NovelPromotionPanelUpdateManyMutationInput,
) {
  const result = await prisma.novelPromotionPanel.updateMany({
    where: {
      id: panelId,
      storyboard: { episode: { novelPromotionProject: { projectId } } },
    },
    data,
  })
  if (result.count !== 1) {
    throw new NovelPromotionProjectScopeError('panel', panelId, projectId)
  }
}

export async function compareAndSetNovelPromotionPanelVideoFromBatchQuote(
  projectId: string,
  panelId: string,
  episodeId: string,
  source: StoryboardBatchVideoPanelSource,
  data: { videoUrl: string; videoGenerationMode: 'normal' | 'firstlastframe' },
): Promise<boolean> {
  const expectedUpdatedAt = new Date(source.updatedAt)
  if (!Number.isFinite(expectedUpdatedAt.getTime())) return false

  const result = await prisma.novelPromotionPanel.updateMany({
    where: {
      id: panelId,
      storyboard: {
        episodeId,
        episode: { novelPromotionProject: { projectId } },
      },
      updatedAt: expectedUpdatedAt,
      imageUrl: source.imageUrl,
      imageMediaId: source.imageMediaId,
      description: source.description,
      videoPrompt: source.videoPrompt,
      firstLastFramePrompt: source.firstLastFramePrompt,
      srtSegment: source.srtSegment,
      videoUrl: source.videoUrl,
      videoMediaId: source.videoMediaId,
    },
    data,
  })
  return result.count === 1
}

export async function updateNovelPromotionStoryboardInProject(
  projectId: string,
  storyboardId: string,
  data: Prisma.NovelPromotionStoryboardUpdateManyMutationInput,
) {
  const result = await prisma.novelPromotionStoryboard.updateMany({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
    data,
  })
  if (result.count !== 1) {
    throw new NovelPromotionProjectScopeError('storyboard', storyboardId, projectId)
  }
}

export async function updateCharacterAppearanceInProject(
  projectId: string,
  appearanceId: string,
  data: Prisma.CharacterAppearanceUpdateManyMutationInput,
) {
  const result = await prisma.characterAppearance.updateMany({
    where: {
      id: appearanceId,
      character: { novelPromotionProject: { projectId } },
    },
    data,
  })
  if (result.count !== 1) {
    throw new NovelPromotionProjectScopeError('character-appearance', appearanceId, projectId)
  }
}

export async function updateNovelPromotionLocationImageInProject(
  projectId: string,
  locationImageId: string,
  data: Prisma.LocationImageUpdateManyMutationInput,
) {
  const result = await prisma.locationImage.updateMany({
    where: novelPromotionLocationImageInProjectWhere(projectId, locationImageId),
    data,
  })
  if (result.count !== 1) {
    throw new NovelPromotionProjectScopeError('location-image', locationImageId, projectId)
  }
}

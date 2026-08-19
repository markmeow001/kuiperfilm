import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import {
  EpisodeDeliverySourceError,
  requireOwnedDeliveryStorageKey,
} from '@/lib/novel-promotion/final-delivery'
import {
  resolveOwnedVoiceLineAudioSource,
  VoiceLineAudioSourceError,
  type OwnedVoiceLineAudioSource,
} from '@/lib/novel-promotion/voice-line-audio-source'

const episodeDeliveryInclude = {
  storyboards: {
    include: {
      panels: {
        orderBy: [{ panelIndex: 'asc' as const }, { id: 'asc' as const }],
      },
    },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  voiceLines: {
    include: {
      audioMedia: {
        select: {
          id: true,
          publicId: true,
          storageKey: true,
          sha256: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
    orderBy: [{ lineIndex: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.NovelPromotionEpisodeInclude

export type EpisodeDeliveryEpisode = Prisma.NovelPromotionEpisodeGetPayload<{
  include: typeof episodeDeliveryInclude
}>

export type EpisodeDeliveryInputSummary = {
  canCreate: boolean
  selectedVideoCount: number
  imageCount: number
  multiShotVideoCount: number
  voiceAudioCount: number
  missingVoiceAudioCount: number
}

export type EpisodeDeliveryPanelSnapshot = {
  sequence: number
  storyboardOrder: number
  storyboardId: string
  panelId: string
  panelIndex: number
  description: string | null
  imageKey: string | null
  selectedVideoKey: string | null
  selectedVideoKind: 'lip_sync' | 'base' | null
  cameraMove: string | null
  shotType: string | null
}

export type EpisodeDeliveryMultiShotSnapshot = {
  groupOrder: number
  storyboardOrder: number
  firstPanelIndex: number
  storyboardId: string
  groupId: string
  storageKeys: string[]
  cameraNote: string | null
}

export type EpisodeDeliveryVoiceAudioSnapshot = OwnedVoiceLineAudioSource & {
  sequence: number
  lineIndex: number
  speaker: string
  content: string
  matchedPanelId: string | null
  matchedPanelIndex: number | null
  mediaSha256: string | null
}

export type EpisodeDeliveryExcludedVoiceLine = {
  lineId: string
  lineIndex: number
  reason: 'audio_url_missing'
}

export type EpisodeDeliveryInputSnapshot = {
  episode: EpisodeDeliveryEpisode
  panels: EpisodeDeliveryPanelSnapshot[]
  multiShotVideos: EpisodeDeliveryMultiShotSnapshot[]
  voiceAudios: EpisodeDeliveryVoiceAudioSnapshot[]
  excludedVoiceLines: EpisodeDeliveryExcludedVoiceLine[]
  sourceFingerprint: string
  input: EpisodeDeliveryInputSummary
}

type GroupSignature = {
  storyboardOrder: number
  firstPanelIndex: number
  storyboardId: string
  groupId: string
}

function taskPanelIds(payload: Prisma.JsonValue | null): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const value = (payload as Prisma.JsonObject).panelIds
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function taskStorageKeys(result: Prisma.JsonValue | null): string[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const value = result as Prisma.JsonObject
  if (Array.isArray(value.multiShotClipUrls)) {
    const clips = value.multiShotClipUrls.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    )
    if (clips.length > 0) return clips
  }
  return typeof value.multiShotVideoUrl === 'string' && value.multiShotVideoUrl.length > 0
    ? [value.multiShotVideoUrl]
    : []
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

/**
 * Reads and validates the immutable input selection for episode delivery.
 * Every server caller uses this snapshot so preview counts, task admission,
 * and the archive worker cannot disagree about which media is deliverable.
 */
export async function getEpisodeDeliveryInputSnapshot(
  projectId: string,
  episodeId: string,
): Promise<EpisodeDeliveryInputSnapshot | null> {
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    include: episodeDeliveryInclude,
  })
  if (!episode) return null

  let sequence = 0
  const panels: EpisodeDeliveryPanelSnapshot[] = []
  const groupSignatures: GroupSignature[] = []
  const panelToGroupKey = new Map<string, string>()

  episode.storyboards.forEach((storyboard, storyboardIndex) => {
    const storyboardOrder = storyboardIndex + 1
    const groupPanelIndices = new Map<string, number[]>()

    for (const panel of storyboard.panels) {
      sequence += 1
      const hasLipSyncVideo = panel.lipSyncVideoUrl != null
      const selectedVideoValue = hasLipSyncVideo ? panel.lipSyncVideoUrl : panel.videoUrl
      const selectedVideoKey = selectedVideoValue == null
        ? null
        : requireOwnedDeliveryStorageKey(selectedVideoValue)
      const imageKey = panel.imageUrl == null
        ? null
        : requireOwnedDeliveryStorageKey(panel.imageUrl)

      panels.push({
        sequence,
        storyboardOrder,
        storyboardId: storyboard.id,
        panelId: panel.id,
        panelIndex: panel.panelIndex,
        description: panel.description,
        imageKey,
        selectedVideoKey,
        selectedVideoKind: hasLipSyncVideo
          ? 'lip_sync'
          : panel.videoUrl != null
            ? 'base'
            : null,
        cameraMove: panel.cameraMove,
        shotType: panel.shotType,
      })

      if (panel.multiShotGroupId) {
        const indices = groupPanelIndices.get(panel.multiShotGroupId) ?? []
        indices.push(panel.panelIndex)
        groupPanelIndices.set(panel.multiShotGroupId, indices)
        panelToGroupKey.set(panel.id, `${storyboard.id}:${panel.multiShotGroupId}`)
      }
    }

    for (const [groupId, indices] of groupPanelIndices) {
      groupSignatures.push({
        storyboardOrder,
        firstPanelIndex: Math.min(...indices),
        storyboardId: storyboard.id,
        groupId,
      })
    }
  })

  groupSignatures.sort((left, right) => (
    left.storyboardOrder - right.storyboardOrder
    || left.firstPanelIndex - right.firstPanelIndex
    || left.groupId.localeCompare(right.groupId)
  ))

  const storageKeysByGroup = new Map<string, string[]>()
  if (groupSignatures.length > 0) {
    const completedTasks = await prisma.task.findMany({
      where: {
        projectId,
        episodeId: episode.id,
        type: TASK_TYPE.VIDEO_MULTI_SHOT,
        status: 'completed',
      },
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
      select: { payload: true, result: true },
    })

    for (const task of completedTasks) {
      const panelIds = taskPanelIds(task.payload)
      if (panelIds.length === 0) continue
      const groupKeys = new Set(panelIds.map((panelId) => panelToGroupKey.get(panelId)))
      if (groupKeys.size !== 1 || groupKeys.has(undefined)) continue
      const groupKey = groupKeys.values().next().value
      if (typeof groupKey !== 'string' || storageKeysByGroup.has(groupKey)) continue

      const rawKeys = taskStorageKeys(task.result)
      if (rawKeys.length === 0) continue
      storageKeysByGroup.set(
        groupKey,
        rawKeys.map((key) => requireOwnedDeliveryStorageKey(key)),
      )
    }
  }

  const multiShotVideos: EpisodeDeliveryMultiShotSnapshot[] = []
  groupSignatures.forEach((signature, signatureIndex) => {
    const storageKeys = storageKeysByGroup.get(`${signature.storyboardId}:${signature.groupId}`)
    if (!storageKeys || storageKeys.length === 0) return
    const storyboard = episode.storyboards.find((item) => item.id === signature.storyboardId)
    const indices = (storyboard?.panels ?? [])
      .filter((panel) => panel.multiShotGroupId === signature.groupId)
      .map((panel) => panel.panelIndex)
      .sort((left, right) => left - right)
    multiShotVideos.push({
      groupOrder: signatureIndex + 1,
      storyboardOrder: signature.storyboardOrder,
      firstPanelIndex: signature.firstPanelIndex,
      storyboardId: signature.storyboardId,
      groupId: signature.groupId,
      storageKeys,
      cameraNote: indices.length > 0
        ? `panels ${indices[0]}-${indices[indices.length - 1]}`
        : null,
    })
  })

  const voiceAudios: EpisodeDeliveryVoiceAudioSnapshot[] = []
  const excludedVoiceLines: EpisodeDeliveryExcludedVoiceLine[] = []
  for (const line of episode.voiceLines) {
    if (line.audioUrl === null) {
      excludedVoiceLines.push({
        lineId: line.id,
        lineIndex: line.lineIndex,
        reason: 'audio_url_missing',
      })
      continue
    }
    try {
      const source = resolveOwnedVoiceLineAudioSource({ projectId, episodeId: episode.id }, line)
      voiceAudios.push({
        ...source,
        sequence: voiceAudios.length + 1,
        lineIndex: line.lineIndex,
        speaker: line.speaker,
        content: line.content,
        matchedPanelId: line.matchedPanelId,
        matchedPanelIndex: line.matchedPanelIndex,
        mediaSha256: line.audioMedia?.sha256 ?? null,
      })
    } catch (error) {
      if (error instanceof VoiceLineAudioSourceError) {
        throw new EpisodeDeliverySourceError()
      }
      throw error
    }
  }

  const selectedVideoCount = panels.filter((panel) => panel.selectedVideoKey !== null).length
  const imageCount = panels.filter((panel) => panel.imageKey !== null).length
  const multiShotVideoCount = multiShotVideos.reduce(
    (count, group) => count + group.storageKeys.length,
    0,
  )
  const voiceAudioCount = voiceAudios.length
  const missingVoiceAudioCount = excludedVoiceLines.length
  const sourceFingerprint = fingerprint({
    version: 1,
    projectId,
    episodeId: episode.id,
    panels,
    multiShotVideos,
    voiceLines: episode.voiceLines.map((line) => {
      const audio = voiceAudios.find((item) => item.lineId === line.id)
      const excluded = excludedVoiceLines.find((item) => item.lineId === line.id)
      return {
        lineId: line.id,
        lineIndex: line.lineIndex,
        speaker: line.speaker,
        content: line.content,
        matchedPanelId: line.matchedPanelId,
        matchedPanelIndex: line.matchedPanelIndex,
        storageKey: audio?.storageKey ?? null,
        provenance: audio?.provenance ?? null,
        mediaId: audio?.mediaId ?? null,
        mediaSha256: audio?.mediaSha256 ?? null,
        sourceVersionAt: audio?.provenance === 'legacy_generated' && audio.mediaSha256 === null
          ? line.updatedAt instanceof Date
            ? line.updatedAt.toISOString()
            : null
          : null,
        excludedReason: excluded?.reason ?? null,
      }
    }),
  })

  return {
    episode,
    panels,
    multiShotVideos,
    voiceAudios,
    excludedVoiceLines,
    sourceFingerprint,
    input: {
      canCreate: selectedVideoCount + imageCount + multiShotVideoCount + voiceAudioCount > 0,
      selectedVideoCount,
      imageCount,
      multiShotVideoCount,
      voiceAudioCount,
      missingVoiceAudioCount,
    },
  }
}

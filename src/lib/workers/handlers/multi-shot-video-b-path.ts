import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { createScopedLogger } from '@/lib/logging/core'
import { generateVideo } from '@/lib/generator-api'
import {
  parsePanelCharacterReferences,
  findCharacterByName,
  parseImageUrls,
} from './image-task-handler-shared'

interface CharacterAppearanceForBPath {
  id: string
  changeReason: string | null
  imageUrls: string | null
  imageUrl: string | null
  selectedIndex: number | null
}

interface CharacterForBPath {
  id: string
  name: string
  appearances?: CharacterAppearanceForBPath[]
}
import {
  assertTaskActive,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'

interface BPathPanel {
  id: string
  description: string | null
  videoPrompt: string | null
  characters: string | null
  imageUrl: string | null
  storyboardId: string
}

interface BPathProjectData {
  characters?: CharacterForBPath[]
}

/**
 * Tencent VOD Kling-Omni multi-shot path.
 *
 * Builds a single CreateAigcVideoTask with:
 *   - One combined Prompt that numbers each panel's shot ("镜头1: ...")
 *     so the model knows the intended order.
 *   - SubjectInfos.N for character consistency — first three speaking
 *     characters across the selected panels, each with their primary
 *     appearance image as the visual anchor.
 *   - ExtInfo.multi_shot='intelligence' so the Kling model decides its
 *     own shot transitions instead of needing a per-frame reference.
 *
 * No imageUrl required on individual panels — this is text-to-video.
 */
export async function runMultiShotBPath(params: {
  job: Job<TaskJobData>
  validPanels: BPathPanel[]
  projectData: BPathProjectData
  videoModel: string
  sound?: boolean
  aspectRatio?: string
}): Promise<{ storyboardId: string; multiShotVideoUrl: string; shotCount: number; subjectCount: number; path: 'B' }> {
  const { job, validPanels, projectData, videoModel, sound, aspectRatio } = params
  const { userId } = job.data
  const logger = createScopedLogger({
    module: 'worker.multi-shot-video-b-path',
    action: 'multi_shot_video_b_path_generate',
  })

  // Phase 11.4 / multi-appearance: pre-load EpisodeCharacter bindings
  // for the storyboard's episode so per-character costume overrides
  // apply to multi-shot generation too. All selected panels live under
  // the same storyboard, which lives under one episode.
  let episodeBindings = new Map<string, string>()
  const firstStoryboardId = validPanels[0]?.storyboardId
  if (firstStoryboardId) {
    const sb = await prisma.novelPromotionStoryboard.findUnique({
      where: { id: firstStoryboardId },
      select: { episodeId: true },
    })
    if (sb?.episodeId) {
      const rows = await prisma.episodeCharacter.findMany({
        where: { episodeId: sb.episodeId, appearanceId: { not: null } },
        select: { characterId: true, appearanceId: true },
      })
      for (const row of rows) {
        if (row.appearanceId) episodeBindings.set(row.characterId, row.appearanceId)
      }
    }
  }

  // Collect unique characters in panel order, take their primary
  // appearance image for SubjectInfos. Cap at 3 (Tencent limit).
  const subjectMap = new Map<string, { name: string; imageUrl: string }>()
  for (const panel of validPanels) {
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      if (subjectMap.has(ref.name.toLowerCase())) continue
      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const boundAppearanceId = episodeBindings.get(character.id)
      if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      } else if (ref.appearance) {
        const matched = appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
        if (matched) appearance = matched
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      subjectMap.set(ref.name.toLowerCase(), { name: ref.name, imageUrl: publicUrl })
    }
  }
  const subjectInfos = Array.from(subjectMap.values())
    .slice(0, 3)
    .map((s) => ({ name: s.name, imageUrls: [s.imageUrl] }))

  // Numbered combined prompt. Kling 3.0 Omni intelligence mode parses
  // 镜头N: structure natively for shot ordering.
  const combinedPrompt = validPanels
    .map((panel, i) => {
      const text = (panel.videoPrompt || panel.description || '').trim()
      return `镜头${i + 1}: ${text}`
    })
    .filter((line) => line.trim().length > `镜头N: `.length)
    .join('\n\n')

  if (!combinedPrompt.trim()) {
    throw new Error('MULTI_SHOT_PROMPT_EMPTY: every panel had empty videoPrompt + description')
  }

  logger.info({
    message: 'B path multi-shot submit',
    details: {
      videoModel,
      shotCount: validPanels.length,
      subjectCount: subjectInfos.length,
      promptLength: combinedPrompt.length,
    },
  })

  await reportTaskProgress(job, 30, { stage: 'submit_generation_b_path' })

  const totalDuration = validPanels.length >= 3 ? 10 : 5
  const generateOptions = {
    prompt: combinedPrompt,
    duration: totalDuration,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(sound !== undefined ? { generateAudio: sound } : {}),
    subjectInfos,
    klingMultiShot: { multi_shot: 'intelligence' },
    outputComplianceCheck: 'Enabled',
  }
  // generateVideo's option type is intentionally narrow (only standard
  // fields). Tencent-specific keys (subjectInfos / klingMultiShot /
  // outputComplianceCheck) ride through as extras and are picked up by
  // the TencentVODVideoGenerator typed options.
  const generateResult = await generateVideo(
    userId,
    videoModel,
    '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateOptions as any,
  )

  if (!generateResult.success) {
    throw new Error(generateResult.error || 'Tencent VOD multi-shot submit failed')
  }
  const externalId = typeof generateResult.externalId === 'string' ? generateResult.externalId.trim() : ''
  if (!externalId) {
    throw new Error('Tencent VOD multi-shot returned no externalId')
  }

  const polled = await waitExternalResult(job, externalId, userId, {
    progressStart: 35,
    progressEnd: 90,
  })

  await assertTaskActive(job, 'persist_multi_shot_video_b_path')

  const storyboardId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(polled.url, 'multi-shot-video-b', storyboardId)
  await reportTaskProgress(job, 95, { stage: 'persist' })

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { multiShotVideoUrl: cosKey },
  })

  return {
    storyboardId,
    multiShotVideoUrl: cosKey,
    shotCount: validPanels.length,
    subjectCount: subjectInfos.length,
    path: 'B',
  }
}

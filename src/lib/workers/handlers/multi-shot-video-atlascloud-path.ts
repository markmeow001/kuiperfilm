/**
 * AtlasCloud "composite" path for multi-shot video.
 *
 * Different from the BobAPI Seedance composite path (which uses
 * content[] @N references) and the Tencent VOD Kling B path (which
 * uses SubjectInfos + multi_shot=intelligence). AtlasCloud Seedance
 * 2.0 exposes three endpoints and the multi-shot capability is in
 * the MODEL, not the endpoint — the prompt itself encodes the shot
 * breakdown:
 *
 *   "第一鏡：…  第二鏡：…  第三鏡：…"
 *
 * Each endpoint takes a different anchor type:
 *   - text-to-video       (t2v): no images, pure prompt-driven
 *   - image-to-video      (i2v): one first_frame image + prompt
 *   - reference-to-video  (r2v): 1-9 reference_images[] + prompt
 *                                (refs cited as "image 1" / "image 2")
 *
 * Picker exposes all 4 (t2v / i2v × std / fast) plus 2 r2v variants.
 * User picks per scene: t2v for purely text-driven scenes, i2v when
 * a single anchor image is enough, r2v when multiple character /
 * scene anchors are needed.
 *
 * Output: ONE composite mp4 stored as the storyboard's
 * `multiShotVideoUrl` + single-element `multiShotClipUrls`. Same
 * persistence shape as BobAPI / Kling B paths so the existing
 * MultiShotBindingsRail UI renders without frontend changes.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { AtlasCloudSeedanceVideoGenerator } from '@/lib/generators/video/atlascloud'
import {
  assertTaskActive,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'
import { buildMultiShotClipUpdate } from '@/lib/storyboard/multi-shot-clips'
import { createScopedLogger } from '@/lib/logging/core'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import {
  findCharacterByName,
  parsePanelCharacterReferences,
  parseImageUrls,
  resolveNovelData,
} from './image-task-handler-shared'

const MAX_REFERENCE_IMAGES = 9
const MAX_CHARACTER_REFS = 4
const MAX_SCENE_REFS = 2
const MIN_DURATION_SEC = 4
const MAX_DURATION_SEC = 15

interface PanelLite {
  id: string
  imageUrl: string | null
  description: string | null
  videoPrompt: string | null
  characters: string | null
  location: string | null
  srtSegment: string | null
  storyboardId: string
}

interface CharacterRef {
  id: string
  name: string
  imageUrl: string
}

interface SceneRef {
  id: string
  name: string
  imageUrl: string
}

/**
 * True when this videoModel routes to AtlasCloud composite (any of the
 * 6 Seedance 2.0 variants — t2v / i2v / r2v × std / fast). Used by
 * the dispatcher in multi-shot-video-handler.ts.
 */
export function shouldUseAtlasCloudComposite(videoModel: string): boolean {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed) return false
  if (parsed.provider !== 'atlascloud') return false
  // Only Seedance 2.0 line supports multi-shot. v1.5-pro / wan-2.6
  // stay single-shot only.
  return /^seedance-2\.0/.test(parsed.modelId)
}

type ModeKey = 't2v' | 'i2v' | 'r2v'

function classifyMode(modelId: string): ModeKey {
  if (modelId.endsWith('-r2v')) return 'r2v'
  if (modelId.endsWith('-t2v')) return 't2v'
  return 'i2v' // default for -i2v slugs and anything else
}

/**
 * Assemble multi-shot prompt from panel descriptions in shot order.
 * For r2v we also tell the model "image N" maps to character / scene
 * references in the same order they're sent.
 */
function buildAtlasCloudPrompt(
  panels: PanelLite[],
  refLabels: string[],
  mode: ModeKey,
): { prompt: string; dialogueBeatCount: number } {
  const shotLines: string[] = []
  let dialogueBeatCount = 0

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]
    const shotNum = i + 1
    const desc = (panel.videoPrompt || panel.description || '').trim()
    const dialogue = (panel.srtSegment || '').trim()
    if (dialogue) dialogueBeatCount += 1

    const parts: string[] = []
    parts.push(`第${shotNum}鏡：${desc || '(無描述)'}`)
    if (dialogue) {
      parts.push(`對白：${dialogue}`)
    }
    shotLines.push(parts.join(' '))
  }

  const header: string[] = []
  if (mode === 'r2v' && refLabels.length > 0) {
    // Tell the model how the numbered refs map to subjects.
    header.push(
      `參考圖對應：${refLabels.map((l, i) => `image ${i + 1} = ${l}`).join('；')}`,
    )
  }

  const audioDirective =
    dialogueBeatCount > 0
      ? '依對白生成同步語音，背景音樂與環境音適配劇情。'
      : '依劇情生成環境音與適配背景音樂，無對白。'

  const prompt = [
    ...header,
    ...shotLines,
    audioDirective,
  ].join('\n')

  return { prompt, dialogueBeatCount }
}

/** Walk panels and collect unique character refs (mirrors BobAPI path). */
function collectCharacterRefs(
  panels: PanelLite[],
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  episodeBindings: Map<string, string>,
): CharacterRef[] {
  const refs: CharacterRef[] = []
  const seenIds = new Set<string>()
  for (const panel of panels) {
    if (refs.length >= MAX_CHARACTER_REFS) break
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      if (refs.length >= MAX_CHARACTER_REFS) break
      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue
      if (seenIds.has(character.id)) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const boundAppearanceId = episodeBindings.get(character.id)
      if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      seenIds.add(character.id)
      refs.push({ id: character.id, name: ref.name, imageUrl: publicUrl })
    }
  }
  return refs
}

/** Walk panels and collect unique scene refs. */
function collectSceneRefs(
  panels: PanelLite[],
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
): SceneRef[] {
  const refs: SceneRef[] = []
  const seenIds = new Set<string>()
  for (const panel of panels) {
    if (refs.length >= MAX_SCENE_REFS) break
    if (!panel.location) continue
    const locName = panel.location.trim()
    if (!locName) continue
    for (const loc of projectData.locations ?? []) {
      if (seenIds.has(loc.id)) continue
      if (loc.name !== locName) continue
      const views = loc.views ?? []
      const view = views[0]
      if (!view) continue
      const imageKey = view.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      seenIds.add(loc.id)
      refs.push({ id: loc.id, name: loc.name, imageUrl: publicUrl })
      break
    }
  }
  return refs
}

export async function runMultiShotAtlasCloudComposite(params: {
  job: Job<TaskJobData>
  projectId: string
  validPanels: PanelLite[]
  videoModel: string
  sound: boolean | undefined
  aspectRatio: string | undefined
  rawPrompt?: string
  panelDurations?: number[]
}): Promise<{
  storyboardId: string
  multiShotVideoUrl: string
  multiShotClipUrls: string[]
  chunkCount: number
  shotCount: number
  subjectCount: number
  path: 'atlascloud-composite'
  mode: ModeKey
  bindings: {
    characters: Array<{ id: string; name: string; imageUrl: string }>
    scenes: Array<{ id: string; name: string; imageUrl: string }>
  }
}> {
  const { job, projectId, validPanels, videoModel } = params
  const sound = params.sound ?? true
  const aspectRatio = params.aspectRatio ?? '16:9'
  const { userId } = job.data
  const logger = createScopedLogger({
    module: 'worker.multi-shot-atlascloud',
    action: 'multi_shot_atlascloud_composite',
  })

  if (validPanels.length === 0) {
    throw new Error('ATLASCLOUD_COMPOSITE_NO_PANELS')
  }

  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed || parsed.provider !== 'atlascloud') {
    throw new Error(`ATLASCLOUD_COMPOSITE_BAD_MODEL: ${videoModel}`)
  }
  const mode = classifyMode(parsed.modelId)

  await reportTaskProgress(job, 12, { stage: 'atlascloud_composite_collect_refs' })

  // Episode-level appearance bindings (same as BobAPI path).
  const episodeBindings = new Map<string, string>()
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

  const projectData = await resolveNovelData(projectId)
  const usedPanels = validPanels.slice(0, MAX_REFERENCE_IMAGES)

  // Mode-specific media assembly.
  let firstFrameUrl: string | null = null
  let referenceImages: string[] = []
  let refLabels: string[] = []
  let characterRefs: CharacterRef[] = []
  let sceneRefs: SceneRef[] = []

  if (mode === 'r2v') {
    // r2v: collect up to 9 reference_images (chars → scenes → panel images).
    characterRefs = collectCharacterRefs(usedPanels, projectData, episodeBindings)
    sceneRefs = collectSceneRefs(usedPanels, projectData)
    for (const c of characterRefs) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      referenceImages.push(c.imageUrl)
      refLabels.push(`角色「${c.name}」`)
    }
    for (const s of sceneRefs) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      referenceImages.push(s.imageUrl)
      refLabels.push(`場景「${s.name}」`)
    }
    // Fill remaining slots with panel images if any.
    for (const p of usedPanels) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      if (!p.imageUrl) continue
      const signed = toSignedUrlIfCos(p.imageUrl, 7200)
      if (!signed) continue
      referenceImages.push(signed)
      refLabels.push(`鏡頭 ${usedPanels.indexOf(p) + 1}`)
    }
    if (referenceImages.length === 0) {
      throw new Error('ATLASCLOUD_COMPOSITE_R2V_NO_REFERENCES')
    }
  } else if (mode === 'i2v') {
    // i2v: take first panel image (or first character ref if none) as first_frame.
    for (const p of usedPanels) {
      if (p.imageUrl) {
        const signed = toSignedUrlIfCos(p.imageUrl, 7200)
        if (signed) {
          firstFrameUrl = signed
          break
        }
      }
    }
    if (!firstFrameUrl) {
      // Fall back to first character ref so the call still has an anchor.
      characterRefs = collectCharacterRefs(usedPanels, projectData, episodeBindings)
      const fallbackUrl = characterRefs[0]?.imageUrl
      if (!fallbackUrl) {
        throw new Error('ATLASCLOUD_COMPOSITE_I2V_NO_FIRST_FRAME')
      }
      firstFrameUrl = fallbackUrl
    }
  }
  // t2v: no media; prompt-only.

  // Prompt: rawPrompt from UI textbox wins, else assembled from panels.
  let prompt: string
  let dialogueBeatCount: number
  if (params.rawPrompt && params.rawPrompt.trim().length > 0) {
    prompt = params.rawPrompt.trim()
    dialogueBeatCount = (prompt.match(/對白：/g) || []).length
  } else {
    const built = buildAtlasCloudPrompt(usedPanels, refLabels, mode)
    prompt = built.prompt
    dialogueBeatCount = built.dialogueBeatCount
  }

  // Duration: sum(panelDurations) when supplied, else panel-count × 2s.
  let duration: number
  if (params.panelDurations && params.panelDurations.length > 0) {
    const sum = params.panelDurations.reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(sum)))
  } else {
    const baseline = Math.round(usedPanels.length * 2)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, baseline))
  }

  logger.info({
    message: 'AtlasCloud composite submit',
    details: {
      storyboardId: validPanels[0].storyboardId,
      mode,
      modelId: parsed.modelId,
      panelsRequested: validPanels.length,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
      hasFirstFrame: Boolean(firstFrameUrl),
      referenceImageCount: referenceImages.length,
      duration,
      aspectRatio,
      generateAudio: sound,
      dialogueBeatCount,
      promptLength: prompt.length,
    },
  })

  await assertTaskActive(job, 'atlascloud_composite_submit')
  await reportTaskProgress(job, 20, { stage: 'atlascloud_composite_submit' })

  const generator = new AtlasCloudSeedanceVideoGenerator()
  const generateResult = await generator.generate({
    userId,
    // AtlasCloud generator drops body.image for t2v slugs internally;
    // r2v reads from options.referenceImages and ignores imageUrl.
    // Pass firstFrameUrl when we have one (for i2v); empty string otherwise.
    imageUrl: firstFrameUrl ?? '',
    prompt,
    options: {
      modelId: parsed.modelId,
      duration,
      aspectRatio,
      generateAudio: sound,
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
    },
  })

  if (!generateResult.success || !generateResult.externalId) {
    throw new Error(
      `ATLASCLOUD_COMPOSITE_SUBMIT_FAILED: ${generateResult.error ?? 'unknown'}`,
    )
  }

  await reportTaskProgress(job, 40, { stage: 'atlascloud_composite_poll' })

  const polled = await waitExternalResult(job, generateResult.externalId, userId, {
    timeoutMs: 15 * 60 * 1000,
    progressStart: 40,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('ATLASCLOUD_COMPOSITE_NO_RESULT_URL')
  }

  await reportTaskProgress(job, 92, { stage: 'atlascloud_composite_persist' })

  const targetId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(
    polled.url,
    `multi-shot-atlascloud/${targetId}`,
    targetId,
    polled.downloadHeaders,
  )

  await prisma.novelPromotionStoryboard.update({
    where: { id: targetId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  await reportTaskProgress(job, 98, { stage: 'atlascloud_composite_done' })

  logger.info({
    message: 'AtlasCloud composite persisted',
    details: {
      storyboardId: targetId,
      cosKey,
      mode,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
    },
  })

  return {
    storyboardId: targetId,
    multiShotVideoUrl: cosKey,
    multiShotClipUrls: [cosKey],
    chunkCount: 1,
    shotCount: usedPanels.length,
    subjectCount: characterRefs.length + sceneRefs.length,
    path: 'atlascloud-composite',
    mode,
    bindings: {
      characters: characterRefs.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      scenes: sceneRefs.map((s) => ({ id: s.id, name: s.name, imageUrl: s.imageUrl })),
    },
  }
}

import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { createScopedLogger } from '@/lib/logging/core'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { runMultiShotBPath } from './multi-shot-video-b-path'
import { runMultiShotSeedanceComposite, shouldUseSeedanceComposite } from './multi-shot-video-seedance-path'
import {
  parsePanelCharacterReferences,
  findCharacterByName,
  resolveNovelData,
  parseImageUrls,
} from './image-task-handler-shared'
import {
  assertTaskActive,
  ensureImageWithinKieAILimits,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'
import { buildMultiShotClipUpdate } from '@/lib/storyboard/multi-shot-clips'
import {
  KieAIKlingVideoGenerator,
  type KlingElement,
  type MultiShotPromptItem,
} from '@/lib/generators/video/kieai-kling'

type AnyObj = Record<string, unknown>

/**
 * 将 prompt 中的角色名替换为 @element_xxx 引用
 */
function buildPromptWithElementRefs(prompt: string, elements: KlingElement[]): string {
  let result = prompt
  for (const element of elements) {
    // element.description 存的是角色原始名称
    const name = element.description
    if (!name) continue
    // 替换角色名为 @element_xxx 引用（全局替换）
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'g'), `@${element.name}`)
  }
  return result
}

function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30)
}

/**
 * Decide whether the configured videoModel is Kling Omni (Tencent VOD)
 * with native multi_shot=intelligence support. When true, the B path
 * fires: a single t2v submission with SubjectInfos.N for character
 * consistency and ExtInfo.multi_shot='intelligence' that lets the model
 * decide its own shot transitions, no per-panel imageUrl required.
 *
 * Otherwise we fall back to the existing C path (KieAI Kling i2v).
 */
function shouldUseTencentBPath(videoModel: string): boolean {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed) return false
  if (parsed.provider !== 'tencent-vod') return false
  // Kling-3.0-Omni / Kling-3.0 / Kling-O1 all support multi_shot=intelligence.
  return /^Kling-(3|O1)/i.test(parsed.modelId)
}

export async function handleMultiShotVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const { projectId, userId } = job.data

  const logger = createScopedLogger({
    module: 'worker.multi-shot-video',
    action: 'multi_shot_video_generate',
  })

  const panelIds = payload.panelIds as string[]
  const videoModel = payload.videoModel as string
  const mode = (payload.mode as 'std' | 'pro') || undefined
  const sound = typeof payload.sound === 'boolean' ? payload.sound : undefined
  const aspectRatio = (payload.aspectRatio as string) || undefined
  // B-path-only multi-shot mode (intelligence vs customize). Named
  // distinctly from `mode` above (Kling resolution std/pro) to avoid
  // collision in payload validation.
  const multiShotMode =
    payload.multiShotMode === 'customize' ? 'customize'
      : payload.multiShotMode === 'intelligence' ? 'intelligence'
        : undefined
  // Optional per-shot durations matching panelIds order. Validated again
  // in distributeShotDurations; we only screen the shape here.
  const panelDurations = Array.isArray(payload.panelDurations)
    && (payload.panelDurations as unknown[]).every((d) => typeof d === 'number')
    ? (payload.panelDurations as number[])
    : undefined
  // Optional caller-supplied prompt that bypasses panel concatenation
  // in intelligence mode (Seedance-style 5-element 15s segment).
  const rawPrompt = typeof payload.rawPrompt === 'string' && payload.rawPrompt.trim()
    ? payload.rawPrompt.trim()
    : undefined
  // Intelligence-mode prompt style. Default 'panel-numbered' applied
  // in the worker when undefined (10s tight cuts — best for action).
  // 'auto-seedance' is the explicit opt-in for dialogue/narrative
  // scenes (15s soft cuts).
  const promptStyle =
    payload.promptStyle === 'auto-seedance' || payload.promptStyle === 'panel-numbered'
      ? payload.promptStyle
      : undefined
  // Optional per-call entity overrides (UI's "swap costume / swap
  // scene view" affordance). Worker validates entities exist; we just
  // shape-check here.
  const characterOverrides = Array.isArray(payload.characterOverrides)
    ? (payload.characterOverrides as unknown[])
        .filter((o): o is { characterId: string; appearanceId?: string } => {
          if (!o || typeof o !== 'object') return false
          const r = o as Record<string, unknown>
          return typeof r.characterId === 'string' && r.characterId.length > 0
            && (r.appearanceId === undefined || typeof r.appearanceId === 'string')
        })
    : undefined
  const locationOverrides = Array.isArray(payload.locationOverrides)
    ? (payload.locationOverrides as unknown[])
        .filter((o): o is { locationId: string; viewName?: string } => {
          if (!o || typeof o !== 'object') return false
          const r = o as Record<string, unknown>
          return typeof r.locationId === 'string' && r.locationId.length > 0
            && (r.viewName === undefined || typeof r.viewName === 'string')
        })
    : undefined

  // 2026-05-13 — Option B 首幀鎖定 fields. Forwarded verbatim to
  // runMultiShotBPath which switches to Kling 3.0 i2v single-shot
  // when firstFrameImageUrl is present.
  const firstFrameImageUrl =
    typeof payload.firstFrameImageUrl === 'string' && payload.firstFrameImageUrl.trim()
      ? payload.firstFrameImageUrl.trim()
      : undefined
  const lastFrameImageUrl =
    typeof payload.lastFrameImageUrl === 'string' && payload.lastFrameImageUrl.trim()
      ? payload.lastFrameImageUrl.trim()
      : undefined

  // Phase E (2026-05-15) — per-group curated style override. Empty string
  // / missing = inherit project setting (worker falls back to
  // resolveProjectVisualStyle). Provided id wins over project default.
  const visualStyleId =
    typeof payload.visualStyleId === 'string' && payload.visualStyleId.trim()
      ? payload.visualStyleId.trim()
      : undefined
  const lightingPresetId =
    typeof payload.lightingPresetId === 'string' && payload.lightingPresetId.trim()
      ? payload.lightingPresetId.trim()
      : undefined

  if (!Array.isArray(panelIds) || panelIds.length < 2) {
    throw new Error('MULTI_SHOT_PANEL_IDS_INVALID')
  }

  const useBPath = shouldUseTencentBPath(videoModel)
  const useSeedanceComposite = shouldUseSeedanceComposite(videoModel)

  await reportTaskProgress(job, 5, { stage: 'load_panels' })

  // 1. 按 panelIds 順序載入 panels
  const panels = await Promise.all(
    panelIds.map((id) =>
      prisma.novelPromotionPanel.findUnique({
        where: { id },
        select: {
          id: true,
          description: true,
          videoPrompt: true,
          characters: true,
          // Phase 11.3 Stage 2 — panel.props JSON so b-path can match
          // against projectData.props and add prop ref images.
          props: true,
          location: true,
          shotType: true,
          cameraMove: true,
          imageUrl: true,
          storyboardId: true,
          // 2026-05-01: pull user-edited dialogue so the b-path
          // handler can prefer it over the auto-extracted voiceLines.
          srtSegment: true,
        },
      }),
    ),
  )

  for (let i = 0; i < panels.length; i++) {
    if (!panels[i]) throw new Error(`Panel not found: ${panelIds[i]}`)
    // C path + Seedance composite require imageUrl. B path is t2v so
    // panels can be text-only — skip the imageUrl check there only.
    if (!useBPath && !panels[i]!.imageUrl) {
      throw new Error(`Panel ${panelIds[i]} has no imageUrl`)
    }
  }

  const validPanels = panels as NonNullable<(typeof panels)[number]>[]

  // ─────────────────── SEEDANCE COMPOSITE PATH ───────────────────
  // Single composite video (4-15s) built from up to 9 panel images as
  // BobAPI @N references. Runs before B/C path so the rest of the
  // handler (character collection / KlingElement build) stays Kling-
  // specific. See multi-shot-video-seedance-path.ts.
  if (useSeedanceComposite) {
    await reportTaskProgress(job, 15, { stage: 'seedance_composite_start' })
    return await runMultiShotSeedanceComposite({
      job,
      validPanels,
      videoModel,
      sound,
      aspectRatio,
    })
  }

  await reportTaskProgress(job, 15, { stage: 'collect_characters' })

  const projectData = await resolveNovelData(projectId)

  // ──────────────────────────── B PATH ────────────────────────────
  // Tencent VOD Kling Omni — t2v with multi_shot=intelligence + SubjectInfos.
  // See multi-shot-video-b-path.ts for the full implementation.
  if (useBPath) {
    // resolveNovelData returns Locations via prisma include, which always
    // carries `id` on the row even though the shared NovelProjectData
    // interface in image-task-handler-shared.ts does not surface it
    // (kept narrow there for the image handlers that don't need it).
    // Cast through unknown to avoid widening the shared type — the
    // runtime shape is correct and B-path needs the id for bindings.
    const bPathProjectData = projectData as unknown as Parameters<typeof runMultiShotBPath>[0]['projectData']
    return await runMultiShotBPath({
      job,
      validPanels,
      projectData: bPathProjectData,
      videoModel,
      sound,
      aspectRatio,
      ...(multiShotMode ? { multiShotMode } : {}),
      ...(panelDurations ? { panelDurations } : {}),
      ...(rawPrompt ? { rawPrompt } : {}),
      ...(promptStyle ? { promptStyle } : {}),
      ...(characterOverrides && characterOverrides.length > 0 ? { characterOverrides } : {}),
      ...(locationOverrides && locationOverrides.length > 0 ? { locationOverrides } : {}),
      ...(firstFrameImageUrl ? { firstFrameImageUrl } : {}),
      ...(lastFrameImageUrl ? { lastFrameImageUrl } : {}),
      ...(visualStyleId ? { visualStyleId } : {}),
      ...(lightingPresetId ? { lightingPresetId } : {}),
    })
  }

  // ──────────────────────────── C PATH ────────────────────────────
  // KieAI Kling i2v — uses each panel's generated image as first frame.
  // Existing implementation. No changes below.

  // 2. 收集角色，去重後構建 kling_elements
  const seenCharacters = new Map<string, KlingElement>()

  for (const panel of validPanels) {
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      if (seenCharacters.has(ref.name.toLowerCase())) continue

      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue

      const appearances = character.appearances || []
      let appearance = appearances[0]
      if (ref.appearance) {
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

      const elementName = `element_${sanitizeName(ref.name)}`
      seenCharacters.set(ref.name.toLowerCase(), {
        name: elementName,
        description: ref.name,
        imageUrls: [publicUrl],
      })
    }
  }

  // KieAI 图片尺寸限制：缩小超尺寸的角色参考图
  const rawElements = Array.from(seenCharacters.values())
  const klingElements = await Promise.all(
    rawElements.map(async (el) => ({
      ...el,
      imageUrls: await Promise.all(
        el.imageUrls.map((url) => ensureImageWithinKieAILimits(url, `element-${el.name}`)),
      ),
    })),
  )

  await reportTaskProgress(job, 25, { stage: 'build_multi_prompt' })

  // 3. 構建 multi_prompt
  const multiPrompt: MultiShotPromptItem[] = validPanels.map((panel) => {
    const rawPrompt = panel.videoPrompt || panel.description || ''
    const prompt = klingElements.length > 0
      ? buildPromptWithElementRefs(rawPrompt, klingElements)
      : rawPrompt
    return {
      prompt,
      duration: 5,
    }
  })

  logger.info({
    message: 'Multi-shot video build complete',
    details: {
      shotCount: multiPrompt.length,
      elementCount: klingElements.length,
      elements: klingElements.map((e) => e.name),
    },
  })

  await reportTaskProgress(job, 30, { stage: 'submit_generation' })

  // 4. 提交 multi-shot 生成
  const generator = new KieAIKlingVideoGenerator()
  const result = await generator.generateMultiShot({
    userId,
    multiPrompt,
    klingElements: klingElements.length > 0 ? klingElements : undefined,
    options: {
      mode,
      sound,
      aspectRatio,
    },
  })

  if (!result.success || !result.externalId) {
    throw new Error(result.error || 'Multi-shot video generation failed')
  }

  logger.info({
    message: 'Multi-shot video task submitted',
    details: { externalId: result.externalId },
  })

  // 5. 輪詢等待完成
  const polled = await waitExternalResult(job, result.externalId, userId, {
    progressStart: 35,
    progressEnd: 90,
  })

  await assertTaskActive(job, 'persist_multi_shot_video')

  // 6. 上傳到 R2/COS
  const storyboardId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(polled.url, 'multi-shot-video', storyboardId)

  await reportTaskProgress(job, 95, { stage: 'persist' })

  // 7. 存入 storyboard — write both legacy and new array column for
  // uniform shape (C path doesn't chunk; always 1 clip).
  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  return {
    storyboardId,
    multiShotVideoUrl: cosKey,
    multiShotClipUrls: [cosKey],
    chunkCount: 1,
    shotCount: multiPrompt.length,
  }
}

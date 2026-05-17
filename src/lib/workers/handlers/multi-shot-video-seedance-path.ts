/**
 * Seedance "composite" path for multi-shot video.
 *
 * Semantically different from Kling multi-shot:
 *   - Kling B path: t2v + multi_shot=intelligence → N consecutive clips
 *     stitched into one ~25s narrative video.
 *   - Kling C path: i2v per panel → N chunks stitched into one video.
 *   - Seedance composite (here): a SINGLE 4-15s creative video that
 *     uses up to 9 of the group's panel images as `content[]`
 *     references (BobAPI @N reference scheme), letting the model
 *     decide camera motion / transitions between references.
 *
 * Provider scope: only `taijiai::seedance-2.0-720p` today. fal Seedance
 * variants have a flat i2v API (image_url + optional end_image_url),
 * not the 9-ref content[] composite endpoint, so they intentionally
 * stay multiShot=false in the variant registry — the picker greys out
 * 多鏡頭 when user lands on fal Seedance.
 *
 * Output mapping: ONE video → stored as the storyboard's
 * `multiShotVideoUrl` + single-element `multiShotClipUrls`. The
 * existing UI reads from these via `getMultiShotClipUrls()` and
 * renders the composite at the group level.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { TaijiaiSeedanceVideoGenerator } from '@/lib/generators/video/taijiai'
import { assertTaskActive, uploadVideoSourceToCos, waitExternalResult } from '../utils'
import { reportTaskProgress } from '../shared'
import { buildMultiShotClipUpdate } from '@/lib/storyboard/multi-shot-clips'
import { createScopedLogger } from '@/lib/logging/core'
import { parseModelKeyStrict } from '@/lib/model-config-contract'

/** BobAPI multi-ref cap: 9 images per the wiki Section 4.2. */
const MAX_REFERENCE_IMAGES = 9
/** Seedance 2.0 duration range per the wiki (also clamped by generator). */
const MIN_DURATION_SEC = 4
const MAX_DURATION_SEC = 15

interface PanelLite {
  id: string
  imageUrl: string | null
  description: string | null
  videoPrompt: string | null
  storyboardId: string
}

/**
 * True when this videoModel routes to Seedance composite (BobAPI @N
 * multi-ref). Used by the dispatcher in multi-shot-video-handler.ts.
 * Fails closed for everything else.
 */
export function shouldUseSeedanceComposite(videoModel: string): boolean {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed) return false
  // Only the BobAPI/taijiai Seedance variant carries the content[] @N
  // composite API surface. fal Seedance has a different flat API and
  // is handled (today) only on the single-shot per-panel path.
  return parsed.provider === 'taijiai' && /^seedance-2\.0/.test(parsed.modelId)
}

/**
 * Build a deterministic Seedance prompt from panel descriptions, using
 * @1..@N markers so the model knows which reference image corresponds
 * to which beat. Keeps each panel's contribution short (200 chars) to
 * avoid blowing past the model's text budget when the group is large.
 */
function buildSeedancePrompt(panels: PanelLite[]): string {
  const beats = panels.map((p, i) => {
    const raw = (p.videoPrompt || p.description || `分鏡 ${i + 1}`).trim()
    const trimmed = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
    return `@${i + 1}: ${trimmed}`
  })
  // Front-load the ordering directive so the model treats it as a
  // narrative sequence, not a moodboard. Tail directive nudges toward
  // smooth transitions instead of jump-cut collage.
  return (
    `按以下順序展現連續分鏡情境（每段約 1-2 秒銜接過渡）：\n` +
    beats.join('；\n') +
    `。\n` +
    `整體鏡頭運動自然順暢，由 @1 平順過渡到 @${panels.length}，` +
    `保持人物身份和場景連續性,避免硬切。`
  )
}

/**
 * Run the Seedance composite for a panel group. Caller (multi-shot-
 * video-handler) is responsible for loading + validating panels.
 *
 * Behaviour:
 *   - Slices to the first MAX_REFERENCE_IMAGES panels (BobAPI cap).
 *   - First panel image goes in as `first_frame`; the rest as
 *     `reference_image` with subject_type='generic' (the BobAPI
 *     generator handles the role + subject_type wiring).
 *   - Duration scales with panel count (4s + 1.5s per panel, capped
 *     at 15s) — gives the model enough runtime to actually transition
 *     between refs without blowing budget on a 2-panel group.
 *   - Output URL is uploaded to our COS so we don't depend on
 *     BobAPI's video_url longevity (it 302-redirects through their
 *     OSS which we mirror locally).
 *   - Persisted as `multiShotVideoUrl` + single-element
 *     `multiShotClipUrls` on the storyboard row.
 */
export async function runMultiShotSeedanceComposite(params: {
  job: Job<TaskJobData>
  validPanels: PanelLite[]
  videoModel: string
  // sound / aspectRatio mirror the handler's payload shape — both can be
  // undefined when the API caller omits them. We default in-handler so
  // the BobAPI call always receives a concrete value (audio defaults on,
  // ratio defaults to the project's natural ratio if known, else 16:9).
  sound: boolean | undefined
  aspectRatio: string | undefined
}): Promise<{ videoUrl: string }> {
  const { job, validPanels } = params
  const sound = params.sound ?? true
  const aspectRatio = params.aspectRatio ?? '16:9'
  const { userId } = job.data
  const logger = createScopedLogger({
    module: 'worker.multi-shot-seedance',
    action: 'multi_shot_seedance_composite',
  })

  if (validPanels.length === 0) {
    throw new Error('SEEDANCE_COMPOSITE_NO_PANELS')
  }

  const usedPanels = validPanels.slice(0, MAX_REFERENCE_IMAGES)
  const imageUrls = usedPanels
    .map((p) => p.imageUrl)
    .filter((u): u is string => !!u && u.trim().length > 0)

  if (imageUrls.length === 0) {
    throw new Error('SEEDANCE_COMPOSITE_NO_PANEL_IMAGES')
  }

  const prompt = buildSeedancePrompt(usedPanels)
  const duration = Math.max(
    MIN_DURATION_SEC,
    Math.min(MAX_DURATION_SEC, 4 + Math.ceil(imageUrls.length * 1.5)),
  )

  logger.info({
    message: 'Seedance composite submit',
    details: {
      storyboardId: validPanels[0].storyboardId,
      panelsRequested: validPanels.length,
      panelsUsed: usedPanels.length,
      imageRefs: imageUrls.length,
      duration,
      aspectRatio,
      generateAudio: sound,
      promptLength: prompt.length,
    },
  })

  await assertTaskActive(job, 'seedance_composite_submit')
  await reportTaskProgress(job, 20, { stage: 'seedance_composite_submit' })

  const generator = new TaijiaiSeedanceVideoGenerator()
  // imageUrl param is the first_frame on the BobAPI side; the rest of
  // the panel imageUrls go in via referenceImages (capped at 8 because
  // first_frame already consumes one slot of the 9-image budget).
  const generateResult = await generator.generate({
    userId,
    imageUrl: imageUrls[0],
    prompt,
    options: {
      modelId: 'seedance-2.0-720p',
      duration,
      aspectRatio,
      generateAudio: sound,
      referenceImages: imageUrls.slice(1),
    },
  })

  if (!generateResult.success || !generateResult.externalId) {
    throw new Error(
      `SEEDANCE_COMPOSITE_SUBMIT_FAILED: ${generateResult.error ?? 'unknown'}`,
    )
  }

  await reportTaskProgress(job, 40, { stage: 'seedance_composite_poll' })

  const polled = await waitExternalResult(job, generateResult.externalId, userId, {
    // Seedance 2.0 typical 60-180s; give it 10 min budget so cold
    // queues don't false-fail. Worker keeps reporting progress in the
    // 40-90 range automatically via waitExternalResult's interp.
    timeoutMs: 10 * 60 * 1000,
    progressStart: 40,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('SEEDANCE_COMPOSITE_NO_RESULT_URL')
  }

  await reportTaskProgress(job, 92, { stage: 'seedance_composite_persist' })

  // BobAPI video_url 302-redirects through vshare OSS with an
  // Authorization: Bearer requirement (see async-poll pollTaijiaiTask
  // and project_kuiperfilm_taijiai_seedance_blocked memory).
  // uploadVideoSourceToCos accepts downloadHeaders so the redirect
  // chain completes correctly.
  const targetId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(
    polled.url,
    `multi-shot-seedance/${targetId}`,
    targetId,
    polled.downloadHeaders,
  )

  await prisma.novelPromotionStoryboard.update({
    where: { id: targetId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  await reportTaskProgress(job, 98, { stage: 'seedance_composite_done' })

  logger.info({
    message: 'Seedance composite persisted',
    details: {
      storyboardId: targetId,
      cosKey,
      panelsUsed: usedPanels.length,
    },
  })

  return { videoUrl: cosKey }
}

/**
 * Phase 9.1 (2026-06-20) — Playground VIDEO generation worker handler.
 *
 * Now a standard Task-spine handler: wrapped by withTaskLifecycle in
 * video.worker.ts, it reads its params from the Task payload, dispatches to
 * whichever video generator the user picked (fal / atlascloud / bobapi /
 * ark), polls the external task to completion, uploads the result mp4 to
 * COS, and RETURNS the result. Lifecycle + billing (settle on success /
 * rollback on failure) are owned by withTaskLifecycle — not this handler.
 *
 * Pre-9.1 this bypassed the Task table and wrote a bespoke PlaygroundRun
 * row + a billing sidecar; see playground-image.ts for the migration note.
 */

import type { Job } from 'bullmq'
import { generateVideo } from '@/lib/generator-api'
import type { TaskJobData } from '@/lib/task/types'
import { uploadVideoSourceToCos, waitExternalResult, toSignedUrlIfCos } from '../utils'
import { extractVideoTailFrameToCos } from '@/lib/video-tail-frame'
import { replaceElementNamesWithTokens } from '@/lib/playground/element-tokens'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

export async function handlePlaygroundVideoTask(
  job: Job<TaskJobData>,
): Promise<Record<string, unknown>> {
  const { taskId, userId } = job.data
  const payload = (job.data.payload || {}) as Record<string, unknown>

  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
  const modelKey = typeof payload.modelKey === 'string' ? payload.modelKey : ''
  if (!prompt) throw new Error('PLAYGROUND_VIDEO_PROMPT_REQUIRED')
  if (!modelKey) throw new Error('PLAYGROUND_VIDEO_MODEL_REQUIRED')

  const referenceText = typeof payload.referenceText === 'string' ? payload.referenceText : ''
  const resolution = typeof payload.resolution === 'string' ? payload.resolution : null
  const aspectRatio = typeof payload.aspectRatio === 'string' ? payload.aspectRatio : null
  const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration)
    ? payload.duration
    : null

  const refImageKeys = parseStringArray(payload.referenceImages)
  const refVideoKeys = parseStringArray(payload.referenceVideos)
  const lastFrameKey = typeof payload.lastFrameUrl === 'string' ? payload.lastFrameUrl : ''
  const signedLastFrameUrl = lastFrameKey ? (toSignedUrlIfCos(lastFrameKey, 7200) ?? lastFrameKey) : ''
  const signedImageUrls = refImageKeys.map((k) => toSignedUrlIfCos(k, 7200) ?? k)
  const signedVideoUrls = refVideoKeys
    .map((k) => toSignedUrlIfCos(k, 7200))
    .filter((u): u is string => Boolean(u))

  // Kling O3 named-subject bindings (2026-07-10) — payload.elements:
  // [{ name, imageKeys[] }] (validated by the route). Sign each element's
  // image keys; the user typed subject NAMES in the prompt, so replace
  // them with the <<<element_N>>> tokens the Kling API binds on.
  const rawElements = Array.isArray(payload.elements) ? payload.elements : []
  const klingElements = rawElements
    .map((entry) => {
      const name = typeof (entry as { name?: unknown })?.name === 'string'
        ? (entry as { name: string }).name
        : ''
      const imageUrls = parseStringArray((entry as { imageKeys?: unknown })?.imageKeys)
        .map((k) => toSignedUrlIfCos(k, 7200) ?? k)
      return { name, imageUrls }
    })
    .filter((el) => el.name && el.imageUrls.length > 0)

  let effectivePrompt = referenceText
    ? `${prompt}\n\n[參考文字 / Style hint] ${referenceText}`
    : prompt
  if (klingElements.length > 0) {
    effectivePrompt = replaceElementNamesWithTokens(
      effectivePrompt,
      klingElements.map((el) => el.name),
    )
  }

  // i2v / r2v vendors take a leading image; pure t2v generators ignore it.
  const leadImageUrl = signedImageUrls[0] ?? ''
  // modelKey format: provider::modelId (e.g. atlascloud::kling-o3-pro-r2v)
  const isKlingO3ModelKey = /::kling-o3-/.test(modelKey)

  _ulogInfo(
    `[playground-video] start taskId=${taskId} model=${modelKey} refImages=${refImageKeys.length} refVideos=${refVideoKeys.length} elements=${klingElements.length}`,
  )

  // generateVideo's options interface is typed for scalar values but the
  // underlying generators accept array fields (referenceImages /
  // referenceVideos) for r2v endpoints — each vendor's switch unpacks them
  // into its schema. Cast bypasses the index-signature mismatch.
  const result = await generateVideo(userId, modelKey, leadImageUrl, {
    prompt: effectivePrompt,
    ...(duration ? { duration } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    // 首尾帧: the leading image is the first frame; this is the last frame.
    // Generators that support it (fal / Minimax / BobAPI) read lastFrameImageUrl
    // and switch to first-last-frame mode; others ignore the extra option.
    ...(signedLastFrameUrl ? { lastFrameImageUrl: signedLastFrameUrl } : {}),
    // Kling O3 consumes the FULL image set via `images` (its generator
    // ignores the imageUrl arg when referenceImages is present), so pass
    // everything — the slice(1) below exists for vendors whose lead image
    // rides the imageUrl arg and would otherwise be duplicated.
    ...(isKlingO3ModelKey
      ? (signedImageUrls.length > 0
        ? { referenceImages: signedImageUrls as unknown as string }
        : {})
      : (signedImageUrls.length > 1
        ? { referenceImages: signedImageUrls.slice(1) as unknown as string }
        : {})),
    ...(klingElements.length > 0
      ? { klingElements: klingElements as unknown as string }
      : {}),
    ...(signedVideoUrls.length > 0
      ? { referenceVideos: signedVideoUrls as unknown as string }
      : {}),
  })

  if (!result.success || !result.externalId) {
    const errMsg = result.error ?? 'video generation failed (no externalId)'
    _ulogError(`[playground-video] submit failed taskId=${taskId} err=${errMsg}`)
    throw new Error(`PLAYGROUND_VIDEO_SUBMIT_FAILED: ${errMsg}`)
  }

  const polled = await waitExternalResult(job as unknown as Job, result.externalId, userId, {
    timeoutMs: 15 * 60 * 1000,
    progressStart: 30,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('PLAYGROUND_VIDEO_NO_RESULT_URL')
  }

  const cosKey = await uploadVideoSourceToCos(
    polled.url,
    `playground-runs/${taskId}`,
    taskId,
    polled.downloadHeaders,
  )

  // 尾帧抽取(画布续镜链用)— 非致命:视频本体已成功,抽帧挂了只损失
  // 首尾帧接力便利,记 log 不抛。
  let tailFrameKey: string | null = null
  try {
    tailFrameKey = await extractVideoTailFrameToCos(cosKey, taskId)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    _ulogError(`[playground-video] tail-frame extract failed (non-fatal) taskId=${taskId} err=${errMsg}`)
  }

  _ulogInfo(`[playground-video] success taskId=${taskId} cosKey=${cosKey} tailFrame=${tailFrameKey ?? 'none'}`)

  return { resultUrls: [cosKey], ...(tailFrameKey ? { tailFrameKey } : {}) }
}

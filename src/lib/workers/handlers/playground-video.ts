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
import {
  getTaskExistingExternalId,
  uploadVideoSourceToCos,
  waitExternalResult,
  toSignedUrlIfCos,
} from '../utils'
import { extractVideoTailFrameToCos } from '@/lib/video-tail-frame'
import { buildRefImageMapSection, replaceElementNamesWithTokens } from '@/lib/playground/element-tokens'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { extractReferenceAudioToCos, muxGeneratedVideoWithSourceAudio } from '@/lib/playground/source-audio'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  isSeedanceReferenceNormalizationModel,
  normalizeSeedanceReferenceVideoToCos,
} from '@/lib/playground/seedance-reference-video'
import { filterAuthorizedStorageReferences } from '@/lib/playground/reference-guard'

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
  const normalizeSeedanceReferenceVideo = payload.normalizeSeedanceReferenceVideo === true
  let signedVideoUrls: string[]
  if (normalizeSeedanceReferenceVideo) {
    if (!isSeedanceReferenceNormalizationModel(modelKey)) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_MODEL_UNSUPPORTED')
    }
    if (refVideoKeys.length !== 1) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_REQUIRES_ONE_VIDEO')
    }
    const storageGuard = await filterAuthorizedStorageReferences(refVideoKeys, userId)
    if (storageGuard.safe.length !== 1 || storageGuard.rejected.length > 0) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_NOT_TRUSTED')
    }
    const sourceVideoUrl = toSignedUrlIfCos(storageGuard.safe[0], 7200)
    if (!sourceVideoUrl) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_SOURCE_URL_INVALID')
    }
    signedVideoUrls = [sourceVideoUrl]
  } else {
    signedVideoUrls = refVideoKeys
      .map((key) => toSignedUrlIfCos(key, 7200))
      .filter((url): url is string => Boolean(url))
  }
  const preserveSourceAudio = payload.preserveSourceAudio === true
  if (preserveSourceAudio && signedVideoUrls.length !== 1) {
    throw new Error('PLAYGROUND_SOURCE_AUDIO_REQUIRES_ONE_REFERENCE_VIDEO')
  }

  // Queue retries must resume the provider task already paid for. Read this
  // before local normalization/audio extraction so a transient polling
  // failure cannot repeat either preprocessing or generateVideo().
  const resumeExternalId = await getTaskExistingExternalId(taskId)
  if (normalizeSeedanceReferenceVideo && !resumeExternalId) {
    await reportTaskProgress(job, 8, {
      stage: 'normalize_seedance_reference_video',
      message: '正在將深度參考影片轉為 Seedance 相容格式',
    })
    const normalized = await normalizeSeedanceReferenceVideoToCos({
      sourceVideoUrl: signedVideoUrls[0],
      taskId,
      requireAudio: preserveSourceAudio,
    })
    if (preserveSourceAudio && !normalized.probe.hasAudio) {
      throw new Error('PLAYGROUND_SOURCE_AUDIO_TRACK_MISSING_AFTER_NORMALIZATION')
    }
    const normalizedUrl = toSignedUrlIfCos(normalized.cosKey, 7200)
    if (!normalizedUrl) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_URL_INVALID')
    }
    signedVideoUrls = [normalizedUrl]
  }
  let signedReferenceAudioUrl: string | null = null
  if (preserveSourceAudio && !resumeExternalId) {
    await reportTaskProgress(job, 12, { stage: 'extract_source_audio', message: '正在保留原始對白音軌' })
    const audioKey = await extractReferenceAudioToCos(signedVideoUrls[0], taskId)
    signedReferenceAudioUrl = toSignedUrlIfCos(audioKey, 7200)
    if (!signedReferenceAudioUrl) throw new Error('PLAYGROUND_SOURCE_AUDIO_URL_INVALID')
  }

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
  } else {
    // 參考圖命名 (2026-07-10) — Seedance-class r2v has no API-level named
    // binding, so named plain images get the storyboard-pipeline treatment:
    // a textual 參考圖對應 map prepended to the prompt (same convention as
    // buildR2vRefMapSection on the multi-shot path).
    const refImageNames = Array.isArray(payload.referenceImageNames)
      ? (payload.referenceImageNames as Array<string | null>)
      : []
    const mapSection = buildRefImageMapSection(refImageNames)
    if (mapSection) {
      effectivePrompt = `${mapSection}\n\n${effectivePrompt}`
    }
  }

  // i2v / r2v vendors take a leading image; pure t2v generators ignore it.
  const leadImageUrl = signedImageUrls[0] ?? ''
  // Vendors whose r2v endpoints consume the FULL ordered list via
  // referenceImages and NEVER merge the imageUrl arg back in (AtlasCloud
  // seedance r2v uses imageUrl only as an empty-list fallback; fal seedance
  // r2v reads image_urls exclusively). For them the slice(1) below silently
  // DROPPED the user's first upload AND shifted the 參考圖對應 map by one
  // (2026-07-12 review HIGH-A). taijiai/BobAPI re-adds imageUrl as slot 1,
  // so it keeps the lead-split. Their i2v endpoints read imageUrl only and
  // ignore referenceImages, so the full list is harmless there.
  const passFullImageList = /^(atlascloud|fal)::/.test(modelKey)

  _ulogInfo(
    `[playground-video] start taskId=${taskId} model=${modelKey} refImages=${refImageKeys.length} refVideos=${refVideoKeys.length} elements=${klingElements.length}`,
  )

  let externalId = resumeExternalId
  if (externalId) {
    _ulogInfo(`[playground-video] resume taskId=${taskId} externalId=${externalId}`)
  } else {
    // generateVideo's options interface is typed for scalar values but the
    // underlying generators accept array fields (referenceImages /
    // referenceVideos) for r2v endpoints — each vendor's switch unpacks them
    // into its schema. Cast bypasses the index-signature mismatch.
    const result = await generateVideo(userId, modelKey, leadImageUrl, {
      prompt: effectivePrompt,
      ...(duration ? { duration } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      // 🔊 audio toggle (2026-07-12) — absent = generator default (on).
      ...(typeof payload.generateAudio === 'boolean' ? { generateAudio: payload.generateAudio } : {}),
      // 首尾帧: the leading image is the first frame; this is the last frame.
      // Generators that support it (fal / Minimax / BobAPI) read lastFrameImageUrl
      // and switch to first-last-frame mode; others ignore the extra option.
      ...(signedLastFrameUrl ? { lastFrameImageUrl: signedLastFrameUrl } : {}),
      // Full ordered list for full-list vendors (incl. Kling O3); the
      // slice(1) branch remains for vendors whose lead image rides the
      // imageUrl arg and would otherwise be duplicated (taijiai/BobAPI).
      ...(passFullImageList
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
      ...(signedReferenceAudioUrl
        ? { referenceAudios: [signedReferenceAudioUrl] as unknown as string }
        : {}),
    })

    if (!result.success || !result.externalId) {
      const errMsg = result.error ?? 'video generation failed (no externalId)'
      _ulogError(`[playground-video] submit failed taskId=${taskId} err=${errMsg}`)
      throw new Error(`PLAYGROUND_VIDEO_SUBMIT_FAILED: ${errMsg}`)
    }
    externalId = result.externalId
  }
  if (!externalId) {
    throw new Error('PLAYGROUND_VIDEO_EXTERNAL_ID_REQUIRED')
  }

  const polled = await waitExternalResult(job as unknown as Job, externalId, userId, {
    timeoutMs: 15 * 60 * 1000,
    progressStart: 30,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('PLAYGROUND_VIDEO_NO_RESULT_URL')
  }

  const finalSource = preserveSourceAudio
    ? await muxGeneratedVideoWithSourceAudio({
        generatedVideoUrl: polled.url,
        generatedDownloadHeaders: polled.downloadHeaders,
        sourceVideoUrl: signedVideoUrls[0],
      })
    : polled.url
  const cosKey = await uploadVideoSourceToCos(
    finalSource,
    `playground-runs/${taskId}`,
    taskId,
    preserveSourceAudio ? undefined : polled.downloadHeaders,
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

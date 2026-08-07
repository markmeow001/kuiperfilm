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
import {
  extractReferenceAudioToCos,
  muxGeneratedVideoWithSourceAudio,
  stripGeneratedVideoAudio,
} from '@/lib/playground/source-audio'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  assertAtlasCloudSeedanceReferenceVideo,
  assertDepthRebuildGuideReferenceBindingsV2,
  DEPTH_REBUILD_GUIDE_HARD_REFERENCE_LIMIT_SEC,
  DEPTH_REBUILD_GUIDE_SOURCE_DURATION_TOLERANCE_SEC,
  isSeedanceReferenceNormalizationModel,
  normalizeSeedanceReferenceVideoToCos,
  parseDepthRebuildGuideContractV2,
  probeSeedanceReferenceVideoSource,
  resolveSeedanceReferenceTargetDimensions,
  type DepthRebuildGuideContractV2,
  type SeedanceReferenceSourceProbe,
  type SeedanceReferenceVideoProbe,
} from '@/lib/playground/seedance-reference-video'
import { filterAuthorizedStorageReferences } from '@/lib/playground/reference-guard'
import { isSourceAudioMode } from '@/lib/playground/source-audio-contract'
import { persistTaskExternalIdOrThrow } from '@/lib/task/service'

const JOB_EXTERNAL_ID_PERSIST_ATTEMPTS = 5

function jobProviderExternalId(job: Job<TaskJobData>): string | null {
  const value = job.data.providerExternalId?.trim()
  return value || null
}

async function persistProviderExternalIdToJob(
  job: Job<TaskJobData>,
  externalId: string,
): Promise<void> {
  const nextData: TaskJobData = {
    ...job.data,
    providerExternalId: externalId,
  }
  let lastError: unknown = null
  for (let attempt = 0; attempt < JOB_EXTERNAL_ID_PERSIST_ATTEMPTS; attempt += 1) {
    try {
      await job.updateData(nextData)
      return
    } catch (error) {
      lastError = error
      if (attempt + 1 < JOB_EXTERNAL_ID_PERSIST_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
      }
    }
  }
  throw new Error('PLAYGROUND_VIDEO_JOB_EXTERNAL_ID_PERSIST_FAILED', {
    cause: lastError,
  })
}

async function persistSubmittedProviderExternalId(
  job: Job<TaskJobData>,
  externalId: string,
): Promise<void> {
  let jobPersistenceError: unknown = null
  try {
    await persistProviderExternalIdToJob(job, externalId)
  } catch (error) {
    jobPersistenceError = error
  }

  try {
    await persistTaskExternalIdOrThrow(job.data.taskId, externalId)
  } catch (databaseError) {
    // If BullMQ persistence succeeded, stop now: the next retry will resume
    // from job.data and retry the database hand-off without re-submitting.
    if (!jobPersistenceError) {
      const retryableError = databaseError instanceof Error
        ? databaseError
        : new Error(String(databaseError))
      const errorWithCode = retryableError as Error & { code?: string }
      if (!errorWithCode.code) errorWithCode.code = 'WORKER_EXECUTION_ERROR'
      throw retryableError
    }
    throw new Error('PLAYGROUND_VIDEO_EXTERNAL_ID_DURABILITY_FAILED', {
      cause: databaseError,
    })
  }

  // Database persistence is independently durable, so a BullMQ write failure
  // does not open a duplicate-charge window once the DB write has succeeded.
  if (jobPersistenceError) {
    _ulogError(
      `[playground-video] BullMQ externalId checkpoint failed but DB checkpoint succeeded taskId=${job.data.taskId}`,
    )
  }
}
import { toFetchableUrl } from '@/lib/cos'
import {
  depthRebuildTimesEqual,
  isDepthRebuildSegmentIdentity,
} from '@/lib/live-composite/depth-rebuild-server-contract'

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

function parseReferenceVideoWindow(value: unknown): {
  startSeconds: number
  durationSeconds: number
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const startSeconds = record.startSeconds
  const durationSeconds = record.durationSeconds
  if (
    typeof startSeconds !== 'number'
    || !Number.isFinite(startSeconds)
    || startSeconds < 0
    || typeof durationSeconds !== 'number'
    || !Number.isFinite(durationSeconds)
    || durationSeconds < 4
    || durationSeconds > 7.5
    || startSeconds + durationSeconds > 15
  ) {
    return null
  }
  return { startSeconds, durationSeconds }
}

function assertAdaptiveGuideNormalizedReferences(
  contract: DepthRebuildGuideContractV2,
  probes: readonly SeedanceReferenceVideoProbe[],
  sourceProbes: {
    depth: SeedanceReferenceSourceProbe | null
    rgb: SeedanceReferenceSourceProbe | null
  },
): void {
  if (probes.length !== contract.referenceVideoWindows.length) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_COUNT_INVALID')
  }
  for (let index = 0; index < probes.length; index += 1) {
    const probe = probes[index]
    const window = contract.referenceVideoWindows[index]
    if (!probe || !window) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_COUNT_INVALID')
    }
    assertAtlasCloudSeedanceReferenceVideo(probe)
    if (probe.hasAudio) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_REFERENCE_AUDIO_PRESENT')
    }
    if (
      Math.abs(probe.durationSec - window.durationSeconds)
        > DEPTH_REBUILD_GUIDE_SOURCE_DURATION_TOLERANCE_SEC
    ) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_DURATION_MISMATCH')
    }
  }
  const totalDurationSeconds = probes.reduce(
    (sum, probe) => sum + probe.durationSec,
    0,
  )
  if (totalDurationSeconds > DEPTH_REBUILD_GUIDE_HARD_REFERENCE_LIMIT_SEC + 0.001) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_TOTAL_OVER_HARD_LIMIT')
  }
  if (!sourceProbes.depth || !sourceProbes.rgb) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_RAW_SOURCE_PROBE_MISSING')
  }
  const rgbSourceDuration = sourceProbes.rgb.durationSec
  if (
    typeof rgbSourceDuration !== 'number'
    || !Number.isFinite(rgbSourceDuration)
  ) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_RGB_SOURCE_DURATION_MISSING')
  }
  if (
    Math.abs(rgbSourceDuration - contract.sourceDurationSeconds)
      > DEPTH_REBUILD_GUIDE_SOURCE_DURATION_TOLERANCE_SEC
  ) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_RGB_SOURCE_DURATION_MISMATCH')
  }
  const rawDepthDuration = sourceProbes.depth.durationSec
  if (
    rawDepthDuration !== null
    && (
      typeof rawDepthDuration !== 'number'
      || !Number.isFinite(rawDepthDuration)
    )
  ) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_DEPTH_SOURCE_DURATION_INVALID')
  }
  if (
    rawDepthDuration !== null
    && Math.abs(rawDepthDuration - contract.sourceDurationSeconds)
      > DEPTH_REBUILD_GUIDE_SOURCE_DURATION_TOLERANCE_SEC
  ) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_DEPTH_SOURCE_DURATION_MISMATCH')
  }
  // MediaRecorder WebM may omit container duration. In that one case the
  // complete normalized Depth is the measurable duration proof; RGB must
  // still have a real raw-source duration and match the immutable contract.
  const verifiedDepthDuration = rawDepthDuration ?? probes[0]?.durationSec
  if (
    typeof verifiedDepthDuration !== 'number'
    || !Number.isFinite(verifiedDepthDuration)
    || Math.abs(verifiedDepthDuration - rgbSourceDuration)
      > DEPTH_REBUILD_GUIDE_SOURCE_DURATION_TOLERANCE_SEC
  ) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_SOURCE_DURATION_ALIGNMENT_MISMATCH')
  }
  if (probes.length === 2) {
    const [depthProbe, rgbProbe] = probes
    if (!depthProbe || !rgbProbe) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_COUNT_INVALID')
    }
    if (
      depthProbe.width !== rgbProbe.width
      || depthProbe.height !== rgbProbe.height
    ) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_GEOMETRY_MISMATCH')
    }
    if (Math.abs(depthProbe.fps - rgbProbe.fps) > 0.01) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_FPS_MISMATCH')
    }
  }
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
  const depthRebuildDualGuide = payload.depthRebuildDualGuide === true
  const depthRebuildGuideContract = payload.depthRebuildGuideContract === undefined
    ? null
    : parseDepthRebuildGuideContractV2(payload.depthRebuildGuideContract)
  if (depthRebuildGuideContract && depthRebuildDualGuide) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_CONTRACT_CONFLICT')
  }
  if (depthRebuildGuideContract) {
    if (payload.sourceVideoKey !== depthRebuildGuideContract.sourceVideoKey) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_SOURCE_KEY_MISMATCH')
    }
    assertDepthRebuildGuideReferenceBindingsV2(
      depthRebuildGuideContract,
      refVideoKeys,
    )
  }
  const referenceVideoWindow = parseReferenceVideoWindow(payload.referenceVideoWindow)
  const hasReferenceVideoWindow = Object.prototype.hasOwnProperty.call(
    payload,
    'referenceVideoWindow',
  )
  const hasDepthRebuildSegmentIdentity = Object.prototype.hasOwnProperty.call(payload, 'workflowId')
    || Object.prototype.hasOwnProperty.call(payload, 'segmentIndex')
    || Object.prototype.hasOwnProperty.call(payload, 'segmentCount')
  const depthRebuildSegmentIdentity = {
    workflowId: payload.workflowId,
    segmentIndex: payload.segmentIndex,
    segmentCount: payload.segmentCount,
  }
  let signedVideoUrls: string[]
  let signedSourceVideoUrl: string | null = null
  if (normalizeSeedanceReferenceVideo) {
    if (!isSeedanceReferenceNormalizationModel(modelKey)) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_MODEL_UNSUPPORTED')
    }
    const expectedReferenceCount = depthRebuildGuideContract
      ? depthRebuildGuideContract.referenceVideoWindows.length
      : depthRebuildDualGuide ? 2 : 1
    if (refVideoKeys.length !== expectedReferenceCount) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_COUNT_INVALID')
    }
    const storageKeys = depthRebuildGuideContract
      ? Array.from(new Set([
          ...refVideoKeys,
          depthRebuildGuideContract.sourceVideoKey,
        ]))
      : refVideoKeys
    const storageGuard = await filterAuthorizedStorageReferences(storageKeys, userId)
    if (storageGuard.safe.length !== storageKeys.length || storageGuard.rejected.length > 0) {
      throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_NOT_TRUSTED')
    }
    signedVideoUrls = refVideoKeys.map((key) => {
      const signedUrl = toSignedUrlIfCos(key, 7200)
      if (!signedUrl) throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_SOURCE_URL_INVALID')
      return signedUrl
    })
    if (depthRebuildGuideContract) {
      signedSourceVideoUrl = toSignedUrlIfCos(
        depthRebuildGuideContract.sourceVideoKey,
        7200,
      )
      if (!signedSourceVideoUrl) {
        throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_SOURCE_URL_INVALID')
      }
    }
  } else {
    signedVideoUrls = refVideoKeys
      .map((key) => toSignedUrlIfCos(key, 7200))
      .filter((url): url is string => Boolean(url))
  }
  const rawSourceAudioMode = payload.sourceAudioMode
  if (rawSourceAudioMode !== undefined && !isSourceAudioMode(rawSourceAudioMode)) {
    throw new Error('PLAYGROUND_SOURCE_AUDIO_MODE_INVALID')
  }
  const sourceAudioMode = isSourceAudioMode(rawSourceAudioMode)
    ? rawSourceAudioMode
    : null
  if (depthRebuildGuideContract) {
    if (
      normalizeSeedanceReferenceVideo !== true
      || sourceAudioMode === null
      || sourceAudioMode === 'preserve'
      || duration === null
      || !Number.isInteger(duration)
      || duration !== depthRebuildGuideContract.outputDurationSeconds
      || !resolution
      || !aspectRatio
      || hasReferenceVideoWindow
      || hasDepthRebuildSegmentIdentity
      || Object.prototype.hasOwnProperty.call(payload, 'preserveSourceAudio')
      || Object.prototype.hasOwnProperty.call(payload, 'generateAudio')
    ) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_CONTRACT_INVALID')
    }
  } else if (depthRebuildDualGuide) {
    if (
      sourceAudioMode === null
      || sourceAudioMode === 'preserve'
      || !referenceVideoWindow
      || !isDepthRebuildSegmentIdentity(depthRebuildSegmentIdentity)
      || duration === null
      || !depthRebuildTimesEqual(duration, referenceVideoWindow.durationSeconds)
      || !resolution
      || !aspectRatio
    ) {
      throw new Error('PLAYGROUND_DEPTH_REBUILD_DUAL_GUIDE_CONTRACT_INVALID')
    }
  } else if (hasDepthRebuildSegmentIdentity) {
    throw new Error('PLAYGROUND_DEPTH_REBUILD_SEGMENT_IDENTITY_REQUIRES_DUAL_GUIDE')
  }
  if (
    sourceAudioMode !== null
    && (
      Object.prototype.hasOwnProperty.call(payload, 'preserveSourceAudio')
      || Object.prototype.hasOwnProperty.call(payload, 'generateAudio')
    )
  ) {
    throw new Error('PLAYGROUND_SOURCE_AUDIO_MODE_LEGACY_FLAGS_CONFLICT')
  }
  if (sourceAudioMode !== null && normalizeSeedanceReferenceVideo !== true) {
    throw new Error('PLAYGROUND_SOURCE_AUDIO_MODE_REQUIRES_NORMALIZATION')
  }
  const preserveSourceAudio = sourceAudioMode === 'preserve'
    || (sourceAudioMode === null && payload.preserveSourceAudio === true)
  const referenceSourceAudio = preserveSourceAudio || sourceAudioMode === 'reference-only'
  const stripFinalAudio = sourceAudioMode === 'reference-only'
  const expectedAudioContractVideoCount = depthRebuildGuideContract
    ? depthRebuildGuideContract.referenceVideoWindows.length
    : depthRebuildDualGuide ? 2 : 1
  if (
    (referenceSourceAudio || sourceAudioMode === 'generate')
    && signedVideoUrls.length !== expectedAudioContractVideoCount
  ) {
    throw new Error('PLAYGROUND_SOURCE_AUDIO_REFERENCE_COUNT_INVALID')
  }

  // Queue retries must resume the provider task already paid for. Read this
  // before local normalization/audio extraction so a transient polling
  // failure cannot repeat either preprocessing or generateVideo().
  const resumeJobExternalId = jobProviderExternalId(job)
  const resumeExternalId = resumeJobExternalId ?? await getTaskExistingExternalId(taskId)
  if (resumeJobExternalId) {
    // A previous attempt reached the provider while the DB was unavailable.
    // Repair the DB checkpoint before doing any preprocessing or polling.
    await persistTaskExternalIdOrThrow(taskId, resumeJobExternalId)
  }
  if (normalizeSeedanceReferenceVideo && !resumeExternalId) {
    await reportTaskProgress(job, 8, {
      stage: 'normalize_seedance_reference_video',
      message: depthRebuildGuideContract
        ? '正在依 Depth Rebuild v2 的獨立時間窗正規化完整 Depth 與可選 RGB'
        : depthRebuildDualGuide
          ? '正在同步裁切 RGB 原片與 Depth，並轉為 Seedance 相容格式'
        : '正在將參考影片轉為 Seedance 相容格式',
    })
    if (depthRebuildGuideContract) {
      if (!signedSourceVideoUrl) {
        throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_SOURCE_URL_INVALID')
      }
      const rgbSourceProbeForTarget = await probeSeedanceReferenceVideoSource(
        toFetchableUrl(signedSourceVideoUrl),
      )
      const targetDimensions = resolveSeedanceReferenceTargetDimensions(
        rgbSourceProbeForTarget.width,
        rgbSourceProbeForTarget.height,
      )
      const normalizedUrls: string[] = []
      const normalizedProbes: SeedanceReferenceVideoProbe[] = []
      let depthSourceProbe: SeedanceReferenceSourceProbe | null = null
      let rgbSourceProbe: SeedanceReferenceSourceProbe | null = rgbSourceProbeForTarget
      for (
        let index = 0;
        index < depthRebuildGuideContract.referenceVideoWindows.length;
        index += 1
      ) {
        const window = depthRebuildGuideContract.referenceVideoWindows[index]
        const sourceUrl = signedVideoUrls[index]
        if (!window || !sourceUrl) {
          throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_REFERENCE_COUNT_INVALID')
        }
        const normalized = await normalizeSeedanceReferenceVideoToCos({
          sourceVideoUrl: toFetchableUrl(sourceUrl),
          taskId,
          sourceAudioMode: 'generate',
          trim: {
            startSeconds: window.startSeconds,
            durationSeconds: window.durationSeconds,
          },
          outputId: window.role,
          targetDimensions,
        })
        const normalizedUrl = toSignedUrlIfCos(normalized.cosKey, 7200)
        if (!normalizedUrl) {
          throw new Error('PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZATION_URL_INVALID')
        }
        normalizedUrls.push(normalizedUrl)
        normalizedProbes.push(normalized.probe)
        if (window.role === 'depth') depthSourceProbe = normalized.sourceProbe
        else rgbSourceProbe = normalized.sourceProbe
      }
      assertAdaptiveGuideNormalizedReferences(
        depthRebuildGuideContract,
        normalizedProbes,
        { depth: depthSourceProbe, rgb: rgbSourceProbe },
      )
      signedVideoUrls = normalizedUrls
    } else {
      const normalizedRgb = await normalizeSeedanceReferenceVideoToCos({
        sourceVideoUrl: toFetchableUrl(signedVideoUrls[0]),
        taskId,
        requireAudio: referenceSourceAudio,
        ...(sourceAudioMode !== null ? { sourceAudioMode } : {}),
        ...(referenceVideoWindow ? { trim: referenceVideoWindow } : {}),
        ...(depthRebuildDualGuide ? { outputId: 'rgb' } : {}),
      })
      if (referenceSourceAudio && !normalizedRgb.probe.hasAudio) {
        throw new Error('PLAYGROUND_SOURCE_AUDIO_TRACK_MISSING_AFTER_NORMALIZATION')
      }
      if (sourceAudioMode === 'generate' && normalizedRgb.probe.hasAudio) {
        throw new Error('PLAYGROUND_SOURCE_AUDIO_TRACK_PRESENT_AFTER_NORMALIZATION')
      }
      const normalizedRgbUrl = toSignedUrlIfCos(normalizedRgb.cosKey, 7200)
      if (!normalizedRgbUrl) {
        throw new Error('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_URL_INVALID')
      }
      if (depthRebuildDualGuide) {
        const normalizedDepth = await normalizeSeedanceReferenceVideoToCos({
          sourceVideoUrl: toFetchableUrl(signedVideoUrls[1]),
          taskId,
          sourceAudioMode: 'generate',
          trim: referenceVideoWindow as { startSeconds: number; durationSeconds: number },
          outputId: 'depth',
        })
        if (normalizedDepth.probe.hasAudio) {
          throw new Error('PLAYGROUND_DEPTH_REFERENCE_AUDIO_TRACK_PRESENT')
        }
        const normalizedDepthUrl = toSignedUrlIfCos(normalizedDepth.cosKey, 7200)
        if (!normalizedDepthUrl) {
          throw new Error('PLAYGROUND_SEEDANCE_DEPTH_NORMALIZATION_URL_INVALID')
        }
        signedVideoUrls = [normalizedRgbUrl, normalizedDepthUrl]
      } else {
        signedVideoUrls = [normalizedRgbUrl]
      }
    }
  }
  let signedReferenceAudioUrl: string | null = null
  if (referenceSourceAudio && !resumeExternalId) {
    await reportTaskProgress(job, 12, { stage: 'extract_source_audio', message: '正在保留原始對白音軌' })
    const audioSourceUrl = depthRebuildGuideContract
      ? signedSourceVideoUrl
      : signedVideoUrls[0]
    if (!audioSourceUrl) {
      throw new Error('PLAYGROUND_SOURCE_AUDIO_URL_INVALID')
    }
    const audioKey = await extractReferenceAudioToCos(audioSourceUrl, taskId)
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
    `[playground-video] start taskId=${taskId} model=${modelKey} refImages=${refImageKeys.length} refVideos=${refVideoKeys.length} elements=${klingElements.length} sourceAudioMode=${sourceAudioMode ?? 'legacy'}`,
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
      // seedance-2.5 extras — non-supporting generators ignore the keys.
      ...(payload.outputFormat === 'mp4' || payload.outputFormat === 'mov'
        ? { outputFormat: payload.outputFormat }
        : {}),
      ...(typeof payload.watermark === 'boolean' ? { watermark: payload.watermark } : {}),
      ...(typeof payload.returnLastFrame === 'boolean' ? { returnLastFrame: payload.returnLastFrame } : {}),
      // New depth-rebuild runs use one explicit sourceAudioMode. Legacy
      // Playground runs omit it and retain the prior generateAudio behavior.
      ...(sourceAudioMode !== null
        ? { generateAudio: sourceAudioMode === 'generate' }
        : (typeof payload.generateAudio === 'boolean'
          ? { generateAudio: payload.generateAudio }
          : {})),
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
    // The provider request is already billable at this point. Persist its id
    // before entering any polling code so a worker crash/retry resumes the
    // same request instead of paying for a second submission.
    await persistSubmittedProviderExternalId(job, externalId)
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

  const preservedAudioSourceUrl = depthRebuildGuideContract
    ? signedSourceVideoUrl
    : signedVideoUrls[0]
  let finalSource: string | Buffer
  if (preserveSourceAudio) {
    if (!preservedAudioSourceUrl) {
      throw new Error('PLAYGROUND_SOURCE_AUDIO_URL_INVALID')
    }
    finalSource = await muxGeneratedVideoWithSourceAudio({
        generatedVideoUrl: polled.url,
        generatedDownloadHeaders: polled.downloadHeaders,
        sourceVideoUrl: preservedAudioSourceUrl,
      })
  } else if (stripFinalAudio) {
    finalSource = await stripGeneratedVideoAudio({
      generatedVideoUrl: polled.url,
      generatedDownloadHeaders: polled.downloadHeaders,
    })
  } else {
    finalSource = polled.url
  }
  const cosKey = await uploadVideoSourceToCos(
    finalSource,
    `playground-runs/${taskId}`,
    taskId,
    preserveSourceAudio || stripFinalAudio ? undefined : polled.downloadHeaders,
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

import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME, rateLimitAwareBackoff } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { TaskTerminatedError } from '@/lib/task/errors'
import { tryUpdateTaskProgress, updateTaskPayload } from '@/lib/task/service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import {
  assertTaskActive,
  ensureImageWithinKieAILimits,
  getProjectModels,
  resolveLipSyncVideoSource,
  resolveVideoSourceFromGeneration,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
} from './utils'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getProviderConfig } from '@/lib/api-config'
import { handleMultiShotVideoTask } from './handlers/multi-shot-video-handler'
import { handleVideoEditorRenderTask } from './handlers/video-editor-render'
import { handleEpisodePackageZipTask } from './handlers/episode-package-zip'
import {
  claimEpisodePackageCompletion,
  reconcileEpisodePackageTerminalState,
} from '@/lib/novel-promotion/episode-package-publication'
import { handlePlaygroundVideoTask } from './handlers/playground-video'
import { handleCanvasComposeVideoTask } from './handlers/canvas-compose-video'
import { handleCanvasStoryboardExportTask } from './handlers/canvas-storyboard-export'
import { loadStyleProfile } from '@/lib/style-profile/loader'
import { deleteCOSObject } from '@/lib/cos'
import {
  compareAndSetNovelPromotionPanelVideoFromBatchQuote,
  findNovelPromotionPanelByStoryboardIndexInProject,
  requireNovelPromotionPanelInProject,
  requireNovelPromotionVoiceLineInProject,
  updateNovelPromotionPanelInProject,
} from '@/lib/novel-promotion/project-scope'
import {
  isStoryboardBatchVideoPanelSourceCurrent,
  readStoryboardBatchVideoPanelSource,
  readStoryboardBatchVideoTaskIdentity,
} from '@/lib/novel-promotion/storyboard-batch-video-source'
import type { StoryboardBatchVideoPanelSource } from '@/lib/novel-promotion/storyboard-batch-video-quote'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type VideoGenerationMode = 'normal' | 'firstlastframe'
type PanelRecord = Awaited<ReturnType<typeof requireNovelPromotionPanelInProject>>
type PanelVideoPersistMarker = {
  kind: 'panel_video_persist'
  taskId: string
  panelId: string
  episodeId: string
  cosKey: string
  quotedSnapshot: StoryboardBatchVideoPanelSource
  generationMode: VideoGenerationMode
}

const PANEL_VIDEO_PERSIST_MARKER_KEY = 'panelVideoPersistMarker'

function hasStoredVideoOutput(panel: { videoUrl: string | null; videoMediaId: string | null }): boolean {
  return (
    (typeof panel.videoUrl === 'string' && panel.videoUrl.trim().length > 0)
    || (typeof panel.videoMediaId === 'string' && panel.videoMediaId.trim().length > 0)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSafePersistedStorageKey(value: string): boolean {
  return (
    value.length <= 1024
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes('..')
    && !value.includes('//')
    && !value.includes('\\')
  )
}

function readPanelVideoPersistMarker(value: unknown): PanelVideoPersistMarker | null {
  if (!isRecord(value) || value.kind !== 'panel_video_persist') return null
  const taskId = typeof value.taskId === 'string' ? value.taskId.trim() : ''
  const panelId = typeof value.panelId === 'string' ? value.panelId.trim() : ''
  const episodeId = typeof value.episodeId === 'string' ? value.episodeId.trim() : ''
  const cosKey = typeof value.cosKey === 'string' ? value.cosKey.trim() : ''
  const generationMode = value.generationMode
  const quotedSnapshot = readStoryboardBatchVideoPanelSource(value.quotedSnapshot)
  if (
    !taskId
    || !panelId
    || !episodeId
    || !cosKey
    || !isSafePersistedStorageKey(cosKey)
    || !quotedSnapshot
    || (generationMode !== 'normal' && generationMode !== 'firstlastframe')
  ) return null
  return {
    kind: 'panel_video_persist',
    taskId,
    panelId,
    episodeId,
    cosKey,
    quotedSnapshot,
    generationMode,
  }
}

function panelVideoPersistReconciliationRequired(cause: unknown): Error {
  return Object.assign(
    new Error('PANEL_VIDEO_PERSIST_RECONCILIATION_REQUIRED'),
    { code: 'EXTERNAL_ERROR', cause },
  )
}

function extractGenerationOptions(payload: AnyObj): VideoOptionMap {
  const fromEnvelope = payload.generationOptions
  if (!fromEnvelope || typeof fromEnvelope !== 'object' || Array.isArray(fromEnvelope)) {
    return {}
  }

  const next: VideoOptionMap = {}
  for (const [key, value] of Object.entries(fromEnvelope as Record<string, unknown>)) {
    if (key === 'aspectRatio') continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value
    }
  }
  return next
}

async function fetchPanelByStoryboardIndex(projectId: string, storyboardId: string, panelIndex: number) {
  return await findNovelPromotionPanelByStoryboardIndexInProject(projectId, storyboardId, panelIndex)
}

async function getPanelForVideoTask(job: Job<TaskJobData>) {
  if (job.data.targetType !== 'NovelPromotionPanel') {
    throw new Error('VIDEO_PANEL_TARGET_MISMATCH')
  }
  return await requireNovelPromotionPanelInProject(job.data.projectId, job.data.targetId)
}

async function readDurablePanelVideoPersistMarker(
  job: Job<TaskJobData>,
): Promise<PanelVideoPersistMarker | null> {
  const task = await prisma.task.findFirst({
    where: {
      id: job.data.taskId,
      userId: job.data.userId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId || null,
      type: TASK_TYPE.VIDEO_PANEL,
      targetType: 'NovelPromotionPanel',
      targetId: job.data.targetId,
    },
    select: { payload: true },
  })
  if (!task) throw new Error('VIDEO_PANEL_BATCH_TASK_SCOPE_MISMATCH')
  const durablePayload = isRecord(task.payload) ? task.payload : {}
  const rawMarker = durablePayload[PANEL_VIDEO_PERSIST_MARKER_KEY]
  if (rawMarker === undefined || rawMarker === null) return null
  const marker = readPanelVideoPersistMarker(rawMarker)
  if (!marker) throw new Error('VIDEO_PANEL_PERSIST_MARKER_INVALID')
  return marker
}

function assertPanelVideoPersistMarkerContext(
  marker: PanelVideoPersistMarker,
  job: Job<TaskJobData>,
  payload: AnyObj,
  quotedSource: StoryboardBatchVideoPanelSource,
) {
  const expectedMode: VideoGenerationMode = isRecord(payload.firstLastFrame)
    ? 'firstlastframe'
    : 'normal'
  if (
    marker.taskId !== job.data.taskId
    || marker.panelId !== job.data.targetId
    || marker.episodeId !== job.data.episodeId
    || marker.generationMode !== expectedMode
    || !isStoryboardBatchVideoPanelSourceCurrent(marker.quotedSnapshot, quotedSource)
  ) {
    throw new Error('VIDEO_PANEL_PERSIST_MARKER_CONTEXT_MISMATCH')
  }
}

async function clearPanelVideoPersistMarker(job: Job<TaskJobData>) {
  await updateTaskPayload(
    job.data.taskId,
    { [PANEL_VIDEO_PERSIST_MARKER_KEY]: null },
    { preserveExistingTopLevel: true },
  )
}

async function cleanupPanelVideoPersistUpload(
  job: Job<TaskJobData>,
  marker: PanelVideoPersistMarker,
) {
  await deleteCOSObject(marker.cosKey, { throwOnError: true })
  await clearPanelVideoPersistMarker(job)
}

async function reconcilePanelVideoPersistMarker(
  job: Job<TaskJobData>,
  marker: PanelVideoPersistMarker,
  panel: PanelRecord,
) {
  if (panel.storyboard.episodeId !== marker.episodeId) {
    throw panelVideoPersistReconciliationRequired(
      new Error('VIDEO_PANEL_TARGET_EPISODE_MISMATCH'),
    )
  }
  if (panel.videoUrl === marker.cosKey) {
    if (panel.videoGenerationMode !== marker.generationMode) {
      throw panelVideoPersistReconciliationRequired(
        new Error('VIDEO_PANEL_PERSIST_MODE_UNCONFIRMED'),
      )
    }
    return { panelId: panel.id, videoUrl: marker.cosKey }
  }

  await cleanupPanelVideoPersistUpload(job, marker)
  throw new Error('VIDEO_PANEL_BATCH_SOURCE_STALE')
}

async function generateVideoForPanel(
  job: Job<TaskJobData>,
  panel: PanelRecord,
  payload: AnyObj,
  modelId: string,
  projectVideoRatio: string | null | undefined,
  generationOptions: VideoOptionMap,
): Promise<{
  videoSource: string
  downloadHeaders: Record<string, string> | undefined
  generationMode: VideoGenerationMode
}> {
  if (!panel.imageUrl) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }

  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  const firstLastCustomPrompt = typeof firstLastFramePayload?.customPrompt === 'string' ? firstLastFramePayload.customPrompt : null
  const persistedFirstLastPrompt = firstLastFramePayload ? panel.firstLastFramePrompt : null
  const customPrompt = typeof payload.customPrompt === 'string' ? payload.customPrompt : null
  // 2026-05-30 — panel field tail flipped to description-first (was videoPrompt
  // ||description) for consistency with the R2V composite paths; description now
  // carries the rich five-element narrative. Custom/first-last prompt chain kept first.
  let prompt = firstLastCustomPrompt || persistedFirstLastPrompt || customPrompt || panel.description || panel.videoPrompt
  if (!prompt) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }

  // 将 srtSegment 中的对白附加到 prompt（根据 includeDialogue 开关决定）
  const includeDialogue = generationOptions.includeDialogue !== false
  delete generationOptions.includeDialogue
  if (includeDialogue && panel.srtSegment && typeof panel.srtSegment === 'string') {
    const dialogue = panel.srtSegment.trim()
    if (dialogue) {
      prompt = `${prompt}\n\n角色台词：${dialogue}`
    }
  } else if (!includeDialogue) {
    prompt = `${prompt}\n\nNo dialogue, no narration, no voiceover.`
  }

  const sourceImageUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
  if (!sourceImageUrl) {
    throw new Error(`Panel ${panel.id} image url invalid`)
  }

  let lastFrameImageUrl: string | undefined
  const generationMode: VideoGenerationMode = firstLastFramePayload ? 'firstlastframe' : 'normal'
  const requestedGenerateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  let model = modelId

  if (firstLastFramePayload) {
    model =
      typeof firstLastFramePayload.flModel === 'string' && firstLastFramePayload.flModel
        ? firstLastFramePayload.flModel
        : modelId
    const firstLastFrameCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
    if (firstLastFrameCapabilities?.video?.firstlastframe !== true) {
      throw new Error(`VIDEO_FIRSTLASTFRAME_MODEL_UNSUPPORTED: ${model}`)
    }
    if (
      typeof firstLastFramePayload.lastFrameStoryboardId === 'string' &&
      firstLastFramePayload.lastFrameStoryboardId &&
      firstLastFramePayload.lastFramePanelIndex !== undefined
    ) {
      const lastPanel = await fetchPanelByStoryboardIndex(
        job.data.projectId,
        firstLastFramePayload.lastFrameStoryboardId,
        Number(firstLastFramePayload.lastFramePanelIndex),
      )
      if (!lastPanel) throw new Error('Last-frame panel not found in task project')
      if (lastPanel.storyboard.episodeId !== panel.storyboard.episodeId) {
        throw new Error('Last-frame panel is outside target episode')
      }
      if (!lastPanel.imageUrl) throw new Error('Last-frame panel has no imageUrl')
      lastFrameImageUrl = toSignedUrlIfCos(lastPanel.imageUrl, 3600) || undefined
    }
  }

  // KieAI 图片尺寸限制：超过 4096px 或 10MB 会被拒绝
  const parsedModel = parseModelKeyStrict(model)
  const isKieAI = parsedModel?.provider === 'kieai' || parsedModel?.provider === 'kieai-kling'
  let finalImageUrl = sourceImageUrl
  let finalLastFrameUrl = lastFrameImageUrl
  if (isKieAI) {
    finalImageUrl = await ensureImageWithinKieAILimits(sourceImageUrl, panel.id)
    if (lastFrameImageUrl) {
      finalLastFrameUrl = await ensureImageWithinKieAILimits(lastFrameImageUrl, panel.id)
    }
  }

  // Phase 11.5 / Bug-4: chokepoint owns prepend + capability filter for video.
  // Handler passes raw prompt + raw styleProfile.
  const styleProfile = await loadStyleProfile(prisma, job.data.projectId)

  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: model,
    imageUrl: finalImageUrl,
    options: {
      prompt,
      ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
      ...generationOptions,
      generationMode,
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
      ...(finalLastFrameUrl ? { lastFrameImageUrl: finalLastFrameUrl } : {}),
    },
    styleProfile,
  })

  let downloadHeaders: Record<string, string> | undefined
  const videoSource = generatedVideo.url
  if (generatedVideo.downloadHeaders) {
    downloadHeaders = generatedVideo.downloadHeaders
  } else if (typeof videoSource === 'string') {
    const parsedModel = parseModelKeyStrict(model)
    const isGoogleDownloadUrl = videoSource.includes('generativelanguage.googleapis.com/')
      && videoSource.includes('/files/')
      && videoSource.includes(':download')
    if (parsedModel?.provider === 'google' && isGoogleDownloadUrl) {
      const { apiKey } = await getProviderConfig(job.data.userId, 'google')
      downloadHeaders = { 'x-goog-api-key': apiKey }
    }
  }

  return { videoSource, downloadHeaders, generationMode }
}

export async function handleVideoPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const isBatch = payload.all === true
  const hasBatchFields = payload.batchRunId !== undefined
    || payload.panelSourceSnapshot !== undefined
    || payload.batchGenerationIdentity !== undefined
  let quotedSource: StoryboardBatchVideoPanelSource | null = null
  if (isBatch) {
    const batchRunId = typeof payload.batchRunId === 'string' ? payload.batchRunId.trim() : ''
    const declaredIdentity = typeof payload.batchGenerationIdentity === 'string'
      ? payload.batchGenerationIdentity
      : ''
    quotedSource = readStoryboardBatchVideoPanelSource(payload.panelSourceSnapshot)
    if (
      !job.data.episodeId
      || !batchRunId
      || !declaredIdentity
      || !quotedSource
      || readStoryboardBatchVideoTaskIdentity(payload) !== declaredIdentity
      || (typeof quotedSource.videoUrl === 'string' && quotedSource.videoUrl.trim().length > 0)
      || (typeof quotedSource.videoMediaId === 'string' && quotedSource.videoMediaId.trim().length > 0)
    ) {
      throw new Error('VIDEO_PANEL_BATCH_CONTRACT_INVALID')
    }
  } else if (hasBatchFields) {
    throw new Error('VIDEO_PANEL_BATCH_CONTRACT_INVALID')
  }

  const pendingPersistMarker = isBatch
    ? await readDurablePanelVideoPersistMarker(job)
    : null
  const panel = await getPanelForVideoTask(job)
  if (job.data.episodeId && job.data.episodeId !== panel.storyboard.episodeId) {
    throw new Error('VIDEO_PANEL_TARGET_EPISODE_MISMATCH')
  }
  if (quotedSource) {
    if (pendingPersistMarker) {
      assertPanelVideoPersistMarkerContext(pendingPersistMarker, job, payload, quotedSource)
      return await reconcilePanelVideoPersistMarker(job, pendingPersistMarker, panel)
    }
    if (
      hasStoredVideoOutput(panel)
      || !isStoryboardBatchVideoPanelSourceCurrent(quotedSource, panel)
    ) {
      throw new Error('VIDEO_PANEL_BATCH_SOURCE_STALE')
    }
  }
  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)

  const modelId = typeof payload.videoModel === 'string' ? payload.videoModel.trim() : ''
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')

  const generationOptions = extractGenerationOptions(payload)

  await reportTaskProgress(job, 10, {
    stage: 'generate_panel_video',
    panelId: panel.id,
  })

  const { videoSource, downloadHeaders, generationMode } = await generateVideoForPanel(
    job,
    panel,
    payload,
    modelId,
    projectModels.videoRatio,
    generationOptions,
  )

  if (quotedSource) {
    const currentPanel = await requireNovelPromotionPanelInProject(job.data.projectId, panel.id)
    if (
      currentPanel.storyboard.episodeId !== panel.storyboard.episodeId
      || hasStoredVideoOutput(currentPanel)
      || !isStoryboardBatchVideoPanelSourceCurrent(quotedSource, currentPanel)
    ) {
      throw new Error('VIDEO_PANEL_BATCH_SOURCE_STALE')
    }
  }

  await assertTaskActive(job, 'upload_panel_video')

  const cosKey = await uploadVideoSourceToCos(
    videoSource,
    'panel-video',
    panel.id,
    downloadHeaders,
  )

  if (quotedSource) {
    const marker: PanelVideoPersistMarker = {
      kind: 'panel_video_persist',
      taskId: job.data.taskId,
      panelId: panel.id,
      episodeId: panel.storyboard.episodeId,
      cosKey,
      quotedSnapshot: quotedSource,
      generationMode,
    }
    let markerStored: boolean
    try {
      markerStored = await tryUpdateTaskProgress(job.data.taskId, 94, {
        [PANEL_VIDEO_PERSIST_MARKER_KEY]: marker,
      })
    } catch (markerError) {
      try {
        await cleanupPanelVideoPersistUpload(job, marker)
      } catch (cleanupError) {
        throw panelVideoPersistReconciliationRequired({ markerError, cleanupError })
      }
      throw markerError
    }
    if (!markerStored) {
      await cleanupPanelVideoPersistUpload(job, marker)
      throw new TaskTerminatedError(
        job.data.taskId,
        'Task terminated before panel video persistence marker was stored',
      )
    }

    try {
      await assertTaskActive(job, 'persist_panel_video')
    } catch (error) {
      await cleanupPanelVideoPersistUpload(job, marker)
      throw error
    }

    let persisted: boolean
    try {
      persisted = await compareAndSetNovelPromotionPanelVideoFromBatchQuote(
        job.data.projectId,
        panel.id,
        panel.storyboard.episodeId,
        quotedSource,
        { videoUrl: cosKey, videoGenerationMode: generationMode },
      )
    } catch (casError) {
      let currentPanel: PanelRecord
      try {
        currentPanel = await requireNovelPromotionPanelInProject(job.data.projectId, panel.id)
        if (currentPanel.storyboard.episodeId !== panel.storyboard.episodeId) {
          throw new Error('VIDEO_PANEL_TARGET_EPISODE_MISMATCH')
        }
      } catch (readError) {
        throw panelVideoPersistReconciliationRequired({ casError, readError })
      }
      return await reconcilePanelVideoPersistMarker(job, marker, currentPanel)
    }
    if (!persisted) {
      await cleanupPanelVideoPersistUpload(job, marker)
      throw new Error('VIDEO_PANEL_BATCH_SOURCE_STALE')
    }
  } else {
    await assertTaskActive(job, 'persist_panel_video')
    await updateNovelPromotionPanelInProject(job.data.projectId, panel.id, {
      videoUrl: cosKey,
      videoGenerationMode: generationMode,
    })
  }

  return {
    panelId: panel.id,
    videoUrl: cosKey,
  }
}

export async function handleLipSyncTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lipSyncModel = typeof payload.lipSyncModel === 'string' && payload.lipSyncModel.trim()
    ? payload.lipSyncModel.trim()
    : undefined

  if (job.data.targetType !== 'NovelPromotionPanel') {
    throw new Error('LIP_SYNC_TARGET_MISMATCH')
  }
  const panel = await requireNovelPromotionPanelInProject(job.data.projectId, job.data.targetId)
  if (job.data.episodeId && job.data.episodeId !== panel.storyboard.episodeId) {
    throw new Error('LIP_SYNC_TARGET_EPISODE_MISMATCH')
  }
  if (
    (typeof payload.storyboardId === 'string' && payload.storyboardId !== panel.storyboardId)
    || (payload.panelIndex !== undefined && Number(payload.panelIndex) !== panel.panelIndex)
  ) {
    throw new Error('LIP_SYNC_TARGET_MISMATCH')
  }

  if (!panel.videoUrl) throw new Error('Panel has no base video')

  const voiceLineId = typeof payload.voiceLineId === 'string' ? payload.voiceLineId : null
  if (!voiceLineId) throw new Error('Lip-sync task missing voiceLineId')

  const voiceLine = await requireNovelPromotionVoiceLineInProject(job.data.projectId, voiceLineId)
  if (voiceLine.episodeId !== panel.storyboard.episodeId) {
    throw new Error('LIP_SYNC_VOICE_EPISODE_MISMATCH')
  }
  if (!voiceLine.audioUrl) {
    throw new Error('Voice line or audioUrl not found')
  }

  const signedVideoUrl = toSignedUrlIfCos(panel.videoUrl, 7200)
  const signedAudioUrl = toSignedUrlIfCos(voiceLine.audioUrl, 7200)

  if (!signedVideoUrl || !signedAudioUrl) {
    throw new Error('Lip-sync input media url invalid')
  }

  await reportTaskProgress(job, 25, { stage: 'submit_lip_sync' })

  const source = await resolveLipSyncVideoSource(job, {
    userId: job.data.userId,
    videoUrl: signedVideoUrl,
    audioUrl: signedAudioUrl,
    modelKey: lipSyncModel,
  })

  await reportTaskProgress(job, 93, { stage: 'persist_lip_sync' })

  await assertTaskActive(job, 'persist_lip_sync_video')
  const currentPanel = await requireNovelPromotionPanelInProject(job.data.projectId, panel.id)
  if (currentPanel.storyboard.episodeId !== panel.storyboard.episodeId) {
    throw new Error('LIP_SYNC_TARGET_EPISODE_MISMATCH')
  }
  const cosKey = await uploadVideoSourceToCos(source, 'lip-sync', panel.id)

  await updateNovelPromotionPanelInProject(job.data.projectId, panel.id, {
    lipSyncVideoUrl: cosKey,
    lipSyncTaskId: null,
  })

  return {
    panelId: panel.id,
    voiceLineId,
    lipSyncVideoUrl: cosKey,
  }
}

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VIDEO_PANEL:
      return await handleVideoPanelTask(job)
    case TASK_TYPE.LIP_SYNC:
      return await handleLipSyncTask(job)
    case TASK_TYPE.VIDEO_MULTI_SHOT:
      return await handleMultiShotVideoTask(job)
    case TASK_TYPE.VIDEO_EDITOR_RENDER:
      return await handleVideoEditorRenderTask(job)
    case TASK_TYPE.EPISODE_STITCH_MP4:
      return await handleEpisodePackageZipTask(job)
    case TASK_TYPE.PLAYGROUND_VIDEO:
      return await handlePlaygroundVideoTask(job)
    case TASK_TYPE.CANVAS_COMPOSE_VIDEO:
      return await handleCanvasComposeVideoTask(job)
    case TASK_TYPE.CANVAS_STORYBOARD_EXPORT:
      return await handleCanvasStoryboardExportTask(job)
    default:
      throw new Error(`Unsupported video task type: ${job.data.type}`)
  }
}

export function createVideoWorker() {
  // Phase 9.1 (2026-06-20) — Playground video jobs now ride the unified
  // Task spine (projectId='playground' sentinel), so they flow through
  // withTaskLifecycle + processVideoTask like every other video task. The
  // old bespoke `type === 'playground_video'` bypass is gone.
  return new Worker<TaskJobData>(
    QUEUE_NAME.VIDEO,
    async (job) => {
      return await withTaskLifecycle(
        job,
        processVideoTask,
        job.data.type === TASK_TYPE.EPISODE_STITCH_MP4
          ? {
              completionClaim: async ({ result, billing }) =>
                await claimEpisodePackageCompletion(job, result, billing),
              terminalReconcile: async () =>
                await reconcileEpisodePackageTerminalState(job),
            }
          : undefined,
      )
    },
    {
      connection: queueRedis,
      // Default 2 — same Tencent VOD AIGC concurrency-quota constraint as the
      // image queue (Kling-3.0-Omni runs against the same per-account pool).
      // Override via QUEUE_CONCURRENCY_VIDEO once quota is raised.
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VIDEO || '2', 10) || 2,
      settings: {
        // Rate-limit-aware backoff: 60/120/240/480/600s for RATE_LIMIT,
        // 2/4/8/16/32s for everything else. See queues.ts.
        backoffStrategy: rateLimitAwareBackoff,
      },
    },
  )
}

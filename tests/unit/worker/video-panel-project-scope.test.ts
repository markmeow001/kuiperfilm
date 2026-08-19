import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const panelFixture = vi.hoisted(() => ({
  id: 'panel-1',
  storyboardId: 'storyboard-1',
  panelIndex: 0,
  imageUrl: 'images/panel-1.png',
  imageMediaId: null,
  videoUrl: 'video/panel-1.mp4' as string | null,
  videoMediaId: null as string | null,
  videoGenerationMode: 'normal' as string | null,
  description: 'hero walks through rain',
  videoPrompt: 'slow push in',
  firstLastFramePrompt: null,
  srtSegment: null,
  updatedAt: new Date('2026-08-10T10:00:00.000Z'),
  storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
}))

const projectScopeMock = vi.hoisted(() => ({
  requireNovelPromotionPanelInProject: vi.fn(async () => panelFixture),
  requireNovelPromotionVoiceLineInProject: vi.fn(async () => ({
    id: 'voice-1',
    episodeId: 'episode-1',
    audioUrl: 'audio/voice-1.mp3',
  })),
  findNovelPromotionPanelByStoryboardIndexInProject: vi.fn(
    async (): Promise<typeof panelFixture | null> => null,
  ),
  updateNovelPromotionPanelInProject: vi.fn(async () => undefined),
  compareAndSetNovelPromotionPanelVideoFromBatchQuote: vi.fn(async () => true),
}))

const cosMock = vi.hoisted(() => ({
  deleteCOSObject: vi.fn(async () => true),
}))

const taskPayloadState = vi.hoisted<{ value: Record<string, unknown> }>(() => ({ value: {} }))
const taskServiceMock = vi.hoisted(() => ({
  tryUpdateTaskProgress: vi.fn(async (
    _taskId: string,
    _progress: number,
    payload?: Record<string, unknown> | null,
  ) => {
    taskPayloadState.value = { ...taskPayloadState.value, ...(payload || {}) }
    return true
  }),
  updateTaskPayload: vi.fn(async (
    _taskId: string,
    payload: Record<string, unknown> | null,
  ) => {
    taskPayloadState.value = { ...taskPayloadState.value, ...(payload || {}) }
    return { id: 'task-video-1', payload: taskPayloadState.value }
  }),
}))

const workerUtilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  ensureImageWithinKieAILimits: vi.fn(async (url: string) => url),
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9' })),
  resolveLipSyncVideoSource: vi.fn(),
  resolveVideoSourceFromGeneration: vi.fn(async () => ({ url: 'https://provider.example/video.mp4' })),
  toSignedUrlIfCos: vi.fn((url: string | null) => url),
  uploadVideoSourceToCos: vi.fn(async () => 'video/panel-1.mp4'),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(async () => panelFixture),
    findFirst: vi.fn(async () => panelFixture),
    update: vi.fn(async () => ({})),
  },
  task: {
    findFirst: vi.fn(async () => ({
      id: 'task-video-1',
      status: 'processing',
      payload: taskPayloadState.value,
    })),
  },
}))

vi.mock('@/lib/novel-promotion/project-scope', () => projectScopeMock)
vi.mock('server-only', () => ({}))
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/workers/utils', () => workerUtilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/task/queues', () => ({ QUEUE_NAME: { VIDEO: 'video' }, rateLimitAwareBackoff: vi.fn() }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: vi.fn(async () => undefined),
  withTaskLifecycle: vi.fn(),
}))
vi.mock('@/lib/style-profile/loader', () => ({ loadStyleProfile: vi.fn(async () => null) }))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/api-config', () => ({ getProviderConfig: vi.fn(async () => ({ apiKey: 'test' })) }))
vi.mock('@/lib/workers/handlers/multi-shot-video-handler', () => ({ handleMultiShotVideoTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/video-editor-render', () => ({ handleVideoEditorRenderTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/episode-package-zip', () => ({ handleEpisodePackageZipTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/playground-video', () => ({ handlePlaygroundVideoTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/canvas-compose-video', () => ({ handleCanvasComposeVideoTask: vi.fn() }))
vi.mock('@/lib/workers/handlers/canvas-storyboard-export', () => ({ handleCanvasStoryboardExportTask: vi.fn() }))

import { handleLipSyncTask, handleVideoPanelTask } from '@/lib/workers/video.worker'
import {
  buildStoryboardBatchVideoGenerationIdentity,
  buildStoryboardBatchVideoPanelSource,
} from '@/lib/novel-promotion/storyboard-batch-video-source'

function makeBatchPanel(overrides: Partial<typeof panelFixture> = {}) {
  return {
    ...panelFixture,
    videoUrl: null,
    videoMediaId: null,
    ...overrides,
  }
}

function buildBatchPayload(panel = makeBatchPanel()) {
  const panelSourceSnapshot = buildStoryboardBatchVideoPanelSource(panel)
  return {
    all: true,
    batchRunId: 'batch-1',
    panelSourceSnapshot,
    batchGenerationIdentity: buildStoryboardBatchVideoGenerationIdentity({
      settings: { videoModel: 'fal::video-model' },
      source: panelSourceSnapshot,
    }),
  }
}

function buildJob(payload: Record<string, unknown> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-video-1',
      type: TASK_TYPE.VIDEO_PANEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: { videoModel: 'fal::video-model', ...payload },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function buildLipSyncJob(overrides: Partial<TaskJobData> = {}): Job<TaskJobData> {
  return {
    data: {
      ...buildJob().data,
      type: TASK_TYPE.LIP_SYNC,
      payload: {
        voiceLineId: 'voice-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        lipSyncModel: 'fal::lipsync-model',
      },
      ...overrides,
    },
  } as unknown as Job<TaskJobData>
}

describe('video panel worker project scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskPayloadState.value = {}
    projectScopeMock.requireNovelPromotionPanelInProject.mockReset().mockResolvedValue(panelFixture)
    projectScopeMock.requireNovelPromotionVoiceLineInProject.mockResolvedValue({
      id: 'voice-1',
      episodeId: 'episode-1',
      audioUrl: 'audio/voice-1.mp3',
    })
    projectScopeMock.findNovelPromotionPanelByStoryboardIndexInProject.mockResolvedValue(null)
    projectScopeMock.updateNovelPromotionPanelInProject.mockResolvedValue(undefined)
    projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote.mockReset().mockResolvedValue(true)
    cosMock.deleteCOSObject.mockResolvedValue(true)
    taskServiceMock.tryUpdateTaskProgress.mockReset().mockImplementation(async (
      _taskId: string,
      _progress: number,
      payload?: Record<string, unknown> | null,
    ) => {
      taskPayloadState.value = { ...taskPayloadState.value, ...(payload || {}) }
      return true
    })
    taskServiceMock.updateTaskPayload.mockReset().mockImplementation(async (
      _taskId: string,
      payload: Record<string, unknown> | null,
    ) => {
      taskPayloadState.value = { ...taskPayloadState.value, ...(payload || {}) }
      return { id: 'task-video-1', payload: taskPayloadState.value }
    })
    prismaMock.task.findFirst.mockReset().mockImplementation(async () => ({
      id: 'task-video-1',
      status: 'processing',
      payload: taskPayloadState.value,
    }))
    workerUtilsMock.assertTaskActive.mockReset().mockResolvedValue(undefined)
    workerUtilsMock.resolveVideoSourceFromGeneration.mockResolvedValue({
      url: 'https://provider.example/video.mp4',
    })
    workerUtilsMock.uploadVideoSourceToCos.mockResolvedValue('video/panel-1.mp4')
  })

  it('forged project/target mismatch fails before provider', async () => {
    projectScopeMock.requireNovelPromotionPanelInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handleVideoPanelTask(buildJob()))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
  })

  it('non-panel durable target fails before lookup or provider', async () => {
    const job = buildJob()
    job.data.targetType = 'NovelPromotionStoryboard'

    await expect(handleVideoPanelTask(job)).rejects.toThrow('VIDEO_PANEL_TARGET_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionPanelInProject).not.toHaveBeenCalled()
    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
  })

  it('job episode must match the scoped panel episode', async () => {
    const job = buildJob()
    job.data.episodeId = 'episode-2'

    await expect(handleVideoPanelTask(job)).rejects.toThrow('VIDEO_PANEL_TARGET_EPISODE_MISMATCH')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
  })

  it('batch job source/output race fails before provider', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject.mockResolvedValueOnce({
      ...quotedPanel,
      videoUrl: 'video/raced.mp4',
      updatedAt: new Date('2026-08-10T10:01:00.000Z'),
    })

    await expect(handleVideoPanelTask(buildJob(buildBatchPayload(quotedPanel))))
      .rejects.toThrow('VIDEO_PANEL_BATCH_SOURCE_STALE')

    expect(workerUtilsMock.getProjectModels).not.toHaveBeenCalled()
    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('legacy/reconciled all:true payload without a complete signed batch contract fails before provider', async () => {
    projectScopeMock.requireNovelPromotionPanelInProject.mockResolvedValueOnce(makeBatchPanel())

    await expect(handleVideoPanelTask(buildJob({ all: true })))
      .rejects.toThrow('VIDEO_PANEL_BATCH_CONTRACT_INVALID')

    expect(workerUtilsMock.getProjectModels).not.toHaveBeenCalled()
    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
  })

  it('all:true payload with a forged batch identity fails before provider', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject.mockResolvedValueOnce(quotedPanel)

    await expect(handleVideoPanelTask(buildJob({
      ...buildBatchPayload(quotedPanel),
      batchGenerationIdentity: 'forged-identity',
    }))).rejects.toThrow('VIDEO_PANEL_BATCH_CONTRACT_INVALID')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
  })

  it('batch source/output mutation after provider returns stops before upload or persistence', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject
      .mockResolvedValueOnce(quotedPanel)
      .mockResolvedValueOnce({
        ...quotedPanel,
        updatedAt: new Date('2026-08-10T10:01:00.000Z'),
      })

    await expect(handleVideoPanelTask(buildJob(buildBatchPayload(quotedPanel))))
      .rejects.toThrow('VIDEO_PANEL_BATCH_SOURCE_STALE')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
    expect(projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
  })

  it('batch persistence race after upload uses CAS, never overwrites, and deletes the orphan upload', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject.mockResolvedValue(quotedPanel)
    projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote.mockResolvedValueOnce(false)

    await expect(handleVideoPanelTask(buildJob(buildBatchPayload(quotedPanel))))
      .rejects.toThrow('VIDEO_PANEL_BATCH_SOURCE_STALE')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(workerUtilsMock.uploadVideoSourceToCos).toHaveBeenCalledTimes(1)
    expect(projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote).toHaveBeenCalledWith(
      'project-1',
      'panel-1',
      'episode-1',
      buildBatchPayload(quotedPanel).panelSourceSnapshot,
      { videoUrl: 'video/panel-1.mp4', videoGenerationMode: 'normal' },
    )
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(
      'video/panel-1.mp4',
      { throwOnError: true },
    )
  })

  it('cancellation observed after upload deletes the exact upload, clears the marker, and never CAS-persists', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject.mockResolvedValue(quotedPanel)
    workerUtilsMock.assertTaskActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Task terminated during persist_panel_video'))

    await expect(handleVideoPanelTask(buildJob(buildBatchPayload(quotedPanel))))
      .rejects.toThrow('Task terminated')

    expect(workerUtilsMock.uploadVideoSourceToCos).toHaveBeenCalledTimes(1)
    expect(workerUtilsMock.assertTaskActive.mock.invocationCallOrder[0])
      .toBeLessThan(workerUtilsMock.uploadVideoSourceToCos.mock.invocationCallOrder[0])
    expect(taskServiceMock.tryUpdateTaskProgress).toHaveBeenCalledWith(
      'task-video-1',
      expect.any(Number),
      { panelVideoPersistMarker: expect.objectContaining({
        kind: 'panel_video_persist',
        taskId: 'task-video-1',
        panelId: 'panel-1',
        episodeId: 'episode-1',
        cosKey: 'video/panel-1.mp4',
        generationMode: 'normal',
      }) },
    )
    expect(projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote).not.toHaveBeenCalled()
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith('video/panel-1.mp4', { throwOnError: true })
    expect(taskPayloadState.value.panelVideoPersistMarker).toBeNull()
  })

  it('CAS success retains a durable witness and same-task retry skips provider and upload', async () => {
    const quotedPanel = makeBatchPanel()
    const committedPanel = {
      ...quotedPanel,
      videoUrl: 'video/panel-1.mp4',
      videoGenerationMode: 'normal',
      updatedAt: new Date('2026-08-10T10:02:00.000Z'),
    }
    projectScopeMock.requireNovelPromotionPanelInProject
      .mockResolvedValueOnce(quotedPanel)
      .mockResolvedValueOnce(quotedPanel)
      .mockResolvedValueOnce(committedPanel)
    const job = buildJob(buildBatchPayload(quotedPanel))

    await expect(handleVideoPanelTask(job))
      .resolves.toEqual({ panelId: 'panel-1', videoUrl: 'video/panel-1.mp4' })

    const retainedMarker = taskPayloadState.value.panelVideoPersistMarker
    expect(retainedMarker).toEqual(expect.objectContaining({
      kind: 'panel_video_persist',
      taskId: 'task-video-1',
      panelId: 'panel-1',
      episodeId: 'episode-1',
      cosKey: 'video/panel-1.mp4',
      generationMode: 'normal',
    }))

    await expect(handleVideoPanelTask(job))
      .resolves.toEqual({ panelId: 'panel-1', videoUrl: 'video/panel-1.mp4' })

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(workerUtilsMock.uploadVideoSourceToCos).toHaveBeenCalledTimes(1)
    expect(projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(taskServiceMock.updateTaskPayload).not.toHaveBeenCalled()
    expect(taskPayloadState.value.panelVideoPersistMarker).toEqual(retainedMarker)
  })

  it('successful CAS never performs a fallible success-marker clear', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject.mockResolvedValue(quotedPanel)
    taskServiceMock.updateTaskPayload.mockRejectedValueOnce(new Error('clear response lost'))

    await expect(handleVideoPanelTask(buildJob(buildBatchPayload(quotedPanel))))
      .resolves.toEqual({ panelId: 'panel-1', videoUrl: 'video/panel-1.mp4' })

    expect(taskServiceMock.updateTaskPayload).not.toHaveBeenCalled()
    expect(taskPayloadState.value.panelVideoPersistMarker).toEqual(expect.objectContaining({
      kind: 'panel_video_persist',
      cosKey: 'video/panel-1.mp4',
      generationMode: 'normal',
    }))
  })

  it('CAS committed but response was lost -> scoped read confirms success and retains the witness without delete', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject
      .mockResolvedValueOnce(quotedPanel)
      .mockResolvedValueOnce(quotedPanel)
      .mockResolvedValueOnce({
        ...quotedPanel,
        videoUrl: 'video/panel-1.mp4',
        videoGenerationMode: 'normal',
        updatedAt: new Date('2026-08-10T10:02:00.000Z'),
      })
    projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote
      .mockRejectedValueOnce(new Error('database response lost'))

    await expect(handleVideoPanelTask(buildJob(buildBatchPayload(quotedPanel))))
      .resolves.toEqual({ panelId: 'panel-1', videoUrl: 'video/panel-1.mp4' })

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(taskServiceMock.updateTaskPayload).not.toHaveBeenCalled()
    expect(taskPayloadState.value.panelVideoPersistMarker).toEqual(expect.objectContaining({
      kind: 'panel_video_persist',
      cosKey: 'video/panel-1.mp4',
      generationMode: 'normal',
    }))
  })

  it('CAS threw and scoped read proves no commit -> deletes own key, clears marker, and fails', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject.mockResolvedValue(quotedPanel)
    projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote
      .mockRejectedValueOnce(new Error('database response lost'))

    await expect(handleVideoPanelTask(buildJob(buildBatchPayload(quotedPanel))))
      .rejects.toThrow('VIDEO_PANEL_BATCH_SOURCE_STALE')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith('video/panel-1.mp4', { throwOnError: true })
    expect(taskPayloadState.value.panelVideoPersistMarker).toBeNull()
  })

  it('CAS/read unavailable retains marker and same-task retry never calls provider or deletes blindly', async () => {
    const quotedPanel = makeBatchPanel()
    projectScopeMock.requireNovelPromotionPanelInProject
      .mockResolvedValueOnce(quotedPanel)
      .mockResolvedValueOnce(quotedPanel)
      .mockRejectedValueOnce(new Error('database read unavailable'))
      .mockRejectedValueOnce(new Error('database read still unavailable'))
    projectScopeMock.compareAndSetNovelPromotionPanelVideoFromBatchQuote
      .mockRejectedValueOnce(new Error('database response unknown'))
    const job = buildJob(buildBatchPayload(quotedPanel))

    await expect(handleVideoPanelTask(job))
      .rejects.toThrow('PANEL_VIDEO_PERSIST_RECONCILIATION_REQUIRED')
    const retainedMarker = taskPayloadState.value.panelVideoPersistMarker
    expect(retainedMarker).toEqual(expect.objectContaining({
      kind: 'panel_video_persist',
      cosKey: 'video/panel-1.mp4',
    }))
    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()

    await expect(handleVideoPanelTask(job)).rejects.toThrow('database read still unavailable')
    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(taskPayloadState.value.panelVideoPersistMarker).toEqual(retainedMarker)
  })

  it('foreign last-frame panel fails before provider', async () => {
    await expect(handleVideoPanelTask(buildJob({
      firstLastFrame: {
        flModel: 'fal::video-model',
        lastFrameStoryboardId: 'storyboard-foreign',
        lastFramePanelIndex: 0,
      },
    }))).rejects.toThrow('Last-frame panel not found in task project')

    expect(projectScopeMock.findNovelPromotionPanelByStoryboardIndexInProject)
      .toHaveBeenCalledWith('project-1', 'storyboard-foreign', 0)
    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('same-project last-frame from another episode fails before provider', async () => {
    projectScopeMock.findNovelPromotionPanelByStoryboardIndexInProject.mockResolvedValueOnce({
      ...panelFixture,
      id: 'panel-2',
      storyboardId: 'storyboard-2',
      storyboard: { id: 'storyboard-2', episodeId: 'episode-2' },
    })

    await expect(handleVideoPanelTask(buildJob({
      firstLastFrame: {
        flModel: 'fal::video-model',
        lastFrameStoryboardId: 'storyboard-2',
        lastFramePanelIndex: 0,
      },
    }))).rejects.toThrow('Last-frame panel is outside target episode')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('uses an atomic project-scoped update at persistence', async () => {
    projectScopeMock.updateNovelPromotionPanelInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handleVideoPanelTask(buildJob()))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(workerUtilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(projectScopeMock.updateNovelPromotionPanelInProject).toHaveBeenCalledWith(
      'project-1',
      'panel-1',
      { videoUrl: 'video/panel-1.mp4', videoGenerationMode: 'normal' },
    )
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('lip-sync rejects a forged target before any provider call', async () => {
    await expect(handleLipSyncTask(buildLipSyncJob({ targetType: 'NovelPromotionStoryboard' })))
      .rejects.toThrow('LIP_SYNC_TARGET_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionPanelInProject).not.toHaveBeenCalled()
    expect(workerUtilsMock.resolveLipSyncVideoSource).not.toHaveBeenCalled()
  })

  it('lip-sync rejects a foreign panel before voice or provider lookup', async () => {
    projectScopeMock.requireNovelPromotionPanelInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handleLipSyncTask(buildLipSyncJob()))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionVoiceLineInProject).not.toHaveBeenCalled()
    expect(workerUtilsMock.resolveLipSyncVideoSource).not.toHaveBeenCalled()
  })

  it('lip-sync job episode must match the scoped panel episode', async () => {
    await expect(handleLipSyncTask(buildLipSyncJob({ episodeId: 'episode-2' })))
      .rejects.toThrow('LIP_SYNC_TARGET_EPISODE_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionVoiceLineInProject).not.toHaveBeenCalled()
    expect(workerUtilsMock.resolveLipSyncVideoSource).not.toHaveBeenCalled()
  })

  it('lip-sync rejects a foreign voice line before provider', async () => {
    projectScopeMock.requireNovelPromotionVoiceLineInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handleLipSyncTask(buildLipSyncJob()))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(workerUtilsMock.resolveLipSyncVideoSource).not.toHaveBeenCalled()
    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
  })

  it('lip-sync rejects a voice line from another episode before provider', async () => {
    projectScopeMock.requireNovelPromotionVoiceLineInProject.mockResolvedValueOnce({
      id: 'voice-2',
      episodeId: 'episode-2',
      audioUrl: 'audio/voice-2.mp3',
    })

    await expect(handleLipSyncTask(buildLipSyncJob({
      payload: {
        voiceLineId: 'voice-2',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        lipSyncModel: 'fal::lipsync-model',
      },
    }))).rejects.toThrow('LIP_SYNC_VOICE_EPISODE_MISMATCH')

    expect(workerUtilsMock.resolveLipSyncVideoSource).not.toHaveBeenCalled()
  })

  it('lip-sync uses atomic project-scoped persistence', async () => {
    workerUtilsMock.resolveLipSyncVideoSource.mockResolvedValueOnce('https://provider.example/lipsync.mp4')
    projectScopeMock.updateNovelPromotionPanelInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handleLipSyncTask(buildLipSyncJob()))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(projectScopeMock.updateNovelPromotionPanelInProject).toHaveBeenCalledWith(
      'project-1',
      'panel-1',
      { lipSyncVideoUrl: 'video/panel-1.mp4', lipSyncTaskId: null },
    )
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })
})

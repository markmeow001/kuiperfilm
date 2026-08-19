import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
  options: null as Record<string, unknown> | null,
}))

const generateVoiceLineMock = vi.hoisted(() => vi.fn())
const handleVoiceDesignTaskMock = vi.hoisted(() => vi.fn())
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => undefined))
const withTaskLifecycleMock = vi.hoisted(() =>
  vi.fn(async (
    job: Job<TaskJobData>,
    handler: WorkerProcessor,
    _options?: Record<string, unknown>,
  ) => await handler(job)),
)
const publicationMock = vi.hoisted(() => ({
  claimVoiceLineCompletion: vi.fn(async () => true),
  reconcileVoiceLineTerminalState: vi.fn(async () => 'active'),
}))
const rateLimitAwareBackoffMock = vi.hoisted(() => vi.fn(() => 1_000))
const generationInput = {
  line: {
    id: 'line-1',
    episodeId: 'episode-1',
    speaker: 'Ann',
    content: 'Hello',
    voicePresetId: null,
    emotionPrompt: null,
    emotionStrength: 0.4,
    speakerVoices: null,
    audioUrl: null,
    audioMediaId: null,
    audioDuration: null,
  },
  source: { presetId: 'preset-1', kind: 'storage-key', value: 'voice/system/preset.wav' },
}

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(_name: string) {}

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(_name: string, processor: WorkerProcessor, options?: Record<string, unknown>) {
      workerState.processor = processor
      workerState.options = options || null
    }
  },
}))

vi.mock('@/lib/redis', () => ({
  queueRedis: {},
}))

vi.mock('@/lib/task/queues', () => ({
  QUEUE_NAME: { VOICE: 'voice' },
  rateLimitAwareBackoff: rateLimitAwareBackoffMock,
}))

vi.mock('@/lib/voice/generate-voice-line', () => ({
  generateVoiceLine: generateVoiceLineMock,
}))

vi.mock('@/lib/voice/voice-line-publication', () => publicationMock)

vi.mock('@/lib/voice/voice-generation-scope', () => ({
  parseVoiceLineGenerationInput: vi.fn((value) => value && typeof value === 'object' ? value : null),
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: withTaskLifecycleMock,
}))

vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: assertTaskActiveMock,
}))

vi.mock('@/lib/workers/handlers/voice-design', () => ({
  handleVoiceDesignTask: handleVoiceDesignTaskMock,
}))

function buildJob(params: {
  type: TaskJobData['type']
  targetType?: string
  targetId?: string
  episodeId?: string | null
  payload?: Record<string, unknown>
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: params.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: params.episodeId !== undefined ? params.episodeId : 'episode-1',
      targetType: params.targetType ?? 'NovelPromotionVoiceLine',
      targetId: params.targetId ?? 'line-1',
      payload: params.payload ?? {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker voice processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null
    workerState.options = null

    generateVoiceLineMock.mockResolvedValue({
      lineId: 'line-1',
      audioUrl: 'cos/voice-line-1.mp3',
    })
    handleVoiceDesignTaskMock.mockResolvedValue({
      presetId: 'preset-1',
      previewAudioUrl: 'cos/preset-1.mp3',
    })

    const mod = await import('@/lib/workers/voice.worker')
    mod.createVoiceWorker()
  })

  it('VOICE_LINE: lineId/episodeId 缺失时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const missingLineJob = buildJob({
      type: TASK_TYPE.VOICE_LINE,
      targetId: '',
      payload: { episodeId: 'episode-1' },
    })
    await expect(processor!(missingLineJob)).rejects.toThrow('VOICE_LINE task missing lineId')

    const missingEpisodeJob = buildJob({
      type: TASK_TYPE.VOICE_LINE,
      episodeId: null,
      targetId: 'line-1',
      payload: {},
    })
    await expect(processor!(missingEpisodeJob)).rejects.toThrow('VOICE_LINE task missing episodeId')
  })

  it('VOICE_LINE: 正常生成时把核心参数传给 generateVoiceLine', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VOICE_LINE,
      targetId: 'line-9',
      episodeId: 'episode-9',
      payload: {
        lineId: 'line-9',
        episodeId: 'episode-9',
        audioModel: 'atlascloud::bytedance/seed-audio-1.0',
        providerText: '@audio1 Hello',
        sourceFingerprint: 'f'.repeat(64),
        generationInput: {
          ...generationInput,
          line: { ...generationInput.line, id: 'line-9', episodeId: 'episode-9' },
        },
      },
    })

    const result = await processor!(job)
    expect(result).toEqual({ lineId: 'line-1', audioUrl: 'cos/voice-line-1.mp3' })
    expect(generateVoiceLineMock).toHaveBeenCalledWith({
      job,
      projectId: 'project-1',
      episodeId: 'episode-9',
      lineId: 'line-9',
      taskId: 'task-1',
      userId: 'user-1',
      audioModel: 'atlascloud::bytedance/seed-audio-1.0',
      providerText: '@audio1 Hello',
      sourceFingerprint: 'f'.repeat(64),
      generationInput: {
        ...generationInput,
        line: { ...generationInput.line, id: 'line-9', episodeId: 'episode-9' },
      },
      checkCancelled: expect.any(Function),
    })

    const checkCancelled = generateVoiceLineMock.mock.calls[0]?.[0]?.checkCancelled
    await expect(checkCancelled('voice_line_pre_upload')).resolves.toBeUndefined()
    expect(assertTaskActiveMock).toHaveBeenCalledWith(job, 'voice_line_prepare')
    expect(assertTaskActiveMock).toHaveBeenCalledWith(job, 'voice_line_pre_upload')
  })

  it('[VOICE_LINE worker] -> [註冊 custom backoff 與 task-specific atomic completion/reconcile]', async () => {
    expect(workerState.options).toMatchObject({
      settings: { backoffStrategy: rateLimitAwareBackoffMock },
    })
    const job = buildJob({
      type: TASK_TYPE.VOICE_LINE,
      targetId: 'line-1',
      episodeId: 'episode-1',
      payload: {
        lineId: 'line-1',
        episodeId: 'episode-1',
        audioModel: 'atlascloud::bytedance/seed-audio-1.0',
        providerText: '@audio1 Hello',
        sourceFingerprint: 'f'.repeat(64),
        generationInput,
      },
    })

    await workerState.processor!(job)
    const options = withTaskLifecycleMock.mock.calls.at(-1)?.[2] as {
      completionClaim?: (input: { result: Record<string, unknown>; billing?: unknown }) => Promise<boolean>
      terminalReconcile?: () => Promise<unknown>
    }
    expect(options.completionClaim).toEqual(expect.any(Function))
    expect(options.terminalReconcile).toEqual(expect.any(Function))
    await options.completionClaim!({ result: { lineId: 'line-1' } })
    await options.terminalReconcile!()
    expect(publicationMock.claimVoiceLineCompletion).toHaveBeenCalledWith(
      job,
      { lineId: 'line-1' },
      undefined,
    )
    expect(publicationMock.reconcileVoiceLineTerminalState).toHaveBeenCalledWith(job)
  })

  it.each([
    {
      label: 'targetType forged',
      job: buildJob({
        type: TASK_TYPE.VOICE_LINE,
        targetType: 'NovelPromotionEpisode',
        targetId: 'line-1',
        episodeId: 'episode-1',
        payload: { lineId: 'line-1', episodeId: 'episode-1' },
      }),
    },
    {
      label: 'payload lineId 與 durable target 不同',
      job: buildJob({
        type: TASK_TYPE.VOICE_LINE,
        targetId: 'line-durable',
        episodeId: 'episode-1',
        payload: { lineId: 'line-forged', episodeId: 'episode-1' },
      }),
    },
    {
      label: 'payload episodeId 與 durable episode 不同',
      job: buildJob({
        type: TASK_TYPE.VOICE_LINE,
        targetId: 'line-1',
        episodeId: 'episode-durable',
        payload: { lineId: 'line-1', episodeId: 'episode-forged' },
      }),
    },
    {
      label: 'payload lineId 缺失',
      job: buildJob({
        type: TASK_TYPE.VOICE_LINE,
        targetId: 'line-1',
        episodeId: 'episode-1',
        payload: { episodeId: 'episode-1' },
      }),
    },
    {
      label: 'payload episodeId 缺失',
      job: buildJob({
        type: TASK_TYPE.VOICE_LINE,
        targetId: 'line-1',
        episodeId: 'episode-1',
        payload: { lineId: 'line-1' },
      }),
    },
  ])('[VOICE_LINE $label] -> [provider handler 前顯式失敗]', async ({ job }) => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    await expect(processor!(job)).rejects.toThrow('VOICE_LINE_TARGET_MISMATCH')
    expect(generateVoiceLineMock).not.toHaveBeenCalled()
  })

  it('[task 在 prepare 已取消] -> [0 provider handler]', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    assertTaskActiveMock.mockRejectedValueOnce(new Error('TASK_CANCELLED'))

    const job = buildJob({
      type: TASK_TYPE.VOICE_LINE,
      targetId: 'line-1',
      episodeId: 'episode-1',
      payload: {
        lineId: 'line-1',
        episodeId: 'episode-1',
        audioModel: 'fal::voice-model',
        sourceFingerprint: 'f'.repeat(64),
        generationInput,
      },
    })

    await expect(processor!(job)).rejects.toThrow('TASK_CANCELLED')
    expect(assertTaskActiveMock).toHaveBeenCalledWith(job, 'voice_line_prepare')
    expect(generateVoiceLineMock).not.toHaveBeenCalled()
  })

  it('VOICE_DESIGN: 路由到 voice design handler', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const designJob = buildJob({
      type: TASK_TYPE.VOICE_DESIGN,
      targetType: 'NovelPromotionVoiceDesign',
      targetId: 'voice-design-1',
    })

    await processor!(designJob)

    expect(handleVoiceDesignTaskMock).toHaveBeenCalledOnce()
    expect(handleVoiceDesignTaskMock).toHaveBeenCalledWith(designJob)
    expect(generateVoiceLineMock).not.toHaveBeenCalled()
  })

  it('[queued ASSET_HUB_VOICE_DESIGN] -> [progress 與 handler 前 consent fail-closed]', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const assetHubJob = buildJob({
      type: TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
      targetType: 'GlobalAssetHubVoiceDesign',
      targetId: 'asset-hub-voice-design-1',
    })

    await expect(processor!(assetHubJob)).rejects.toThrow('VOICE_SOURCE_CONSENT_REQUIRED')

    expect(reportTaskProgressMock).not.toHaveBeenCalled()
    expect(handleVoiceDesignTaskMock).not.toHaveBeenCalled()
    expect(generateVoiceLineMock).not.toHaveBeenCalled()
  })

  it('未知任务类型: 显式报错', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
      targetId: 'character-1',
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('Unsupported voice task type')
  })
})

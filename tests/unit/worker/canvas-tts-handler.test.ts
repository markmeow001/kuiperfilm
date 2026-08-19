import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const providerMock = vi.hoisted(() => ({
  resolveDurableAtlasCloudVoiceAudioUrl: vi.fn(),
  captureResolvedInput: vi.fn(),
}))
const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelectionOrSingle: vi.fn(),
  getProviderConfig: vi.fn(),
  getProviderKey: vi.fn((provider: string) => provider.split(':', 1)[0] || ''),
}))
const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async (_buffer: Buffer, key: string) => key),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
  toFetchableUrl: vi.fn((url: string) => url),
}))
const safeAudioMock = vi.hoisted(() => ({
  fetchVoiceAudioResource: vi.fn(),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/voice/atlascloud-voice-provider', () => ({
  ATLASCLOUD_SEED_AUDIO_MODEL_ID: 'bytedance/seed-audio-1.0',
  resolveDurableAtlasCloudVoiceAudioUrl: providerMock.resolveDurableAtlasCloudVoiceAudioUrl,
}))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/voice/safe-audio-fetch', () => safeAudioMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import { handleCanvasTtsTask } from '@/lib/workers/handlers/canvas-tts'

const AUDIO_MODEL = 'atlascloud:primary::bytedance/seed-audio-1.0'
const AUDIO_SELECTION = {
  provider: 'atlascloud:primary',
  modelId: 'bytedance/seed-audio-1.0',
  modelKey: AUDIO_MODEL,
  mediaType: 'audio',
}

function makeJob(
  payload: Record<string, unknown>,
  options?: { providerExternalId?: string },
): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-canvas-tts-1',
      userId: 'user-1',
      locale: 'zh',
      projectId: 'playground',
      type: 'canvas_tts',
      targetType: 'canvas-tts',
      targetId: 'tts-1',
      payload,
      providerExternalId: options?.providerExternalId,
    },
    updateData: vi.fn(async () => undefined),
    opts: {},
    attemptsMade: 0,
  } as unknown as Job<TaskJobData>
}

function wavBuffer(durationSeconds = 1): Buffer {
  const byteRate = 48_000
  const dataSize = byteRate * durationSeconds
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24_000, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

describe('handleCanvasTtsTask AtlasCloud cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderKey.mockImplementation((provider: string) => provider.split(':', 1)[0] || '')
    apiConfigMock.resolveModelSelectionOrSingle.mockResolvedValue(AUDIO_SELECTION)
    apiConfigMock.getProviderConfig.mockResolvedValue({
      id: 'atlascloud:primary',
      name: 'Atlas Cloud',
      apiKey: 'atlas-secret',
    })
    const generatedAudio = wavBuffer()
    safeAudioMock.fetchVoiceAudioResource
      .mockResolvedValueOnce({ data: Buffer.from('reference-audio'), contentType: 'audio/wav' })
      .mockResolvedValueOnce({ data: generatedAudio, contentType: 'audio/wav' })
    providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mockImplementation(async (request) => {
      await request.checkCancelled?.('canvas_tts_test_provider')
      providerMock.captureResolvedInput(await request.resolveInput?.())
      await request.resolveApiKey?.()
      return 'https://provider.example/generated.wav'
    })
  })

  it('[new Atlas task] -> [sends exact pinned Seed Audio request, safely fetches both audios, and settles Unicode characters]', async () => {
    const job = makeJob({
      text: '你好😀',
      referenceAudioKey: 'voice/playground-ref/user-1/ref-abc.wav',
      strength: 0.4,
      audioModel: AUDIO_MODEL,
      providerText: '@audio1 你好😀',
    })

    const result = await handleCanvasTtsTask(job)

    expect(apiConfigMock.resolveModelSelectionOrSingle).toHaveBeenCalledWith(
      'user-1',
      AUDIO_MODEL,
      'audio',
    )
    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-1', 'atlascloud:primary')
    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).toHaveBeenCalledWith(expect.objectContaining({
      job,
      modelId: 'bytedance/seed-audio-1.0',
      resolveInput: expect.any(Function),
      resolveApiKey: expect.any(Function),
      checkCancelled: expect.any(Function),
    }))
    expect(providerMock.captureResolvedInput).toHaveBeenCalledWith({
      text: '@audio1 你好😀',
      references: [{ audio_data: Buffer.from('reference-audio').toString('base64') }],
      format: 'wav',
      sample_rate: 24_000,
      pitch_rate: 0,
      speech_rate: 0,
      loudness_rate: 0,
    })
    expect(safeAudioMock.fetchVoiceAudioResource).toHaveBeenNthCalledWith(
      1,
      'https://signed.example/voice/playground-ref/user-1/ref-abc.wav',
      { trustedInternalOrigins: ['https://signed.example'] },
    )
    expect(safeAudioMock.fetchVoiceAudioResource).toHaveBeenNthCalledWith(
      2,
      'https://provider.example/generated.wav',
    )
    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(
      expect.any(Buffer),
      'voice/playground-ref/user-1/tts-tts-1.wav',
    )
    expect(result).toEqual({
      success: true,
      audioUrl: 'https://signed.example/voice/playground-ref/user-1/tts-tts-1.wav',
      audioKey: 'voice/playground-ref/user-1/tts-tts-1.wav',
      durationMs: 1000,
      actualCharacters: 11,
    })
    expect(workerMock.assertTaskActive).toHaveBeenCalledWith(job, 'canvas_tts_pre_output_fetch')
    expect(workerMock.assertTaskActive).toHaveBeenCalledWith(job, 'canvas_tts_pre_persist')
  })

  it('[retry with durable Atlas prediction] -> [passes the same job and does not re-resolve model or reference input]', async () => {
    safeAudioMock.fetchVoiceAudioResource.mockReset().mockResolvedValueOnce({
      data: wavBuffer(2),
      contentType: 'audio/wav',
    })
    providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mockImplementationOnce(async (request) => {
      await request.resolveApiKey?.()
      return 'https://provider.example/resumed.wav'
    })
    const job = makeJob({
      text: '重試',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      strength: 0.4,
      audioModel: AUDIO_MODEL,
      providerText: '@audio1 重試',
    }, {
      providerExternalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-existing',
    })

    const result = await handleCanvasTtsTask(job)

    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).toHaveBeenCalledWith(expect.objectContaining({
      job,
      modelId: 'bytedance/seed-audio-1.0',
    }))
    expect(apiConfigMock.resolveModelSelectionOrSingle).not.toHaveBeenCalled()
    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-1', 'atlascloud:primary')
    expect(cosMock.getSignedUrl).not.toHaveBeenCalledWith(
      'voice/playground-ref/user-1/ref.wav',
      3600,
    )
    expect(safeAudioMock.fetchVoiceAudioResource).toHaveBeenCalledTimes(1)
    expect(safeAudioMock.fetchVoiceAudioResource).toHaveBeenCalledWith(
      'https://provider.example/resumed.wav',
    )
    expect(result.durationMs).toBe(2000)
  })

  it('[providerText differs from rebuilt pinned input] -> [fails before provider, fetch, or upload]', async () => {
    await expect(handleCanvasTtsTask(makeJob({
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      strength: 0.4,
      audioModel: AUDIO_MODEL,
      providerText: '@audio1 被竄改',
    }))).rejects.toThrow('CANVAS_TTS_PINNED_PROVIDER_TEXT_INVALID')

    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[pinned provider is not AtlasCloud] -> [rejects with zero provider calls]', async () => {
    await expect(handleCanvasTtsTask(makeJob({
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      strength: 0.4,
      audioModel: 'fal::fal-ai/index-tts-2/text-to-speech',
      providerText: '@audio1 你好',
    }))).rejects.toThrow('CANVAS_TTS_PROVIDER_UNSUPPORTED')

    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(apiConfigMock.getProviderConfig).not.toHaveBeenCalled()
    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
  })

  it('[reference key is outside the caller namespace] -> [rejects before provider and outbound fetch]', async () => {
    await expect(handleCanvasTtsTask(makeJob({
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/other-user/ref.wav',
      strength: 0.4,
      audioModel: AUDIO_MODEL,
      providerText: '@audio1 你好',
    }))).rejects.toThrow(/own voice key/)

    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
  })

  it('[Atlas 回傳 audio/wav 標籤但 bytes 不是 RIFF/WAVE] -> [0 storage upload / 0 settlement result]', async () => {
    safeAudioMock.fetchVoiceAudioResource
      .mockReset()
      .mockResolvedValueOnce({ data: Buffer.from('reference'), contentType: 'audio/wav' })
      .mockResolvedValueOnce({ data: Buffer.from('not-a-wave'), contentType: 'audio/wav' })

    await expect(handleCanvasTtsTask(makeJob({
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      strength: 0.4,
      audioModel: AUDIO_MODEL,
      providerText: '@audio1 你好',
    }))).rejects.toThrow('VOICE_PROVIDER_OUTPUT_WAV_INVALID')

    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })
})

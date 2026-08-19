import type { Job } from 'bullmq'
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const scopeMock = vi.hoisted(() => ({
  resolveVoiceLineGenerationInput: vi.fn(),
  resolveVoiceLineGenerationSnapshot: vi.fn(),
  resolveSystemVoicePresetSource: vi.fn(),
  parseVoiceLineGenerationInput: vi.fn((value) => value),
  voiceLineGenerationFingerprint: vi.fn(() => 'f'.repeat(64)),
}))
const safeAudioMock = vi.hoisted(() => ({ fetchVoiceAudioResource: vi.fn() }))
const cosMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://storage.example/${key}`),
  getStorageObjectSize: vi.fn(),
  toFetchableUrl: vi.fn((value: string) => value),
  uploadToCOS: vi.fn(),
}))
const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelectionOrSingle: vi.fn(),
  getProviderKey: vi.fn(),
  getProviderConfig: vi.fn(),
}))
const providerMock = vi.hoisted(() => ({
  resolveDurableAtlasCloudVoiceAudioUrl: vi.fn(),
  submittedInput: null as unknown,
}))
const publicationMock = vi.hoisted(() => ({
  readVoiceLinePreparedOutput: vi.fn(),
  persistVoiceLinePreparedOutput: vi.fn(),
  reconcileVoiceLineLateUpload: vi.fn(),
  voiceLineStorageKey: vi.fn(),
}))

vi.mock('@/lib/voice/voice-generation-scope', () => scopeMock)
vi.mock('@/lib/voice/safe-audio-fetch', () => safeAudioMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/voice/atlascloud-voice-provider', () => providerMock)
vi.mock('@/lib/voice/voice-line-publication', () => publicationMock)

import { generateVoiceLine } from '@/lib/voice/generate-voice-line'

const SOURCE_FINGERPRINT = 'f'.repeat(64)
const AUDIO_MODEL = 'atlascloud::bytedance/seed-audio-1.0'
const AUDIO_ENDPOINT = 'bytedance/seed-audio-1.0'
const RETIRED_NON_ATLAS_AUDIO_MODEL = 'fal::fal-ai/index-tts-2/text-to-speech'
const PROVIDER_TEXT = '@audio1 [emotion: calm; intensity: 0.5] Hello'

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

const GENERATED_WAV = wavBuffer()
const AUDIO_SHA = createHash('sha256').update(GENERATED_WAV).digest('hex')
const OUTPUT_KEY = `voice/project-a/episode-a/line-a/task-hash-${AUDIO_SHA}.wav`

function resolvedInput() {
  return {
    line: {
      id: 'line-a',
      episodeId: 'episode-a',
      speaker: 'Ann',
      content: 'Hello',
      emotionPrompt: 'calm',
      emotionStrength: 0.5,
      voicePresetId: null,
      speakerVoices: JSON.stringify({ Ann: { voicePresetId: 'preset-system' } }),
      audioUrl: null,
      audioMediaId: null,
      audioDuration: null,
    },
    source: {
      presetId: 'preset-system',
      kind: 'storage-key' as const,
      value: 'voice/system/ann.wav',
    },
  }
}

function buildJob(): Job<TaskJobData> {
  return {
    id: 'task-a',
    data: {
      taskId: 'task-a',
      type: TASK_TYPE.VOICE_LINE,
      locale: 'zh',
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-a',
      payload: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        audioModel: AUDIO_MODEL,
        providerText: PROVIDER_TEXT,
        sourceFingerprint: SOURCE_FINGERPRINT,
      },
    },
  } as unknown as Job<TaskJobData>
}

function makeCancellation(rejectStage?: string) {
  return vi.fn(async (stage: string) => {
    if (stage === rejectStage) throw new Error('TASK_CANCELLED')
  })
}

function request(overrides?: Partial<Parameters<typeof generateVoiceLine>[0]>) {
  return {
    job: buildJob(),
    projectId: 'project-a',
    episodeId: 'episode-a',
    lineId: 'line-a',
    taskId: 'task-a',
    userId: 'user-a',
    audioModel: AUDIO_MODEL,
    providerText: PROVIDER_TEXT,
    sourceFingerprint: SOURCE_FINGERPRINT,
    generationInput: resolvedInput(),
    checkCancelled: makeCancellation(),
    ...overrides,
  }
}

function preparedMarker(overrides?: Record<string, unknown>) {
  const result = {
    lineId: 'line-a',
    audioUrl: OUTPUT_KEY,
    storageKey: OUTPUT_KEY,
    audioDuration: 1000,
  }
  return {
    kind: 'voice_line_publication_v1',
    state: 'prepared',
    taskId: 'task-a',
    projectId: 'project-a',
    episodeId: 'episode-a',
    lineId: 'line-a',
    sourceFingerprint: SOURCE_FINGERPRINT,
    outputUrl: OUTPUT_KEY,
    audioSha256: AUDIO_SHA,
    audioBytes: GENERATED_WAV.byteLength,
    audioDuration: 1000,
    input: {
      speaker: 'Ann',
      content: 'Hello',
      voicePresetId: null,
      emotionPrompt: 'calm',
      emotionStrength: 0.5,
      speakerVoices: JSON.stringify({ Ann: { voicePresetId: 'preset-system' } }),
      audioUrl: null,
      audioMediaId: null,
      audioDuration: null,
    },
    result,
    ...overrides,
  }
}

describe('generateVoiceLine durable preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scopeMock.resolveVoiceLineGenerationInput.mockReset().mockResolvedValue(resolvedInput())
    scopeMock.resolveVoiceLineGenerationSnapshot.mockReset().mockResolvedValue(resolvedInput().line)
    scopeMock.resolveSystemVoicePresetSource.mockReset().mockResolvedValue(resolvedInput().source)
    scopeMock.voiceLineGenerationFingerprint.mockReset().mockReturnValue(SOURCE_FINGERPRINT)
    apiConfigMock.resolveModelSelectionOrSingle.mockReset().mockResolvedValue({
      provider: 'atlascloud',
      modelKey: AUDIO_MODEL,
      modelId: AUDIO_ENDPOINT,
    })
    apiConfigMock.getProviderKey.mockReset().mockImplementation(
      (provider: string) => provider.split(':', 1)[0],
    )
    apiConfigMock.getProviderConfig.mockReset().mockImplementation(async (_userId, provider) => ({
      id: provider,
      name: provider,
      apiKey: provider.startsWith('fal') ? 'legacy-fal-secret' : 'atlas-secret',
    }))
    publicationMock.readVoiceLinePreparedOutput.mockReset().mockResolvedValue(null)
    publicationMock.persistVoiceLinePreparedOutput.mockReset().mockResolvedValue(undefined)
    publicationMock.reconcileVoiceLineLateUpload.mockReset().mockResolvedValue('deleted')
    publicationMock.voiceLineStorageKey.mockReset().mockReturnValue(OUTPUT_KEY)
    cosMock.getStorageObjectSize.mockReset().mockResolvedValue(null)
    cosMock.uploadToCOS.mockReset().mockResolvedValue(OUTPUT_KEY)
    safeAudioMock.fetchVoiceAudioResource
      .mockReset()
      .mockResolvedValueOnce({ data: Buffer.from('reference'), contentType: 'audio/wav' })
      .mockResolvedValueOnce({ data: GENERATED_WAV, contentType: 'audio/wav' })
    providerMock.submittedInput = null
    providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mockReset().mockImplementation(async (input) => {
      providerMock.submittedInput = await input.resolveInput?.()
      await input.resolveApiKey?.()
      return 'https://provider.example/generated.wav'
    })
  })


  it('[pinned audio model is not AtlasCloud] -> [fails closed before provider, model selection, or source work]', async () => {
    const params = request({
      audioModel: RETIRED_NON_ATLAS_AUDIO_MODEL,
      providerText: undefined,
    })
    params.job.data.payload = {
      ...params.job.data.payload,
      audioModel: RETIRED_NON_ATLAS_AUDIO_MODEL,
    }
    params.job.data.providerExternalId = 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:request-paid'

    await expect(generateVoiceLine(params)).rejects.toMatchObject({
      message: 'VOICE_LINE_PINNED_INPUT_REQUIRED',
      code: 'INVALID_PARAMS',
    })

    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(apiConfigMock.resolveModelSelectionOrSingle).not.toHaveBeenCalled()
    expect(apiConfigMock.getProviderConfig).not.toHaveBeenCalled()
    expect(scopeMock.resolveSystemVoicePresetSource).not.toHaveBeenCalled()
    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
  })

  it('[正常生成] -> [先存 exact marker，再單次上傳，0 VoiceLine DB write]', async () => {
    const params = request()
    const result = await generateVoiceLine(params)

    expect(scopeMock.voiceLineGenerationFingerprint).toHaveBeenCalledWith({
      line: resolvedInput().line,
      source: resolvedInput().source,
      audioModel: AUDIO_MODEL,
    })
    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).toHaveBeenCalledWith(expect.objectContaining({
      job: params.job,
      modelId: AUDIO_ENDPOINT,
      resolveInput: expect.any(Function),
      resolveApiKey: expect.any(Function),
    }))
    expect(providerMock.submittedInput).toEqual({
      text: PROVIDER_TEXT,
      references: [{ audio_data: Buffer.from('reference').toString('base64') }],
      format: 'wav',
      sample_rate: 24_000,
      pitch_rate: 0,
      speech_rate: 0,
      loudness_rate: 0,
    })
    expect(publicationMock.persistVoiceLinePreparedOutput).toHaveBeenCalledWith(
      params.job,
      expect.objectContaining({
        state: 'prepared',
        sourceFingerprint: SOURCE_FINGERPRINT,
        outputUrl: OUTPUT_KEY,
        audioBytes: GENERATED_WAV.byteLength,
        result: expect.objectContaining({ storageKey: OUTPUT_KEY }),
      }),
    )
    expect(publicationMock.persistVoiceLinePreparedOutput.mock.invocationCallOrder[0]).toBeLessThan(
      cosMock.uploadToCOS.mock.invocationCallOrder[0],
    )
    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(GENERATED_WAV, OUTPUT_KEY, 1)
    expect(result).toEqual(expect.objectContaining({ lineId: 'line-a', storageKey: OUTPUT_KEY }))
    expect(result.actualCharacters).toBe(Array.from(PROVIDER_TEXT).length)
  })

  it('[提交後 input fingerprint 已漂移] -> [0 reference fetch / 0 provider / 0 marker / 0 upload]', async () => {
    scopeMock.voiceLineGenerationFingerprint
      .mockReturnValueOnce(SOURCE_FINGERPRINT)
      .mockReturnValueOnce('a'.repeat(64))

    await expect(generateVoiceLine(request())).rejects.toThrow('VOICE_LINE_INPUT_CHANGED')

    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[forged queued generation snapshot] -> [0 provider / 0 marker / 0 upload]', async () => {
    scopeMock.voiceLineGenerationFingerprint.mockReturnValueOnce('a'.repeat(64))

    await expect(generateVoiceLine(request())).rejects.toThrow('VOICE_LINE_PINNED_INPUT_INVALID')

    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[pinned preset source changes before first provider submit] -> [0 reference fetch / 0 marker / 0 upload]', async () => {
    scopeMock.resolveSystemVoicePresetSource.mockResolvedValueOnce({
      presetId: 'preset-system',
      kind: 'storage-key',
      value: 'voice/system/replaced.wav',
    })

    await expect(generateVoiceLine(request())).rejects.toThrow('VOICE_LINE_PINNED_SOURCE_CHANGED')

    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[prepared output 已存在且 HEAD bytes 相符] -> [0 source/provider/fetch/archive/upload]', async () => {
    const marker = preparedMarker()
    publicationMock.readVoiceLinePreparedOutput.mockResolvedValue(marker)
    cosMock.getStorageObjectSize.mockResolvedValue(marker.audioBytes)

    await expect(generateVoiceLine(request())).resolves.toEqual(marker.result)

    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[paid provider id durable 且 pinned model 後來停用] -> [以 exact pinned endpoint 續跑且不查 enabled model]', async () => {
    const params = request()
    params.job.data.providerExternalId = `ATLASCLOUD:AUDIO:${AUDIO_ENDPOINT}:req-paid`
    scopeMock.resolveVoiceLineGenerationInput.mockRejectedValueOnce(new Error('VOICE_PRESET_NOT_TRUSTED'))
    apiConfigMock.resolveModelSelectionOrSingle.mockRejectedValueOnce(new Error('MODEL_NOT_FOUND'))
    providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mockImplementationOnce(async (input) => {
      expect(await input.resolveApiKey()).toBe('atlas-secret')
      return 'https://provider.example/generated.wav'
    })
    safeAudioMock.fetchVoiceAudioResource.mockReset().mockResolvedValueOnce({
      data: GENERATED_WAV,
      contentType: 'audio/wav',
    })

    await expect(generateVoiceLine(params)).resolves.toEqual(expect.objectContaining({
      storageKey: OUTPUT_KEY,
    }))

    expect(scopeMock.resolveVoiceLineGenerationSnapshot).toHaveBeenCalledWith({
      projectId: 'project-a',
      episodeId: 'episode-a',
      lineId: 'line-a',
    })
    expect(scopeMock.resolveVoiceLineGenerationInput).not.toHaveBeenCalled()
    expect(scopeMock.resolveSystemVoicePresetSource).not.toHaveBeenCalled()
    expect(apiConfigMock.resolveModelSelectionOrSingle).not.toHaveBeenCalled()
    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-a', 'atlascloud')
    const providerRequest = providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mock.calls[0]?.[0]
    expect(providerRequest).not.toHaveProperty('input')
    expect(providerRequest).toHaveProperty('resolveInput')
    expect(providerRequest.modelId).toBe(AUDIO_ENDPOINT)
    expect(safeAudioMock.fetchVoiceAudioResource).toHaveBeenCalledTimes(1)
  })



  it('[new submit 的 pinned model 已停用] -> [enabled model 驗證失敗且 0 credential/provider POST/output]', async () => {
    apiConfigMock.resolveModelSelectionOrSingle.mockRejectedValueOnce(new Error('MODEL_NOT_FOUND'))

    await expect(generateVoiceLine(request())).rejects.toThrow('MODEL_NOT_FOUND')

    expect(apiConfigMock.resolveModelSelectionOrSingle).toHaveBeenCalledWith(
      'user-a',
      AUDIO_MODEL,
      'audio',
    )
    expect(apiConfigMock.getProviderConfig).not.toHaveBeenCalled()
    expect(scopeMock.resolveSystemVoicePresetSource).not.toHaveBeenCalled()
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[prepared output 已完整上傳但模型設定後來移除] -> [仍以 durable marker 完成，0 config/provider work]', async () => {
    const marker = preparedMarker()
    publicationMock.readVoiceLinePreparedOutput.mockResolvedValue(marker)
    cosMock.getStorageObjectSize.mockResolvedValue(marker.audioBytes)

    await expect(generateVoiceLine(request())).resolves.toEqual(marker.result)

    expect(apiConfigMock.resolveModelSelectionOrSingle).not.toHaveBeenCalled()
    expect(apiConfigMock.getProviderConfig).not.toHaveBeenCalled()
    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).not.toHaveBeenCalled()
    expect(safeAudioMock.fetchVoiceAudioResource).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[prepared marker 有、object 缺] -> [只 resume provider external id 並補 exact upload]', async () => {
    const marker = preparedMarker()
    publicationMock.readVoiceLinePreparedOutput.mockResolvedValue(marker)
    cosMock.getStorageObjectSize.mockResolvedValue(null)
    safeAudioMock.fetchVoiceAudioResource.mockReset().mockResolvedValue({
      data: GENERATED_WAV,
      contentType: 'audio/wav',
    })
    apiConfigMock.resolveModelSelectionOrSingle.mockRejectedValueOnce(new Error('MODEL_NOT_FOUND'))
    providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mockImplementationOnce(async (input) => {
      expect(await input.resolveApiKey()).toBe('atlas-secret')
      return 'https://provider.example/generated.wav'
    })

    await expect(generateVoiceLine(request())).resolves.toEqual(marker.result)

    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mock.calls[0]?.[0]).not.toHaveProperty('input')
    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mock.calls[0]?.[0]?.modelId).toBe(AUDIO_ENDPOINT)
    expect(apiConfigMock.resolveModelSelectionOrSingle).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(GENERATED_WAV, OUTPUT_KEY, 1)
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
  })

  it('[upload response lost但 HEAD bytes exact] -> [reconcile success且不二次 upload]', async () => {
    cosMock.uploadToCOS.mockRejectedValueOnce(new Error('socket reset'))
    cosMock.getStorageObjectSize.mockResolvedValueOnce(GENERATED_WAV.byteLength)

    await expect(generateVoiceLine(request())).resolves.toEqual(expect.objectContaining({
      storageKey: OUTPUT_KEY,
    }))
    expect(cosMock.uploadToCOS).toHaveBeenCalledTimes(1)
    expect(cosMock.getStorageObjectSize).toHaveBeenCalledWith(OUTPUT_KEY)
  })

  it('[cancel wins between pre-upload fence and confirmed PUT completion] -> [post-upload fence strictly cleans the exact durable marker]', async () => {
    const checkCancelled = makeCancellation('voice_line_post_upload')
    const params = request({ checkCancelled })

    await expect(generateVoiceLine(params)).rejects.toThrow('TASK_CANCELLED')

    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(GENERATED_WAV, OUTPUT_KEY, 1)
    expect(checkCancelled).toHaveBeenCalledWith('voice_line_pre_upload')
    expect(checkCancelled).toHaveBeenCalledWith('voice_line_post_upload')
    expect(publicationMock.reconcileVoiceLineLateUpload).toHaveBeenCalledWith(
      params.job,
      expect.objectContaining({
        kind: 'voice_line_publication_v1',
        state: 'prepared',
        taskId: 'task-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
        lineId: 'line-a',
        outputUrl: OUTPUT_KEY,
        audioSha256: AUDIO_SHA,
      }),
    )
    expect(cosMock.uploadToCOS.mock.invocationCallOrder[0]).toBeLessThan(
      publicationMock.reconcileVoiceLineLateUpload.mock.invocationCallOrder[0],
    )
  })

  it('[upload outcome unknown且 HEAD 也失敗] -> [保留 marker/object，不盲重送或刪除]', async () => {
    cosMock.uploadToCOS.mockRejectedValueOnce(new Error('socket reset'))
    cosMock.getStorageObjectSize.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(generateVoiceLine(request())).rejects.toMatchObject({
      message: 'VOICE_LINE_UPLOAD_RECONCILIATION_REQUIRED',
      code: 'EXTERNAL_ERROR',
    })
    expect(cosMock.uploadToCOS).toHaveBeenCalledTimes(1)
  })

  it('[prepared retry provider bytes/hash 漂移] -> [0 upload，顯式 fail closed]', async () => {
    const marker = preparedMarker({ audioSha256: 'a'.repeat(64) })
    publicationMock.readVoiceLinePreparedOutput.mockResolvedValue(marker)
    cosMock.getStorageObjectSize.mockResolvedValue(null)
    safeAudioMock.fetchVoiceAudioResource.mockReset().mockResolvedValue({
      data: GENERATED_WAV,
      contentType: 'audio/wav',
    })
    providerMock.resolveDurableAtlasCloudVoiceAudioUrl.mockResolvedValueOnce(
      'https://provider.example/generated.wav',
    )

    await expect(generateVoiceLine(request())).rejects.toThrow('VOICE_LINE_PROVIDER_OUTPUT_CHANGED')
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[durable provider result audio returns 502] -> [keeps task retryable without another provider submit]', async () => {
    safeAudioMock.fetchVoiceAudioResource
      .mockReset()
      .mockResolvedValueOnce({ data: Buffer.from('reference'), contentType: 'audio/wav' })
      .mockRejectedValueOnce(new Error('VOICE_AUDIO_UPSTREAM_STATUS_502'))

    await expect(generateVoiceLine(request())).rejects.toMatchObject({
      message: 'VOICE_LINE_PROVIDER_OUTPUT_FETCH_RETRYABLE',
      code: 'EXTERNAL_ERROR',
    })
    expect(providerMock.resolveDurableAtlasCloudVoiceAudioUrl).toHaveBeenCalledTimes(1)
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[provider result violates audio validation] -> [fails closed and remains nonretryable]', async () => {
    const validationError = Object.assign(new Error('UNSUPPORTED_CONTENT_TYPE'), {
      code: 'UNSUPPORTED_CONTENT_TYPE',
    })
    safeAudioMock.fetchVoiceAudioResource
      .mockReset()
      .mockResolvedValueOnce({ data: Buffer.from('reference'), contentType: 'audio/wav' })
      .mockRejectedValueOnce(validationError)

    await expect(generateVoiceLine(request())).rejects.toBe(validationError)
    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[Atlas 回傳 audio/wav 標籤但 bytes 不是 RIFF/WAVE] -> [marker 與 upload 都維持零次]', async () => {
    safeAudioMock.fetchVoiceAudioResource
      .mockReset()
      .mockResolvedValueOnce({ data: Buffer.from('reference'), contentType: 'audio/wav' })
      .mockResolvedValueOnce({ data: Buffer.from('not-a-wave'), contentType: 'audio/wav' })

    await expect(generateVoiceLine(request())).rejects.toThrow('VOICE_PROVIDER_OUTPUT_WAV_INVALID')

    expect(publicationMock.persistVoiceLinePreparedOutput).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })
})

import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const voiceMock = vi.hoisted(() => ({
  generateVoiceWithIndexTTS2: vi.fn(async () => ({ audioData: Buffer.from('wav'), audioDuration: 1234 })),
}))
const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelectionOrSingle: vi.fn(async () => ({ provider: 'fal', modelId: 'fal-ai/index-tts-2', modelKey: 'fal::index-tts2' })),
  getAudioApiKey: vi.fn(async () => 'fal-key'),
  getProviderKey: vi.fn((p: string) => p),
}))
const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async (_buf: Buffer, key: string) => key),
  getSignedUrl: vi.fn((key: string) => `https://signed/${key}`),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/voice/generate-voice-line', () => ({ generateVoiceWithIndexTTS2: voiceMock.generateVoiceWithIndexTTS2 }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import { handleCanvasTtsTask } from '@/lib/workers/handlers/canvas-tts'

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: { userId: 'user-1', projectId: 'playground', type: 'canvas_tts', targetId: 'tts-1', payload },
  } as unknown as Job<TaskJobData>
}

describe('handleCanvasTtsTask', () => {
  beforeEach(() => {
    Object.values(voiceMock).forEach((m) => m.mockClear())
    Object.values(apiConfigMock).forEach((m) => m.mockClear())
    Object.values(cosMock).forEach((m) => m.mockClear())
    apiConfigMock.getProviderKey.mockImplementation((p: string) => p)
    apiConfigMock.resolveModelSelectionOrSingle.mockResolvedValue({ provider: 'fal', modelId: 'fal-ai/index-tts-2', modelKey: 'fal::index-tts2' })
  })

  it('clones speech, uploads to the user voice namespace, returns signed url + duration', async () => {
    const res = await handleCanvasTtsTask(makeJob({
      text: '你好世界',
      referenceAudioKey: 'voice/playground-ref/user-1/ref-abc.wav',
      strength: 0.6,
      emotionPrompt: '温柔',
    }))
    expect(res.success).toBe(true)
    expect(res.audioKey).toBe('voice/playground-ref/user-1/tts-tts-1.wav')
    expect(res.audioUrl).toBe('https://signed/voice/playground-ref/user-1/tts-tts-1.wav')
    expect(res.durationMs).toBe(1234)
    // reference key signed + passed as reference audio; emotion + strength forwarded
    expect(voiceMock.generateVoiceWithIndexTTS2).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'fal-ai/index-tts-2', text: '你好世界', emotionPrompt: '温柔', strength: 0.6, falApiKey: 'fal-key' }),
    )
  })

  it('throws when text is missing', async () => {
    await expect(handleCanvasTtsTask(makeJob({ referenceAudioKey: 'voice/playground-ref/user-1/ref.wav' }))).rejects.toThrow(/text is required/)
  })

  it('throws when referenceAudioKey is missing', async () => {
    await expect(handleCanvasTtsTask(makeJob({ text: 'hi' }))).rejects.toThrow(/referenceAudioKey is required/)
  })

  it('throws when the audio provider is not fal', async () => {
    apiConfigMock.resolveModelSelectionOrSingle.mockResolvedValueOnce({ provider: 'tencent', modelId: 'x', modelKey: 'y' })
    await expect(handleCanvasTtsTask(makeJob({ text: 'hi', referenceAudioKey: 'voice/playground-ref/user-1/ref.wav' }))).rejects.toThrow(/PROVIDER_UNSUPPORTED/)
  })

  it('rejects a reference key outside the caller voice namespace (defense-in-depth)', async () => {
    // another user's key
    await expect(handleCanvasTtsTask(makeJob({ text: 'hi', referenceAudioKey: 'voice/playground-ref/other-user/ref.wav' }))).rejects.toThrow(/own voice key/)
    // an external URL must never reach the FAL fetch
    await expect(handleCanvasTtsTask(makeJob({ text: 'hi', referenceAudioKey: 'https://attacker.com/x.wav' }))).rejects.toThrow(/own voice key/)
    expect(voiceMock.generateVoiceWithIndexTTS2).not.toHaveBeenCalled()
  })
})

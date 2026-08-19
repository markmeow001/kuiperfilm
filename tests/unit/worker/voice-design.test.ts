import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const qwenMock = vi.hoisted(() => ({
  createVoiceDesign: vi.fn(),
  validateVoicePrompt: vi.fn(),
  validatePreviewText: vi.fn(),
}))

const apiConfigMock = vi.hoisted(() => ({
  getProviderConfig: vi.fn(),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/qwen-voice-design', () => qwenMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: workerMock.reportTaskProgress,
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: workerMock.assertTaskActive,
}))

import { handleVoiceDesignTask } from '@/lib/workers/handlers/voice-design'

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-voice-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'VoiceDesign',
      targetId: 'voice-design-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function unreadablePayload(label: string): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get() {
      throw new Error(`${label} payload was read`)
    },
  })
}

describe('worker voice-design consent boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Deliberately arm every downstream mock for success. The boundary must
    // fail even when the provider path would otherwise have worked, so a
    // green assertion cannot come from a missing mock.
    qwenMock.validateVoicePrompt.mockReturnValue({ valid: true })
    qwenMock.validatePreviewText.mockReturnValue({ valid: true })
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'qwen-key' })
    qwenMock.createVoiceDesign.mockResolvedValue({
      success: true,
      voiceId: 'voice-id-1',
      targetModel: 'qwen-tts',
      audioBase64: 'base64-audio',
      sampleRate: 24000,
      responseFormat: 'mp3',
      usageCount: 11,
      requestId: 'req-1',
    })
  })

  for (const taskType of [TASK_TYPE.VOICE_DESIGN, TASK_TYPE.ASSET_HUB_VOICE_DESIGN] as const) {
    it(`[queued ${taskType}] -> [consent boundary before payload/progress/provider]`, async () => {
      const job = buildJob(taskType, unreadablePayload(taskType))

      await expect(handleVoiceDesignTask(job)).rejects.toThrow('VOICE_SOURCE_CONSENT_REQUIRED')

      expect(qwenMock.validateVoicePrompt).not.toHaveBeenCalled()
      expect(qwenMock.validatePreviewText).not.toHaveBeenCalled()
      expect(workerMock.reportTaskProgress).not.toHaveBeenCalled()
      expect(workerMock.assertTaskActive).not.toHaveBeenCalled()
      expect(apiConfigMock.getProviderConfig).not.toHaveBeenCalled()
      expect(qwenMock.createVoiceDesign).not.toHaveBeenCalled()
    })

    it(`[well-formed ${taskType} payload from before the gate] -> [still refuses, zero paid provider call]`, async () => {
      const job = buildJob(taskType, {
        voicePrompt: 'calm female narrator',
        previewText: 'hello world',
        preferredName: 'custom_name',
        language: 'en',
      })

      await expect(handleVoiceDesignTask(job)).rejects.toThrow('VOICE_SOURCE_CONSENT_REQUIRED')

      expect(qwenMock.createVoiceDesign).not.toHaveBeenCalled()
      expect(apiConfigMock.getProviderConfig).not.toHaveBeenCalled()
    })
  }
})

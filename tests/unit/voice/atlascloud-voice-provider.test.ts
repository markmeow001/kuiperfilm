import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const taskMock = vi.hoisted(() => ({
  claimTaskExternalId: vi.fn(),
  persistTaskExternalIdOrThrow: vi.fn(),
  replaceTaskExternalIdOrThrow: vi.fn(),
  getTaskExistingExternalId: vi.fn(),
  releaseRejectedProviderSubmitClaimOrThrow: vi.fn(),
}))

vi.mock('@/lib/task/service', () => ({
  claimTaskExternalId: taskMock.claimTaskExternalId,
  persistTaskExternalIdOrThrow: taskMock.persistTaskExternalIdOrThrow,
  replaceTaskExternalIdOrThrow: taskMock.replaceTaskExternalIdOrThrow,
}))
vi.mock('@/lib/workers/utils', () => ({
  getTaskExistingExternalId: taskMock.getTaskExistingExternalId,
}))
vi.mock('@/lib/task/provider-submit-claim', () => ({
  releaseRejectedProviderSubmitClaimOrThrow: taskMock.releaseRejectedProviderSubmitClaimOrThrow,
}))

import {
  ATLASCLOUD_SEED_AUDIO_MODEL_ID,
  resolveDurableAtlasCloudVoiceAudioUrl,
  type AtlasCloudVoiceInput,
} from '@/lib/voice/atlascloud-voice-provider'

function buildJob(options?: { attemptsMade?: number; attempts?: number }): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-atlas-audio-a',
      type: TASK_TYPE.VOICE_LINE,
      locale: 'zh',
      projectId: 'project-a',
      episodeId: 'episode-a',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-a',
      payload: {},
      userId: 'user-a',
    },
    attemptsMade: options?.attemptsMade ?? 0,
    opts: options?.attempts === undefined ? {} : { attempts: options.attempts },
    updateData: vi.fn(async () => undefined),
  } as unknown as Job<TaskJobData>
}

const input: AtlasCloudVoiceInput = {
  text: '你好，世界',
  references: [{ audio_data: 'cmVmZXJlbmNlLWF1ZGlv' }],
  format: 'wav',
  sample_rate: 24_000,
  pitch_rate: 0,
  speech_rate: 0,
  loudness_rate: 0,
}

function submitResponse(predictionId = 'prediction-new'): Response {
  return new Response(JSON.stringify({
    code: 200,
    data: { id: predictionId, status: 'created' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function pollResponse(
  status: string,
  options?: { outputs?: string[]; error?: string },
): Response {
  return new Response(JSON.stringify({
    code: 200,
    data: {
      id: 'prediction-new',
      status,
      ...(options?.outputs ? { outputs: options.outputs } : {}),
      ...(options?.error ? { error: options.error } : {}),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('durable AtlasCloud standalone voice provider handoff', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    taskMock.getTaskExistingExternalId.mockResolvedValue(null)
    taskMock.claimTaskExternalId.mockImplementation(async (_taskId: string, claimId: string) => ({
      claimed: true,
      externalId: claimId,
    }))
    taskMock.persistTaskExternalIdOrThrow.mockResolvedValue(undefined)
    taskMock.replaceTaskExternalIdOrThrow.mockResolvedValue(undefined)
    taskMock.releaseRejectedProviderSubmitClaimOrThrow.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[first submit] -> [sends exact Seed Audio body, durably swaps claim, and returns first output URL]', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(submitResponse())
      .mockResolvedValueOnce(pollResponse('completed', {
        outputs: ['https://provider.example/generated.wav'],
      }))
    const job = buildJob()

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job,
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'atlas-secret',
    })).resolves.toBe('https://provider.example/generated.wav')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.atlascloud.ai/api/v1/model/generateAudio',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer atlas-secret',
        },
        body: JSON.stringify({
          model: 'bytedance/seed-audio-1.0',
          text: '你好，世界',
          references: [{ audio_data: 'cmVmZXJlbmNlLWF1ZGlv' }],
          format: 'wav',
          sample_rate: 24_000,
          pitch_rate: 0,
          speech_rate: 0,
          loudness_rate: 0,
        }),
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.atlascloud.ai/api/v1/model/prediction/prediction-new',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer atlas-secret' },
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
    const claimId = taskMock.claimTaskExternalId.mock.calls[0]?.[1]
    expect(claimId).toMatch(/^ATLASCLOUD:AUDIO:CLAIM:\d+:/)
    expect(job.updateData).toHaveBeenCalledWith(expect.objectContaining({
      providerExternalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-new',
    }))
    expect(taskMock.replaceTaskExternalIdOrThrow).toHaveBeenCalledWith(
      'task-atlas-audio-a',
      claimId,
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-new',
    )
    expect(taskMock.claimTaskExternalId.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]!,
    )
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      taskMock.replaceTaskExternalIdOrThrow.mock.invocationCallOrder[0]!,
    )
  })

  it('[existing durable prediction id] -> [does not submit or resolve input and resumes exact prediction]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-existing',
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      pollResponse('completed', { outputs: ['https://provider.example/existing.wav'] }),
    )
    const resolveInput = vi.fn(async () => input)

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      resolveInput,
      apiKey: 'atlas-secret',
    })).resolves.toBe('https://provider.example/existing.wav')

    expect(resolveInput).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.atlascloud.ai/api/v1/model/prediction/prediction-existing',
    )
  })

  it('[BullMQ has a valid prediction id while DB is empty] -> [persists it before polling]', async () => {
    const job = buildJob()
    job.data.providerExternalId = 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-job'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      pollResponse('completed', { outputs: ['https://provider.example/job.wav'] }),
    )

    await resolveDurableAtlasCloudVoiceAudioUrl({
      job,
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    })

    expect(taskMock.persistTaskExternalIdOrThrow).toHaveBeenCalledWith(
      'task-atlas-audio-a',
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-job',
    )
    expect(taskMock.persistTaskExternalIdOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]!,
    )
  })

  it('[BullMQ checkpoint survived after submit response but DB still has its exact claim] -> [repairs DB before polling]', async () => {
    const claimId = `ATLASCLOUD:AUDIO:CLAIM:${Date.now()}:response-loss`
    const externalId = 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-recovered'
    taskMock.getTaskExistingExternalId.mockResolvedValue(claimId)
    const job = buildJob()
    job.data.payload = { voiceProviderSubmitClaimId: claimId }
    job.data.providerExternalId = externalId
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      pollResponse('completed', { outputs: ['https://provider.example/recovered.wav'] }),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job,
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    })).resolves.toBe('https://provider.example/recovered.wav')

    expect(taskMock.replaceTaskExternalIdOrThrow).toHaveBeenCalledWith(
      'task-atlas-audio-a',
      claimId,
      externalId,
    )
    expect(taskMock.replaceTaskExternalIdOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]!,
    )
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[provider uses the documented succeeded terminal status] -> [returns the output without another submit]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-succeeded',
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      pollResponse('succeeded', { outputs: ['https://provider.example/succeeded.wav'] }),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    })).resolves.toBe('https://provider.example/succeeded.wav')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[missing credential before submit] -> [retryable error with zero claim and zero provider request]', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const resolveApiKey = vi.fn(async () => { throw new Error('PROVIDER_API_KEY_MISSING: atlascloud') })

    let rejection: unknown
    try {
      await resolveDurableAtlasCloudVoiceAudioUrl({
        job: buildJob({ attemptsMade: 4, attempts: 5 }),
        modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
        input,
        resolveApiKey,
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_CREDENTIAL_UNAVAILABLE',
      code: 'EXTERNAL_ERROR',
    })
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(true)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[paid handoff credential is unavailable with another queue attempt] -> [retryable and never resubmits]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-paid',
    )
    const resolveApiKey = vi.fn(async () => { throw new Error('PROVIDER_API_KEY_MISSING: atlascloud') })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    let rejection: unknown
    try {
      await resolveDurableAtlasCloudVoiceAudioUrl({
        job: buildJob({ attemptsMade: 1, attempts: 5 }),
        modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
        resolveApiKey,
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_CREDENTIAL_UNAVAILABLE',
      code: 'EXTERNAL_ERROR',
    })
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(true)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[paid handoff credential is unavailable on last queue attempt] -> [quarantines instead of refund/resubmit]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-paid',
    )
    const resolveApiKey = vi.fn(async () => { throw new Error('PROVIDER_API_KEY_MISSING: atlascloud') })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      resolveApiKey,
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_CREDENTIAL_QUARANTINED'),
    })

    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[submit transport outcome is unknown after claim] -> [quarantines claim and never retries inside provider]', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('socket terminated'),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'atlas-secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_SUBMIT_OUTCOME_UNKNOWN'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(taskMock.claimTaskExternalId).toHaveBeenCalledTimes(1)
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
    expect(taskMock.releaseRejectedProviderSubmitClaimOrThrow).not.toHaveBeenCalled()
  })

  it.each([401, 403])('[provider explicitly rejects submit with HTTP %s] -> [atomically releases exact claim so lifecycle can fail and refund]', async (status) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: status, message: 'invalid_api_key' }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'revoked-atlas-key',
    })).rejects.toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_SUBMIT_REJECTED',
      code: 'INVALID_PARAMS',
    })

    const claimId = taskMock.claimTaskExternalId.mock.calls[0]?.[1]
    expect(claimId).toMatch(/^ATLASCLOUD:AUDIO:CLAIM:/)
    expect(taskMock.releaseRejectedProviderSubmitClaimOrThrow).toHaveBeenCalledWith(
      'task-atlas-audio-a',
      claimId,
    )
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('[provider returns a documented 400 envelope with HTTP 200] -> [treats it as a negative acknowledgement and releases the claim]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 400, message: 'invalid_parameter' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'atlas-secret',
    })).rejects.toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_SUBMIT_REJECTED',
      code: 'INVALID_PARAMS',
    })

    expect(taskMock.releaseRejectedProviderSubmitClaimOrThrow).toHaveBeenCalledWith(
      'task-atlas-audio-a',
      expect.stringMatching(/^ATLASCLOUD:AUDIO:CLAIM:/),
    )
  })

  it('[explicit rejection claim release is uncertain] -> [quarantines instead of allowing a second submit]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 401, message: 'invalid_api_key' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    taskMock.releaseRejectedProviderSubmitClaimOrThrow.mockRejectedValueOnce(
      new Error('TASK_EXTERNAL_ID_CLAIM_RELEASE_FAILED'),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'revoked-atlas-key',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED'),
    })
  })

  it('[another processor owns a fresh submit claim] -> [terminates this processor with zero provider request]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      `ATLASCLOUD:AUDIO:CLAIM:${Date.now()}:owner-a`,
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'atlas-secret',
    })).rejects.toBeInstanceOf(TaskTerminatedError)

    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[stale submit claim] -> [requires reconciliation with zero provider request]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      `ATLASCLOUD:AUDIO:CLAIM:${Date.now() - 120_000}:owner-stale`,
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'atlas-secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED'),
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[durable prediction model differs from pinned model] -> [quarantines before credential or provider access]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:other/audio-model:prediction-paid',
    )
    const resolveApiKey = vi.fn(async () => 'atlas-secret')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      resolveApiKey,
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_CONTEXT_MISMATCH'),
    })

    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[provider reports failed] -> [surfaces a non-retryable provider failure and keeps durable id]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-failed',
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      pollResponse('failed', { error: 'provider rejected input' }),
    )

    let rejection: unknown
    try {
      await resolveDurableAtlasCloudVoiceAudioUrl({
        job: buildJob(),
        modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
        apiKey: 'atlas-secret',
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_REQUEST_FAILED',
      code: 'INVALID_PARAMS',
    })
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(false)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[provider reports timeout with another queue attempt] -> [surfaces retryable generation timeout without resubmitting]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-timeout',
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(pollResponse('timeout'))

    let rejection: unknown
    try {
      await resolveDurableAtlasCloudVoiceAudioUrl({
        job: buildJob({ attemptsMade: 1, attempts: 5 }),
        modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
        apiKey: 'atlas-secret',
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_REQUEST_TIMEOUT',
      code: 'GENERATION_TIMEOUT',
    })
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[poll transport fails with another queue attempt] -> [surfaces retryable external error without exposing the API key]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-poll',
    )
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network unavailable'))

    let rejection: unknown
    try {
      await resolveDurableAtlasCloudVoiceAudioUrl({
        job: buildJob({ attemptsMade: 1, attempts: 5 }),
        modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
        apiKey: 'atlas-secret',
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_STATUS_FAILED',
      code: 'EXTERNAL_ERROR',
    })
    expect(String((rejection as Error).message)).not.toContain('atlas-secret')
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(true)
  })

  it('[paid prediction poll transport fails on the final queue attempt] -> [quarantines instead of entering failed/refund lifecycle]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-final-transport',
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('network unavailable'),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_STATUS_QUARANTINED'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[paid prediction status returns 503 on the final queue attempt] -> [quarantines without a new submit]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-final-503',
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('upstream unavailable', { status: 503 }),
    )

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_STATUS_QUARANTINED'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[paid prediction status request times out on the final queue attempt] -> [aborts and quarantines without a new submit]', async () => {
    vi.useFakeTimers()
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-final-timeout',
    )
    let statusSignal: AbortSignal | null = null
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      statusSignal = init?.signal as AbortSignal
      return await new Promise<Response>((_resolve, reject) => {
        statusSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const settled = resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    }).then(
      () => ({ rejection: null as unknown }),
      (rejection: unknown) => ({ rejection }),
    )
    await vi.advanceTimersByTimeAsync(30_000)

    const { rejection } = await settled
    expect(rejection).toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_STATUS_QUARANTINED'),
    })
    expect((statusSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[provider reports timeout on the final queue attempt] -> [quarantines the paid prediction instead of refunding]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-provider-timeout-final',
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(pollResponse('timeout'))

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('ATLAS_AUDIO_PROVIDER_TIMEOUT_QUARANTINED'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[task cancelled before submit] -> [propagates cancellation with zero claim and zero provider request]', async () => {
    const cancellation = new TaskTerminatedError('task-atlas-audio-a', 'TASK_CANCELLED')
    const checkCancelled = vi.fn(async () => { throw cancellation })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input,
      apiKey: 'atlas-secret',
      checkCancelled,
    })).rejects.toBe(cancellation)

    expect(checkCancelled).toHaveBeenCalledWith('voice_line_pre_atlascloud_submit')
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[completed prediction has no output URL] -> [fails explicitly and does not invent a fallback]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-empty',
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(pollResponse('completed', { outputs: [] }))

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      apiKey: 'atlas-secret',
    })).rejects.toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_RESULT_AUDIO_MISSING',
      code: 'INVALID_PARAMS',
    })
  })

  it('[unsupported model] -> [fails before credential, claim, and provider access]', async () => {
    const resolveApiKey = vi.fn(async () => 'atlas-secret')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: 'bytedance/not-seed-audio',
      input,
      resolveApiKey,
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })

    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[reference has both audio_data and audio_url] -> [rejects malformed exact-one union before credential and submit]', async () => {
    const resolveApiKey = vi.fn(async () => 'atlas-secret')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const malformed = {
      ...input,
      references: [{
        audio_data: 'cmVmZXJlbmNlLWF1ZGlv',
        audio_url: 'https://media.example/reference.wav',
      }],
    } as unknown as AtlasCloudVoiceInput

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input: malformed,
      resolveApiKey,
    })).rejects.toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_INPUT_INVALID',
      code: 'INVALID_PARAMS',
    })

    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['pitch below range', { pitch_rate: -13 }],
    ['pitch above range', { pitch_rate: 13 }],
    ['speech below range', { speech_rate: -51 }],
    ['speech above range', { speech_rate: 101 }],
    ['loudness below range', { loudness_rate: -51 }],
    ['loudness above range', { loudness_rate: 101 }],
    ['fractional provider control', { speech_rate: 0.5 }],
  ])('[%s] -> [rejects before credential, claim, and provider access]', async (_label, patch) => {
    const resolveApiKey = vi.fn(async () => 'atlas-secret')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableAtlasCloudVoiceAudioUrl({
      job: buildJob(),
      modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      input: { ...input, ...patch },
      resolveApiKey,
    })).rejects.toMatchObject({
      message: 'ATLAS_AUDIO_PROVIDER_INPUT_INVALID',
      code: 'INVALID_PARAMS',
    })

    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

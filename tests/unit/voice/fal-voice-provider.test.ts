import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const queueMock = vi.hoisted(() => ({ status: vi.fn(), result: vi.fn() }))
const falClientMock = vi.hoisted(() => ({ createFalClient: vi.fn(() => ({ queue: queueMock })) }))
const taskMock = vi.hoisted(() => ({
  claimTaskExternalId: vi.fn(),
  persistTaskExternalIdOrThrow: vi.fn(),
  replaceTaskExternalIdOrThrow: vi.fn(),
  getTaskExistingExternalId: vi.fn(),
}))

vi.mock('@fal-ai/client', () => ({
  createFalClient: falClientMock.createFalClient,
}))
vi.mock('@/lib/task/service', () => ({
  claimTaskExternalId: taskMock.claimTaskExternalId,
  persistTaskExternalIdOrThrow: taskMock.persistTaskExternalIdOrThrow,
  replaceTaskExternalIdOrThrow: taskMock.replaceTaskExternalIdOrThrow,
}))
vi.mock('@/lib/workers/utils', () => ({
  getTaskExistingExternalId: taskMock.getTaskExistingExternalId,
}))

import { resolveDurableFalVoiceAudioUrl } from '@/lib/voice/fal-voice-provider'
import { normalizeAnyError } from '@/lib/errors/normalize'

function buildJob(options?: { attemptsMade?: number; attempts?: number }): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-a',
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

const input = {
  audio_url: 'data:audio/wav;base64,cmVm',
  prompt: 'hello',
  should_use_prompt_for_emotion: true,
  strength: 0.4,
}

describe('durable FAL voice provider handoff', () => {
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
    queueMock.status.mockResolvedValue({ status: 'COMPLETED' })
    queueMock.result.mockResolvedValue({ data: { audio: { url: 'https://provider.example/audio.wav' } } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[既有 durable request id] -> [0 submit，直接恢復 provider result]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const job = buildJob()

    await expect(resolveDurableFalVoiceAudioUrl({
      job,
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })).resolves.toBe('https://provider.example/audio.wav')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(job.updateData).not.toHaveBeenCalled()
    expect(queueMock.result).toHaveBeenCalledWith(
      'fal-ai/index-tts-2/text-to-speech',
      expect.objectContaining({
        requestId: 'req-1',
        abortSignal: expect.any(AbortSignal),
      }),
    )
  })

  it('[既有 durable request endpoint 與 pinned endpoint 不同] -> [0 credential/0 provider call 且 quarantine]', async () => {
    const job = buildJob()
    job.data.providerExternalId = 'FAL:VOICE:fal-ai/other-model:req-1'
    const resolveApiKey = vi.fn(async () => 'secret')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableFalVoiceAudioUrl({
      job,
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      resolveApiKey,
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('VOICE_PROVIDER_EXTERNAL_ID_CONTEXT_MISMATCH'),
    })

    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(taskMock.persistTaskExternalIdOrThrow).not.toHaveBeenCalled()
    expect(falClientMock.createFalClient).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('[paid handoff credential 暫缺且仍有 retry] -> [retryable 且 0 provider call]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-paid',
    )
    const missingCredential = new Error('PROVIDER_API_KEY_MISSING: fal')
    const resolveApiKey = vi.fn(async () => { throw missingCredential })

    let rejection: unknown
    try {
      await resolveDurableFalVoiceAudioUrl({
        job: buildJob({ attemptsMade: 1, attempts: 5 }),
        endpoint: 'fal-ai/index-tts-2/text-to-speech',
        resolveApiKey,
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'VOICE_PROVIDER_CREDENTIAL_UNAVAILABLE',
      code: 'EXTERNAL_ERROR',
      cause: missingCredential,
    })
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(true)
    expect(falClientMock.createFalClient).not.toHaveBeenCalled()
    expect(queueMock.status).not.toHaveBeenCalled()
  })

  it('[paid handoff credential 在最後一次仍缺] -> [quarantine Task 且不可進 generic refund path]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValue(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-paid',
    )
    const resolveApiKey = vi.fn(async () => {
      throw new Error('PROVIDER_API_KEY_MISSING: fal')
    })

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      resolveApiKey,
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('VOICE_PROVIDER_CREDENTIAL_QUARANTINED'),
    })

    expect(falClientMock.createFalClient).not.toHaveBeenCalled()
    expect(queueMock.status).not.toHaveBeenCalled()
  })

  it('[new submit credential 暫缺] -> [claim/POST 前 retryable，未付費所以不 quarantine]', async () => {
    const resolveApiKey = vi.fn(async () => {
      throw new Error('PROVIDER_API_KEY_MISSING: fal')
    })

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      resolveApiKey,
    })).rejects.toMatchObject({
      message: 'VOICE_PROVIDER_CREDENTIAL_UNAVAILABLE',
      code: 'EXTERNAL_ERROR',
    })

    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(falClientMock.createFalClient).not.toHaveBeenCalled()
  })

  it('[首次 submit 成功] -> [先把 exact request id 寫入 job+DB，再輪詢結果]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ request_id: 'req-new' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const job = buildJob()

    await resolveDurableFalVoiceAudioUrl({
      job,
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(job.updateData).toHaveBeenCalledWith(expect.objectContaining({
      providerExternalId: 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-new',
    }))
    const claimId = taskMock.claimTaskExternalId.mock.calls[0]?.[1]
    expect(claimId).toMatch(/^FAL:VOICE:CLAIM:/)
    expect(taskMock.replaceTaskExternalIdOrThrow).toHaveBeenCalledWith(
      'task-a',
      claimId,
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-new',
    )
  })

  it('[atomic claim 已被另一 worker 贏得] -> [loser 0 POST，直接沿用 winner request id]', async () => {
    taskMock.claimTaskExternalId.mockResolvedValueOnce({
      claimed: false,
      externalId: 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-winner',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })).resolves.toBe('https://provider.example/audio.wav')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
    expect(queueMock.result).toHaveBeenCalledWith(
      'fal-ai/index-tts-2/text-to-speech',
      expect.objectContaining({ requestId: 'req-winner' }),
    )
  })

  it('[另一個 processor 正持有 fresh submit claim] -> [loser 0 POST 且不把共享 Task 標成失敗]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      `FAL:VOICE:CLAIM:${Date.now()}:other-processor`,
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })).rejects.toMatchObject({ name: 'TaskTerminatedError' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
  })

  it.each([
    ['expired', `FAL:VOICE:CLAIM:${Date.now() - 60_001}:old-owner`],
    ['unparseable', 'FAL:VOICE:CLAIM:not-a-timestamp:unknown-owner'],
  ])('[%s submit claim] -> [quarantine active handoff 且 0 POST/0 replacement]', async (_label, claimId) => {
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(claimId)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      taskId: 'task-a',
      message: 'VOICE_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED',
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(taskMock.persistTaskExternalIdOrThrow).not.toHaveBeenCalled()
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
    expect(falClientMock.createFalClient).not.toHaveBeenCalled()
  })

  it('[job 已有 actual id、DB 尚停在本 worker claim] -> [以 exact CAS 修復 DB 且 0 POST]', async () => {
    const claimId = 'FAL:VOICE:CLAIM:owned-before-response-loss'
    const actualId = 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-repair'
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(claimId)
    const job = buildJob()
    job.data.providerExternalId = actualId
    job.data.payload = { voiceProviderSubmitClaimId: claimId }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableFalVoiceAudioUrl({
      job,
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })).resolves.toBe('https://provider.example/audio.wav')

    expect(taskMock.replaceTaskExternalIdOrThrow).toHaveBeenCalledWith(
      'task-a',
      claimId,
      actualId,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(queueMock.result).toHaveBeenCalledWith(
      'fal-ai/index-tts-2/text-to-speech',
      expect.objectContaining({ requestId: 'req-repair' }),
    )
  })

  it('[submit acknowledgement 遺失] -> [normalize 後 non-retryable，且只有一個 POST]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('socket reset'))

    let rejection: unknown
    try {
      await resolveDurableFalVoiceAudioUrl({
        job: buildJob(),
        endpoint: 'fal-ai/index-tts-2/text-to-speech',
        input,
        apiKey: 'secret',
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN',
      code: 'INVALID_PARAMS',
    })
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
  })

  it('[submit 回 503] -> [outcome unknown normalize 後仍 non-retryable，0 第二 POST]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      'upstream unavailable',
      { status: 503 },
    ))

    let rejection: unknown
    try {
      await resolveDurableFalVoiceAudioUrl({
        job: buildJob(),
        endpoint: 'fal-ai/index-tts-2/text-to-speech',
        input,
        apiKey: 'secret',
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({ code: 'INVALID_PARAMS' })
    expect(String((rejection as Error)?.message)).toContain('VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN_503')
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
  })

  it('[submit 超時] -> [abort request、normalize 後 non-retryable，0 第二 POST]', async () => {
    vi.useFakeTimers()
    let submitSignal: AbortSignal | null = null
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      submitSignal = init?.signal as AbortSignal
      return await new Promise<Response>((_resolve, reject) => {
        submitSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const pending = resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })
    const settled = pending.then(
      () => ({ rejection: null as unknown }),
      (rejection: unknown) => ({ rejection }),
    )
    await vi.advanceTimersByTimeAsync(30_000)

    const { rejection } = await settled
    expect(rejection).toMatchObject({
      message: 'VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN',
      code: 'INVALID_PARAMS',
    })
    expect((submitSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(taskMock.replaceTaskExternalIdOrThrow).not.toHaveBeenCalled()
  })

  it('[provider id 已寫入 job，但 DB claim replace 暫失敗] -> [保留 actual id 供 retry 修復且不進 poll]', async () => {
    taskMock.replaceTaskExternalIdOrThrow.mockRejectedValueOnce(new Error('db unavailable'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ request_id: 'req-safe' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const job = buildJob()

    await expect(resolveDurableFalVoiceAudioUrl({
      job,
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })).rejects.toThrow('db unavailable')
    expect(job.data.providerExternalId).toBe(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-safe',
    )
    expect(job.data.payload).toEqual(expect.objectContaining({
      voiceProviderSubmitClaimId: expect.stringMatching(/^FAL:VOICE:CLAIM:/),
    }))
    expect(queueMock.status).not.toHaveBeenCalled()
  })

  it('[status/result provider calls] -> [兩者都收到獨立 AbortSignal]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-signals',
    )

    await resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })

    const statusSignal = queueMock.status.mock.calls[0]?.[1]?.abortSignal
    const resultSignal = queueMock.result.mock.calls[0]?.[1]?.abortSignal
    expect(statusSignal).toBeInstanceOf(AbortSignal)
    expect(resultSignal).toBeInstanceOf(AbortSignal)
    expect(resultSignal).not.toBe(statusSignal)
  })

  it('[status 單次請求超時且仍有 retry] -> [abort 該次連線並回 retryable timeout]', async () => {
    vi.useFakeTimers()
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-status-timeout',
    )
    let statusSignal: AbortSignal | null = null
    queueMock.status.mockImplementationOnce(async (_endpoint, options) => {
      statusSignal = options.abortSignal
      return await new Promise((_resolve, reject) => {
        statusSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const pending = resolveDurableFalVoiceAudioUrl({
      job: buildJob({ attemptsMade: 1, attempts: 5 }),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
    })
    const settled = pending.then(
      () => ({ rejection: null as unknown }),
      (rejection: unknown) => ({ rejection }),
    )
    await vi.advanceTimersByTimeAsync(30_000)

    const { rejection } = await settled
    expect(rejection).toMatchObject({
      message: 'VOICE_PROVIDER_STATUS_TIMEOUT',
      code: 'EXTERNAL_ERROR',
    })
    expect((statusSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(queueMock.result).not.toHaveBeenCalled()
  })

  it('[paid status transport 在最後一次失敗] -> [quarantine Task 且不進 generic refund path]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-final-status',
    )
    queueMock.status.mockRejectedValueOnce(Object.assign(
      new Error('upstream unavailable'),
      { status: 503 },
    ))

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      apiKey: 'secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('VOICE_PROVIDER_STATUS_QUARANTINED'),
    })

    expect(queueMock.status).toHaveBeenCalledWith(
      'fal-ai/index-tts-2/text-to-speech',
      expect.objectContaining({ requestId: 'req-final-status' }),
    )
    expect(queueMock.result).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it.each([undefined, 'FAILED', 'UNKNOWN'])(
    '[paid FAL status %s is outside the documented queue contract] -> [quarantine without treating it as a terminal refund signal]',
    async (status) => {
      taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
        'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-unknown-status',
      )
      queueMock.status.mockResolvedValueOnce({ status })

      await expect(resolveDurableFalVoiceAudioUrl({
        job: buildJob({ attemptsMade: 4, attempts: 5 }),
        endpoint: 'fal-ai/index-tts-2/text-to-speech',
        apiKey: 'secret',
      })).rejects.toMatchObject({
        name: 'TaskTerminatedError',
        message: expect.stringContaining('VOICE_PROVIDER_STATUS_QUARANTINED'),
      })

      expect(queueMock.result).not.toHaveBeenCalled()
      expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
    },
  )

  it('[paid status request 在最後一次超時] -> [abort 並 quarantine Task]', async () => {
    vi.useFakeTimers()
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-final-status-timeout',
    )
    let statusSignal: AbortSignal | null = null
    queueMock.status.mockImplementationOnce(async (_endpoint, options) => {
      statusSignal = options.abortSignal
      return await new Promise((_resolve, reject) => {
        statusSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const settled = resolveDurableFalVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      apiKey: 'secret',
    }).then(
      () => ({ rejection: null as unknown }),
      (rejection: unknown) => ({ rejection }),
    )
    await vi.advanceTimersByTimeAsync(30_000)

    const { rejection } = await settled
    expect(rejection).toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('VOICE_PROVIDER_STATUS_QUARANTINED'),
    })
    expect((statusSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(queueMock.result).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[paid result transport 在最後一次失敗] -> [quarantine Task 且不重新 submit]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-final-result',
    )
    queueMock.result.mockRejectedValueOnce(Object.assign(
      new Error('result gateway unavailable'),
      { status: 503 },
    ))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob({ attemptsMade: 4, attempts: 5 }),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      apiKey: 'secret',
    })).rejects.toMatchObject({
      name: 'TaskTerminatedError',
      message: expect.stringContaining('VOICE_PROVIDER_RESULT_QUARANTINED'),
    })

    expect(queueMock.result).toHaveBeenCalledWith(
      'fal-ai/index-tts-2/text-to-speech',
      expect.objectContaining({ requestId: 'req-final-result' }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[paid result transport 失敗但仍有 retry] -> [保留 retryable error 且不重新 submit]', async () => {
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-retry-result',
    )
    queueMock.result.mockRejectedValueOnce(new Error('result gateway unavailable'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    let rejection: unknown
    try {
      await resolveDurableFalVoiceAudioUrl({
        job: buildJob({ attemptsMade: 1, attempts: 5 }),
        endpoint: 'fal-ai/index-tts-2/text-to-speech',
        apiKey: 'secret',
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'VOICE_PROVIDER_RESULT_FAILED',
      code: 'EXTERNAL_ERROR',
    })
    expect(normalizeAnyError(rejection, { context: 'worker' }).retryable).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(taskMock.claimTaskExternalId).not.toHaveBeenCalled()
  })

  it('[等待 result 時 task 被取消] -> [cancel check abort provider result 並保留原取消錯誤]', async () => {
    vi.useFakeTimers()
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-result-cancel',
    )
    const cancelled = Object.assign(new Error('TASK_CANCELLED'), { code: 'TASK_CANCELLED' })
    const checkCancelled = vi.fn(async (stage: string) => {
      if (stage === 'voice_line_provider_result') throw cancelled
    })
    let resultSignal: AbortSignal | null = null
    queueMock.result.mockImplementationOnce(async (_endpoint, options) => {
      resultSignal = options.abortSignal
      return await new Promise((_resolve, reject) => {
        resultSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const pending = resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
      checkCancelled,
    })
    const settled = pending.then(
      () => ({ rejection: null as unknown }),
      (rejection: unknown) => ({ rejection }),
    )
    await vi.advanceTimersByTimeAsync(1_000)

    const { rejection } = await settled
    expect(rejection).toBe(cancelled)
    expect((resultSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(checkCancelled).toHaveBeenCalledWith('voice_line_provider_result')
  })

  it('[真實 assertTaskActive cancellation] -> [保留 TaskTerminatedError，不包成 retryable provider failure]', async () => {
    vi.useFakeTimers()
    taskMock.getTaskExistingExternalId.mockResolvedValueOnce(
      'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-real-cancel',
    )
    const cancelled = new TaskTerminatedError(
      'task-a',
      'Task terminated during voice_line_provider_result',
    )
    const checkCancelled = vi.fn(async (stage: string) => {
      if (stage === 'voice_line_provider_result') throw cancelled
    })
    queueMock.result.mockImplementationOnce(async (_endpoint, options) => (
      await new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    ))

    const settled = resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      input,
      apiKey: 'secret',
      checkCancelled,
    }).then(
      () => ({ rejection: null as unknown }),
      (rejection: unknown) => ({ rejection }),
    )
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(settled).resolves.toEqual({ rejection: cancelled })
  })

  it('[prepared retry 缺 durable provider id] -> [不重送付費 request，顯式失敗]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(resolveDurableFalVoiceAudioUrl({
      job: buildJob(),
      endpoint: 'fal-ai/index-tts-2/text-to-speech',
      apiKey: 'secret',
    })).rejects.toMatchObject({
      message: 'VOICE_PROVIDER_EXTERNAL_ID_REQUIRED',
      code: 'INVALID_PARAMS',
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

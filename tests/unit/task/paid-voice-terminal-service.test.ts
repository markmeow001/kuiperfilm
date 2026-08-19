import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { paidVoiceProviderTerminalErrorCode } from '@/lib/task/voice-line-recovery-policy'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({ rollbackTaskBilling: vi.fn() }))
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async <T>(operation: () => Promise<T>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))

import {
  getPaidVoiceProviderHandoffSnapshot,
  tryMarkPaidVoiceTaskFailedBeforeProviderHandoff,
  tryMarkPaidVoiceProviderTerminalFailure,
} from '@/lib/task/service'

describe('paid voice provider terminal lifecycle service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
  })

  it('[active VoiceLine has exact Atlas id] -> [returns an auditable actual handoff snapshot]', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      type: TASK_TYPE.VOICE_LINE,
      status: TASK_STATUS.PROCESSING,
      progress: 61,
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
    })

    await expect(getPaidVoiceProviderHandoffSnapshot(
      'task-1',
      TASK_TYPE.VOICE_LINE,
    )).resolves.toEqual({
      status: TASK_STATUS.PROCESSING,
      progress: 61,
      handoff: {
        kind: 'actual',
        provider: 'atlascloud',
        externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
      },
    })
  })

  it.each(['failed', 'timeout'] as const)('[Atlas terminal %s on HTTP-idempotent VoiceLine] -> [fails and retains key for lost-response replay]', async (terminalStatus) => {
    const externalId = 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-terminal'
    prismaMock.task.findUnique.mockResolvedValue({
      type: TASK_TYPE.VOICE_LINE,
      status: TASK_STATUS.PROCESSING,
      progress: 70,
      externalId,
    })

    await expect(tryMarkPaidVoiceProviderTerminalFailure({
      taskId: 'task-voice-1',
      expectedTaskType: TASK_TYPE.VOICE_LINE,
      externalId,
      terminalStatus,
      errorMessage: `provider ${terminalStatus}`,
    })).resolves.toBe(true)

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-voice-1',
        type: TASK_TYPE.VOICE_LINE,
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        externalId,
      },
      data: {
        status: TASK_STATUS.FAILED,
        errorCode: paidVoiceProviderTerminalErrorCode(terminalStatus),
        errorMessage: `provider ${terminalStatus}`,
        finishedAt: expect.any(Date),
        heartbeatAt: null,
      },
    })
    expect(prismaMock.task.updateMany.mock.calls.at(-1)?.[0].data).not.toHaveProperty('dedupeKey')
  })

  it('[retired provider id reports terminal failed] -> [refuses the terminal marker and leaves the handoff quarantined]', async () => {
    const externalId = 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-terminal'
    prismaMock.task.findUnique.mockResolvedValue({
      type: TASK_TYPE.VOICE_LINE,
      status: TASK_STATUS.PROCESSING,
      progress: 72,
      externalId,
    })

    // Voice is AtlasCloud-only, so this id is unrecognised rather than an
    // actual resumable handoff. Marking it terminal here would hand it to the
    // generic fail/refund lifecycle for a request we cannot prove was
    // rejected; it must stay put for manual reconciliation instead.
    await expect(tryMarkPaidVoiceProviderTerminalFailure({
      taskId: 'task-retired-provider',
      expectedTaskType: TASK_TYPE.VOICE_LINE,
      externalId,
      terminalStatus: 'failed',
      errorMessage: 'VOICE_PROVIDER_REQUEST_FAILED',
    })).resolves.toBe(false)

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[Canvas idempotency request reaches explicit provider terminal] -> [fails but retains its replay key]', async () => {
    const externalId = 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-canvas-terminal'
    prismaMock.task.findUnique.mockResolvedValue({
      type: TASK_TYPE.CANVAS_TTS,
      status: TASK_STATUS.PROCESSING,
      progress: 40,
      externalId,
    })

    await expect(tryMarkPaidVoiceProviderTerminalFailure({
      taskId: 'task-canvas-1',
      expectedTaskType: TASK_TYPE.CANVAS_TTS,
      externalId,
      terminalStatus: 'failed',
      errorMessage: 'ATLAS_AUDIO_PROVIDER_REQUEST_FAILED',
    })).resolves.toBe(true)

    const data = prismaMock.task.updateMany.mock.calls.at(-1)?.[0].data
    expect(data).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'VOICE_PROVIDER_TERMINAL_FAILED',
    })
    expect(data).not.toHaveProperty('dedupeKey')
  })

  it.each([
    'ATLASCLOUD:AUDIO:CLAIM:123:owner',
    'malformed-paid-handoff',
  ])('[handoff %s is not an actual provider id] -> [refuses terminal transition and preserves freeze/dedupe]', async (externalId) => {
    prismaMock.task.findUnique.mockResolvedValue({
      type: TASK_TYPE.VOICE_LINE,
      status: TASK_STATUS.PROCESSING,
      progress: 10,
      externalId,
    })

    await expect(tryMarkPaidVoiceProviderTerminalFailure({
      taskId: 'task-unsafe',
      expectedTaskType: TASK_TYPE.VOICE_LINE,
      externalId,
      terminalStatus: 'failed',
      errorMessage: 'provider failed',
    })).resolves.toBe(false)

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[paid VoiceLine has no handoff] -> [generic failure CAS proves externalId is still empty]', async () => {
    await expect(tryMarkPaidVoiceTaskFailedBeforeProviderHandoff({
      taskId: 'task-before-submit',
      expectedTaskType: TASK_TYPE.VOICE_LINE,
      errorCode: 'INVALID_PARAMS',
      errorMessage: 'input rejected before submit',
    })).resolves.toBe(true)

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-before-submit',
        type: TASK_TYPE.VOICE_LINE,
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        OR: [{ externalId: null }, { externalId: '' }],
      },
      data: {
        status: TASK_STATUS.FAILED,
        errorCode: 'INVALID_PARAMS',
        errorMessage: 'input rejected before submit',
        finishedAt: expect.any(Date),
        heartbeatAt: null,
      },
    })
  })
})

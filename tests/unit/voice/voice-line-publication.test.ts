import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'
import { stablePublicIdFromStorageKey } from '@/lib/media/hash'

const cosMock = vi.hoisted(() => ({
  deleteCOSObject: vi.fn(async () => undefined),
}))

const prismaMock = vi.hoisted(() => {
  const tx = {
    task: {
      updateMany: vi.fn(),
    },
    novelPromotionVoiceLine: {
      updateMany: vi.fn(),
    },
  }
  return {
    task: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    novelPromotionVoiceLine: {
      findFirst: vi.fn(),
    },
    mediaObject: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    tx,
  }
})

vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('server-only', () => ({}))

import type {
  VoiceLinePreparedOutput,
  VoiceLineTaskResult,
} from '@/lib/voice/voice-line-publication'
import * as voiceLinePublication from '@/lib/voice/voice-line-publication'

const {
  claimVoiceLineCompletion,
  persistVoiceLinePreparedOutput,
  readVoiceLinePreparedOutput,
  reconcileVoiceLineTerminalState,
  voiceLineStorageKey,
} = voiceLinePublication

async function reconcileVoiceLineLateUpload(
  job: Job<TaskJobData>,
  marker: VoiceLinePreparedOutput,
): Promise<'deleted'> {
  const reconcile = (
    voiceLinePublication as unknown as {
      reconcileVoiceLineLateUpload: (
        inputJob: Job<TaskJobData>,
        inputMarker: VoiceLinePreparedOutput,
      ) => Promise<'deleted'>
    }
  ).reconcileVoiceLineLateUpload
  return await reconcile(job, marker)
}

const SOURCE_FINGERPRINT = 'f'.repeat(64)
const AUDIO_SHA256 = 'a'.repeat(64)
const OUTPUT_URL = `voice/project-a/episode-a/line-a/37bbbbed5fd87cbc8c1b2084b1c48b52-${AUDIO_SHA256}.wav`
const STABLE_ALIAS = `/m/${encodeURIComponent(stablePublicIdFromStorageKey(OUTPUT_URL))}`

function baseOutputReferenceFilters() {
  return [
    { audioUrl: OUTPUT_URL },
    { audioMedia: { is: { storageKey: OUTPUT_URL } } },
    { audioUrl: STABLE_ALIAS },
    { audioUrl: { startsWith: `${STABLE_ALIAS}?` } },
    { audioUrl: { startsWith: `${STABLE_ALIAS}#` } },
  ]
}

const result: VoiceLineTaskResult = {
  lineId: 'line-a',
  audioUrl: OUTPUT_URL,
  storageKey: OUTPUT_URL,
  audioDuration: 1_250,
}

const preparedMarker: VoiceLinePreparedOutput = {
  kind: 'voice_line_publication_v1',
  state: 'prepared',
  taskId: 'task-a',
  projectId: 'project-a',
  episodeId: 'episode-a',
  lineId: 'line-a',
  sourceFingerprint: SOURCE_FINGERPRINT,
  outputUrl: OUTPUT_URL,
  audioSha256: AUDIO_SHA256,
  audioBytes: 321,
  audioDuration: 1_250,
  input: {
    speaker: 'Ann',
    content: 'Hello',
    voicePresetId: null,
    emotionPrompt: 'calm',
    emotionStrength: 0.5,
    speakerVoices: JSON.stringify({ Ann: { voicePresetId: 'preset-system' } }),
    audioUrl: 'voice/project-a/episode-a/line-a/previous.wav',
    audioMediaId: null,
    audioDuration: 900,
  },
  result,
}

function makeJob(overrides?: Partial<TaskJobData> & { id?: string }): Job<TaskJobData> {
  const { id = 'task-a', ...dataOverrides } = overrides || {}
  return {
    id,
    data: {
      taskId: 'task-a',
      type: 'voice_line',
      locale: 'zh',
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-a',
      payload: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        sourceFingerprint: SOURCE_FINGERPRINT,
      },
      ...dataOverrides,
    },
  } as unknown as Job<TaskJobData>
}

function failedTask(marker: unknown = preparedMarker) {
  return {
    status: 'failed',
    errorCode: 'TASK_CANCELLED',
    payload: marker === null ? {} : { voiceLinePublication: marker },
    result: null,
    finishedAt: new Date('2026-08-10T00:00:00.000Z'),
  }
}

function unreferencedLine() {
  return {
    audioUrl: 'voice/project-a/episode-a/line-a/previous.wav',
    audioDuration: 900,
  }
}

describe('voice line publication lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.tx.task.updateMany.mockReset().mockResolvedValue({ count: 1 })
    prismaMock.tx.novelPromotionVoiceLine.updateMany.mockReset().mockResolvedValue({ count: 1 })
    prismaMock.task.findFirst.mockReset().mockResolvedValue(null)
    prismaMock.task.updateMany.mockReset().mockResolvedValue({ count: 1 })
    prismaMock.novelPromotionVoiceLine.findFirst.mockReset().mockResolvedValue(null)
    prismaMock.mediaObject.findUnique.mockReset().mockResolvedValue(null)
    cosMock.deleteCOSObject.mockReset().mockResolvedValue(undefined)
  })

  function taskMarkerForClaim() {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'processing',
      payload: { voiceLinePublication: preparedMarker },
      result: null,
      finishedAt: null,
      errorCode: null,
    })
  }

  it('[prepared marker] -> [persists only while the exact task is active]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'processing',
      payload: { existing: 'kept' },
    })

    await expect(persistVoiceLinePreparedOutput(makeJob(), preparedMarker)).resolves.toBeUndefined()

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-a',
        userId: 'user-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
        type: 'voice_line',
        targetType: 'NovelPromotionVoiceLine',
        targetId: 'line-a',
        status: { in: ['queued', 'processing'] },
        payload: { equals: { existing: 'kept' } },
      },
      data: {
        payload: {
          existing: 'kept',
          voiceLinePublication: preparedMarker,
        },
      },
    })
  })

  it('[same prepared marker replay] -> [returns without overwriting the durable first writer]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'processing',
      payload: { voiceLinePublication: preparedMarker },
    })

    await expect(persistVoiceLinePreparedOutput(makeJob(), preparedMarker)).resolves.toBeUndefined()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[overlapping processor prepares different bytes] -> [first durable marker wins and loser cannot overwrite]', async () => {
    const competingMarker: VoiceLinePreparedOutput = {
      ...preparedMarker,
      outputUrl: preparedMarker.outputUrl.replace(AUDIO_SHA256, 'b'.repeat(64)),
      audioSha256: 'b'.repeat(64),
      audioBytes: preparedMarker.audioBytes + 1,
      result: {
        ...preparedMarker.result,
        audioUrl: preparedMarker.outputUrl.replace(AUDIO_SHA256, 'b'.repeat(64)),
        storageKey: preparedMarker.outputUrl.replace(AUDIO_SHA256, 'b'.repeat(64)),
      },
    }
    prismaMock.task.findFirst
      .mockResolvedValueOnce({ status: 'processing', payload: { existing: 'kept' } })
      .mockResolvedValueOnce({
        status: 'processing',
        payload: { existing: 'kept', voiceLinePublication: competingMarker },
      })
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(persistVoiceLinePreparedOutput(makeJob(), preparedMarker)).rejects.toThrow(
      'Another processor already prepared the voice line output',
    )
    expect(prismaMock.task.updateMany).toHaveBeenCalledTimes(1)
  })

  it('[storage identity] -> [uses exact task tuple plus audio content hash]', () => {
    expect(voiceLineStorageKey(makeJob(), AUDIO_SHA256)).toBe(OUTPUT_URL)
    expect(() => voiceLineStorageKey(makeJob(), 'not-a-sha')).toThrow(
      'VOICE_LINE_AUDIO_FINGERPRINT_INVALID',
    )
  })

  it('[terminal task before marker persist] -> [does not create deletion authority]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({ status: 'failed', payload: {} })

    await expect(persistVoiceLinePreparedOutput(makeJob(), preparedMarker)).rejects.toThrow(
      'Task terminated before voice line upload marker was stored',
    )
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[durable marker read] -> [returns the exact validated marker]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'processing',
      payload: { voiceLinePublication: preparedMarker },
      result: null,
      finishedAt: null,
      errorCode: null,
    })

    await expect(readVoiceLinePreparedOutput(makeJob())).resolves.toEqual(preparedMarker)
  })

  it('[completion winner] -> [atomically completes Task and writes audio through input/project CAS]', async () => {
    const billing = {
      billingInfo: { billable: false as const, source: 'task' as const, status: 'skipped' as const },
      billedAt: new Date('2026-08-10T00:00:00.000Z'),
    }

    taskMarkerForClaim()
    await expect(claimVoiceLineCompletion(makeJob(), result, billing)).resolves.toBe(true)

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'task-a',
        userId: 'user-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
        type: 'voice_line',
        targetType: 'NovelPromotionVoiceLine',
        targetId: 'line-a',
        status: { in: ['queued', 'processing'] },
        payload: { equals: { voiceLinePublication: preparedMarker } },
      }),
      data: expect.objectContaining({
        status: 'completed',
        progress: 100,
        result,
        finishedAt: expect.any(Date),
        heartbeatAt: null,
        payload: expect.objectContaining({
          voiceLinePublication: preparedMarker,
          voiceLineCompletionClaimId: expect.any(String),
        }),
        billingInfo: billing.billingInfo,
        billedAt: billing.billedAt,
      }),
    }))
    expect(prismaMock.tx.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'line-a',
        episodeId: 'episode-a',
        speaker: 'Ann',
        content: 'Hello',
        voicePresetId: null,
        emotionPrompt: 'calm',
        emotionStrength: 0.5,
        audioUrl: 'voice/project-a/episode-a/line-a/previous.wav',
        audioMediaId: null,
        audioDuration: 900,
        episode: {
          speakerVoices: preparedMarker.input.speakerVoices,
          novelPromotionProject: { projectId: 'project-a' },
        },
      },
      data: {
        audioUrl: OUTPUT_URL,
        audioMediaId: null,
        audioDuration: 1_250,
      },
    })
  })

  it('[user replaces audio while generation runs] -> [completion CAS refuses to overwrite it]', async () => {
    taskMarkerForClaim()
    prismaMock.tx.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'processing',
      errorCode: null,
      payload: { voiceLinePublication: preparedMarker },
      result: null,
      finishedAt: null,
    })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      audioUrl: 'voice/project-a/episode-a/line-a/user-replacement.wav',
      audioMediaId: 'media-user-replacement',
      audioDuration: 2_000,
    })

    await expect(claimVoiceLineCompletion(makeJob(), result)).rejects.toThrow(
      'VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[handler result differs from durable marker] -> [rejects before completion transaction]', async () => {
    taskMarkerForClaim()

    await expect(claimVoiceLineCompletion(makeJob(), {
      ...result,
      audioDuration: result.audioDuration! + 1,
    })).rejects.toThrow('VOICE_LINE_RESULT_CONTEXT_INVALID')

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[cancel wins after upload] -> [strictly deletes only the exact unreferenced marker output]', async () => {
    taskMarkerForClaim()
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValue(failedTask())
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(unreferencedLine())

    await expect(claimVoiceLineCompletion(makeJob(), result)).resolves.toBe(false)

    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(OUTPUT_URL, { throwOnError: true })
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-a', projectId: 'project-a', episodeId: 'episode-a' }),
      data: {
        payload: {
          voiceLinePublication: expect.objectContaining({ state: 'deleted' }),
        },
      },
    }))
  })

  it('[completion transaction response is lost but committed] -> [scoped reread reconciles success]', async () => {
    taskMarkerForClaim()
    let committedPayload: Record<string, unknown> | null = null
    prismaMock.$transaction.mockImplementationOnce(async (operation) => {
      await operation(prismaMock.tx)
      committedPayload = (
        prismaMock.tx.task.updateMany.mock.calls.at(-1)?.[0]?.data?.payload
      ) as Record<string, unknown>
      throw new Error('database response lost')
    })
    prismaMock.task.findFirst.mockImplementationOnce(async () => ({
      status: 'completed',
      errorCode: null,
      payload: committedPayload,
      result,
      finishedAt: new Date('2026-08-10T00:00:00.000Z'),
    }))
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      audioUrl: OUTPUT_URL,
      audioMediaId: null,
      audioDuration: 1_250,
    })

    await expect(claimVoiceLineCompletion(makeJob(), result)).resolves.toBe(true)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[overlap completion loser sees identical receipt] -> [does not settle or publish as the winner]', async () => {
    taskMarkerForClaim()
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'completed',
      errorCode: null,
      payload: {
        voiceLinePublication: preparedMarker,
        voiceLineCompletionClaimId: 'another-processor',
      },
      result,
      finishedAt: new Date('2026-08-10T00:00:00.000Z'),
    })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      audioUrl: OUTPUT_URL,
      audioMediaId: null,
      audioDuration: 1_250,
    })

    await expect(claimVoiceLineCompletion(makeJob(), result)).resolves.toBe(false)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[completion outcome reread is unknown] -> [retains output and fails closed]', async () => {
    taskMarkerForClaim()
    prismaMock.$transaction.mockRejectedValueOnce(new Error('database response lost'))
    prismaMock.task.findFirst.mockRejectedValueOnce(new Error('database still unavailable'))

    await expect(claimVoiceLineCompletion(makeJob(), result)).rejects.toThrow(
      'VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[cleanup fails] -> [persists cleanup_failed marker for observable retry]', async () => {
    taskMarkerForClaim()
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce(failedTask())
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(unreferencedLine())
    cosMock.deleteCOSObject.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(claimVoiceLineCompletion(makeJob(), result)).rejects.toThrow(
      'VOICE_LINE_OUTPUT_CLEANUP_FAILED',
    )
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        payload: {
          voiceLinePublication: expect.objectContaining({
            state: 'cleanup_failed',
            cleanupError: 'storage unavailable',
          }),
        },
      },
    }))
  })

  it('[terminal cleanup_failed marker] -> [retries delete and advances marker to deleted]', async () => {
    const cleanupFailedMarker = {
      ...preparedMarker,
      state: 'cleanup_failed' as const,
      cleanupError: 'previous outage',
    }
    prismaMock.task.findFirst.mockResolvedValue(failedTask(cleanupFailedMarker))
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(unreferencedLine())
      .mockResolvedValueOnce(null)

    await expect(reconcileVoiceLineTerminalState(makeJob())).resolves.toBe('deleted')
    expect(cosMock.deleteCOSObject).toHaveBeenCalledTimes(1)
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        payload: {
          voiceLinePublication: expect.objectContaining({ state: 'deleted' }),
        },
      },
    }))
  })

  it('[cleanup marker payload CAS loses to concurrent metadata write] -> [rereads, preserves metadata, and persists deleted state]', async () => {
    const initialPayload = {
      voiceLinePublication: preparedMarker,
      workerMeta: { version: 1 },
    }
    const latestPayload = {
      voiceLinePublication: preparedMarker,
      workerMeta: { version: 2 },
    }
    prismaMock.task.findFirst
      .mockResolvedValueOnce({
        ...failedTask(),
        payload: initialPayload,
      })
      .mockResolvedValueOnce({
        ...failedTask(),
        payload: initialPayload,
      })
      .mockResolvedValueOnce({
        ...failedTask(),
        payload: latestPayload,
      })
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(unreferencedLine())
      .mockResolvedValueOnce(null)
    prismaMock.task.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    await expect(reconcileVoiceLineTerminalState(makeJob())).resolves.toBe('deleted')

    expect(prismaMock.task.updateMany.mock.calls[1]?.[0]).toEqual({
      where: expect.objectContaining({
        id: 'task-a',
        payload: { equals: latestPayload },
      }),
      data: {
        payload: {
          ...latestPayload,
          voiceLinePublication: expect.objectContaining({ state: 'deleted' }),
        },
      },
    })
  })

  it('[confirmed late PUT lands after deleted tombstone] -> [strictly re-deletes that exact durable key once]', async () => {
    const deletedMarker = {
      ...preparedMarker,
      state: 'deleted' as const,
    }
    prismaMock.task.findFirst.mockResolvedValueOnce(failedTask(deletedMarker))
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    await expect(
      reconcileVoiceLineLateUpload(makeJob(), preparedMarker),
    ).resolves.toBe('deleted')

    expect(prismaMock.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'task-a',
        userId: 'user-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
        type: 'voice_line',
        targetType: 'NovelPromotionVoiceLine',
        targetId: 'line-a',
      },
      select: {
        status: true,
        errorCode: true,
        payload: true,
        result: true,
        finishedAt: true,
      },
    })
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          ...baseOutputReferenceFilters(),
        ],
      },
      select: { id: true },
    })
    expect(cosMock.deleteCOSObject).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(OUTPUT_URL, { throwOnError: true })
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[confirmed late PUT sees cleanup_failed durable marker] -> [retries exact delete and advances to deleted]', async () => {
    const cleanupFailedMarker = {
      ...preparedMarker,
      state: 'cleanup_failed' as const,
      cleanupError: 'previous storage outage',
    }
    prismaMock.task.findFirst.mockResolvedValueOnce(failedTask(cleanupFailedMarker))
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    await expect(
      reconcileVoiceLineLateUpload(makeJob(), preparedMarker),
    ).resolves.toBe('deleted')

    expect(cosMock.deleteCOSObject).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(OUTPUT_URL, { throwOnError: true })
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'task-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
        targetId: 'line-a',
      }),
      data: {
        payload: {
          voiceLinePublication: expect.objectContaining({
            state: 'deleted',
            outputUrl: OUTPUT_URL,
          }),
        },
      },
    }))
  })

  it('[target VoiceLine was removed before confirmed late-PUT cleanup] -> [global zero-reference proof still permits exact delete]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(failedTask())
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    await expect(
      reconcileVoiceLineLateUpload(makeJob(), preparedMarker),
    ).resolves.toBe('deleted')

    const referenceRead = prismaMock.novelPromotionVoiceLine.findFirst.mock.calls.at(-1)?.[0]
    expect(referenceRead).toEqual({
      where: {
        OR: [
          ...baseOutputReferenceFilters(),
        ],
      },
      select: { id: true },
    })
    expect(referenceRead?.where).not.toHaveProperty('id')
    expect(referenceRead?.where).not.toHaveProperty('episodeId')
    expect(cosMock.deleteCOSObject).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(OUTPUT_URL, { throwOnError: true })
  })

  it('[legacy /m alias still points at the exact storage object] -> [global proof fails closed and never deletes]', async () => {
    prismaMock.task.findFirst.mockResolvedValue(failedTask())
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce({
      id: 'media-a',
      publicId: 'media voice/a',
    })
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(unreferencedLine())
      .mockResolvedValueOnce(unreferencedLine())

    await expect(reconcileVoiceLineTerminalState(makeJob())).rejects.toThrow(
      'VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED',
    )

    expect(prismaMock.mediaObject.findUnique).toHaveBeenCalledWith({
      where: { storageKey: OUTPUT_URL },
      select: { id: true, publicId: true },
    })
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledTimes(2)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[exact MediaObject row exists without a VoiceLine relation] -> [global proof treats the object as referenced and never deletes]', async () => {
    prismaMock.task.findFirst.mockResolvedValue(failedTask())
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce({
      id: 'media-cross-entity',
      publicId: 'cross-entity-reference',
    })
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(unreferencedLine())
      .mockResolvedValueOnce(unreferencedLine())

    await expect(reconcileVoiceLineTerminalState(makeJob())).rejects.toThrow(
      'VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED',
    )

    expect(prismaMock.mediaObject.findUnique).toHaveBeenCalledWith({
      where: { storageKey: OUTPUT_URL },
      select: { id: true, publicId: true },
    })
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledTimes(2)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[MediaObject row is not created yet but deterministic /m alias exists] -> [global proof still blocks delete]', async () => {
    const canonicalAlias = `/m/${encodeURIComponent(stablePublicIdFromStorageKey(OUTPUT_URL))}`
    prismaMock.task.findFirst.mockResolvedValue(failedTask())
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(null)
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(unreferencedLine())
      .mockResolvedValueOnce(unreferencedLine())
      .mockImplementationOnce(async (args: unknown) => (
        JSON.stringify(args).includes(canonicalAlias)
          ? { id: 'line-deterministic-alias' }
          : null
      ))

    await expect(reconcileVoiceLineTerminalState(makeJob())).rejects.toThrow(
      'VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenLastCalledWith({
      where: {
        OR: [
          { audioUrl: OUTPUT_URL },
          { audioMedia: { is: { storageKey: OUTPUT_URL } } },
          { audioUrl: canonicalAlias },
          { audioUrl: { startsWith: `${canonicalAlias}?` } },
          { audioUrl: { startsWith: `${canonicalAlias}#` } },
        ],
      },
      select: { id: true },
    })
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[terminal deleted marker retry] -> [is idempotent and never deletes twice]', async () => {
    prismaMock.task.findFirst.mockResolvedValue(failedTask({
      ...preparedMarker,
      state: 'deleted',
    }))
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValue(unreferencedLine())
    await expect(reconcileVoiceLineTerminalState(makeJob())).resolves.toBe('deleted')
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it.each([
    ['queued', 'active'],
    ['processing', 'active'],
    ['completed', 'published'],
  ] as const)('[%s task terminal reconcile] -> [%s without delete]', async (status, expected) => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status,
      errorCode: null,
      payload: { voiceLinePublication: preparedMarker },
      result: status === 'completed' ? result : null,
      finishedAt: status === 'completed' ? new Date() : null,
    })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      audioUrl: status === 'completed' ? OUTPUT_URL : null,
      audioDuration: status === 'completed' ? 1_250 : null,
    })

    await expect(reconcileVoiceLineTerminalState(makeJob())).resolves.toBe(expected)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[terminal task still references marker output] -> [retains object and fails closed]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(failedTask())
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        audioUrl: OUTPUT_URL,
        audioDuration: 1_250,
      })
      .mockResolvedValueOnce({ id: 'line-a' })

    await expect(reconcileVoiceLineTerminalState(makeJob())).rejects.toThrow(
      'VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[terminal task lacks marker] -> [reports no_output without deriving a cleanup key]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(failedTask(null))
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(unreferencedLine())

    await expect(reconcileVoiceLineTerminalState(makeJob())).resolves.toBe('no_output')
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[unknown task status] -> [fails closed without deriving or deleting a key]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'mystery',
      errorCode: null,
      payload: {},
      result: null,
      finishedAt: null,
    })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(unreferencedLine())

    await expect(reconcileVoiceLineTerminalState(makeJob())).rejects.toThrow(
      'VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[malformed exact job tuple] -> [rejects before any read or delete]', async () => {
    await expect(readVoiceLinePreparedOutput(makeJob({ id: 'different-job-id' }))).rejects.toThrow(
      'VOICE_LINE_TASK_TARGET_INVALID',
    )
    await expect(reconcileVoiceLineTerminalState(makeJob({ targetId: 'line-b' }))).rejects.toThrow(
      'VOICE_LINE_TASK_TARGET_INVALID',
    )
    expect(prismaMock.task.findFirst).not.toHaveBeenCalled()
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[marker scope is malformed] -> [rejects and never grants deletion authority]', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'failed',
      errorCode: 'TASK_CANCELLED',
      payload: {
        voiceLinePublication: { ...preparedMarker, projectId: 'project-b' },
      },
      result: null,
      finishedAt: new Date(),
    })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(unreferencedLine())

    await expect(reconcileVoiceLineTerminalState(makeJob())).rejects.toThrow(
      'VOICE_LINE_PUBLICATION_MARKER_CONTEXT_INVALID',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })
})

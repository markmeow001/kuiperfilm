import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { preflightIdempotentTaskBatch, submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { estimateVoiceLineMaxSeconds } from '@/lib/voice/generate-voice-line'
import { hasVoiceLineAudioOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  resolveVoiceLineGenerationInput,
  voiceLineGenerationFingerprint,
  VoiceGenerationScopeError,
} from '@/lib/voice/voice-generation-scope'
import { buildAtlasCloudSeedAudioText } from '@/lib/voice/atlascloud-seed-audio-input'
import {
  assertSupportedAtlasCloudSeedAudioRequest,
  requireAtlasCloudSeedAudioSelection,
} from '@/lib/voice/atlascloud-seed-audio-route-config'
import {
  normalizeVoiceGenerationClientRequestId,
  voiceLineGenerationDedupeKey,
  voiceLineGenerationIdempotencyFingerprint,
  voiceLineGenerationTaskId,
  voiceGenerationRequestFingerprint,
} from '@/lib/voice/voice-generation-idempotency'

type VoiceGenerationReplayTask = {
  id: string
  userId: string
  projectId: string
  episodeId: string | null
  type: string
  targetType: string
  targetId: string
  payload: unknown
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function storedStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return value
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function throwVoiceGenerationIdempotencyConflict(): never {
  throw new ApiError('CONFLICT', {
    code: 'TASK_IDEMPOTENCY_CONFLICT',
    message: 'clientRequestId 已綁定另一個配音請求內容',
  })
}

function requireReplayTaskId(value: string | undefined): string {
  if (!value) throwVoiceGenerationIdempotencyConflict()
  return value
}

function normalizeBatchVoiceLineIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const lineIds: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return null
    const lineId = item.trim()
    if (!lineId || seen.has(lineId)) return null
    seen.add(lineId)
    lineIds.push(lineId)
  }
  return lineIds.sort((left, right) => left.localeCompare(right))
}

function validateReplayTask(params: {
  task: VoiceGenerationReplayTask
  userId: string
  projectId: string
  episodeId: string
  clientRequestId: string
  requestMode: 'single' | 'batch'
  requestedLineIds: readonly string[]
  requestedAudioModel: string
  requestFingerprint: string
  expectedTaskIdByLine: ReadonlyMap<string, string>
}): Record<string, unknown> {
  const payload = toObject(params.task.payload)
  const storedLineIds = storedStringArray(payload.requestLineIds)
  const expectedTaskId = params.expectedTaskIdByLine.get(params.task.targetId)
  if (
    params.task.userId !== params.userId
    || params.task.projectId !== params.projectId
    || params.task.episodeId !== params.episodeId
    || params.task.type !== TASK_TYPE.VOICE_LINE
    || params.task.targetType !== 'NovelPromotionVoiceLine'
    || !expectedTaskId
    || params.task.id !== expectedTaskId
    || payload.episodeId !== params.episodeId
    || payload.lineId !== params.task.targetId
    || payload.clientRequestId !== params.clientRequestId
    || payload.requestMode !== params.requestMode
    || !storedLineIds
    || !equalStrings(storedLineIds, params.requestedLineIds)
    || payload.requestedAudioModel !== params.requestedAudioModel
    || payload.requestFingerprint !== params.requestFingerprint
  ) {
    throwVoiceGenerationIdempotencyConflict()
  }
  return payload
}

function rethrowVoiceGenerationScopeError(error: unknown): never {
  if (error instanceof VoiceGenerationScopeError) {
    if (error.code === 'VOICE_LINE_SCOPE_MISMATCH') {
      throw new ApiError('NOT_FOUND')
    }
    throw new ApiError('INVALID_PARAMS', { reason: error.code })
  }
  throw error
}

async function resolveScopedVoiceLine(params: {
  projectId: string
  episodeId: string
  lineId: string
}) {
  try {
    return await resolveVoiceLineGenerationInput(params)
  } catch (error) {
    rethrowVoiceGenerationScopeError(error)
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => null)
  const locale = resolveRequiredTaskLocale(request, body)
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''
  const lineId = typeof body?.lineId === 'string' ? body.lineId.trim() : ''
  const audioModel = typeof body?.audioModel === 'string' ? body.audioModel.trim() : ''
  const all = body?.all === true
  const batchLineIds = all ? normalizeBatchVoiceLineIds(body?.lineIds) : null
  const clientRequestId = normalizeVoiceGenerationClientRequestId(body?.clientRequestId)

  if (!episodeId || (!all && !lineId)) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!clientRequestId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CLIENT_REQUEST_ID_INVALID',
      message: 'clientRequestId 必須是有效 UUID；重試同一次提交時請沿用相同值',
    })
  }
  if (all && !batchLineIds) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VOICE_LINE_IDS_INVALID',
      message: '批次配音必須提供非空且不重複的 lineIds；重試時請沿用完全相同的清單',
    })
  }

  const requestMode = all ? 'batch' as const : 'single' as const
  const requestedLineIds = all
    ? batchLineIds || throwVoiceGenerationIdempotencyConflict()
    : [lineId]
  const requestFingerprint = voiceGenerationRequestFingerprint({
    userId: session.user.id,
    projectId,
    episodeId,
    clientRequestId,
    mode: requestMode,
    lineIds: requestedLineIds,
    requestedAudioModel: audioModel,
  })
  const expectedTaskIdByLine = new Map(requestedLineIds.map((requestedLineId) => [
    requestedLineId,
    voiceLineGenerationTaskId({
      userId: session.user.id,
      clientRequestId,
      lineId: requestedLineId,
    }),
  ]))
  const expectedTaskIds = [...expectedTaskIdByLine.values()]
  const replayCandidates = await prisma.task.findMany({
    where: {
      OR: [
        { id: { in: expectedTaskIds } },
        {
          userId: session.user.id,
          projectId,
          type: TASK_TYPE.VOICE_LINE,
          payload: { path: '$.clientRequestId', equals: clientRequestId },
        },
      ],
    },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      type: true,
      targetType: true,
      targetId: true,
      payload: true,
    },
  })
  const replayTaskByLine = new Map<string, {
    task: VoiceGenerationReplayTask
    payload: Record<string, unknown>
  }>()
  for (const task of replayCandidates) {
    const payload = validateReplayTask({
      task,
      userId: session.user.id,
      projectId,
      episodeId,
      clientRequestId,
      requestMode,
      requestedLineIds,
      requestedAudioModel: audioModel,
      requestFingerprint,
      expectedTaskIdByLine,
    })
    if (replayTaskByLine.has(task.targetId)) throwVoiceGenerationIdempotencyConflict()
    replayTaskByLine.set(task.targetId, { task, payload })
  }

  // Exact replay is answered from the immutable Task identity before current
  // model/preset/line state is read. Completion may have changed audio fields,
  // or operators may have disabled a provider since the original acceptance.
  if (replayTaskByLine.size === requestedLineIds.length) {
    if (all) {
      const taskIds = requestedLineIds.map((requestedLineId) => (
        requireReplayTaskId(replayTaskByLine.get(requestedLineId)?.task.id)
      ))
      return NextResponse.json({
        success: true,
        async: true,
        taskIds,
        total: taskIds.length,
      })
    }
    return NextResponse.json({
      success: true,
      async: true,
      taskId: replayTaskByLine.get(lineId)?.task.id,
    })
  }

  assertSupportedAtlasCloudSeedAudioRequest(audioModel)

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: { id: true },
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const audioSelection = await requireAtlasCloudSeedAudioSelection(session.user.id, audioModel)
  const pinnedAudioModel = audioSelection.modelKey

  const missingLineIds = requestedLineIds.filter((requestedLineId) => (
    !replayTaskByLine.has(requestedLineId)
  ))
  const resolvedLines = all
    // The client pins exact batch membership alongside clientRequestId. Never
    // re-query "currently missing audio" here: a lost-response replay may run
    // after some/all lines completed and must still return the original Tasks.
    ? await Promise.all(missingLineIds.map(async (batchLineId) => (
        await resolveScopedVoiceLine({ projectId, episodeId, lineId: batchLineId })
      )))
    : [await resolveScopedVoiceLine({ projectId, episodeId, lineId })]

  if (resolvedLines.length === 0) {
    return NextResponse.json({
      success: true,
      async: true,
      taskIds: [],
      total: 0,
    })
  }

  // Finish every scoped input/output-state read before the first Task submit.
  // A replayed batch must never create a paid partial run because validation of
  // a later line failed after an earlier line had already been enqueued.
  const preparedLines = await Promise.all(
    resolvedLines.map(async ({ line, source }) => {
      const providerText = buildAtlasCloudSeedAudioText({
        dialogue: line.content,
        emotionPrompt: line.emotionPrompt,
        emotionStrength: line.emotionPrompt?.trim() ? line.emotionStrength ?? 0.4 : null,
      })
      const maxSeconds = estimateVoiceLineMaxSeconds(line.content)
      const sourceFingerprint = voiceLineGenerationFingerprint({
        line,
        source,
        audioModel: pinnedAudioModel,
      })
      const payload = {
        episodeId: line.episodeId,
        lineId: line.id,
        maxSeconds,
        audioModel: pinnedAudioModel,
        providerText,
        generationInput: { line, source },
        sourceFingerprint,
        clientRequestId,
        requestMode,
        requestLineIds: requestedLineIds,
        requestedAudioModel: audioModel,
        requestFingerprint,
        idempotencyFingerprint: voiceLineGenerationIdempotencyFingerprint({
          userId: session.user.id,
          projectId,
          episodeId: line.episodeId,
          lineId: line.id,
          clientRequestId,
          audioModel: pinnedAudioModel,
          providerText,
          maxSeconds,
          sourceFingerprint,
          requestFingerprint,
        }),
      }
      return {
        line,
        payload: withTaskUiPayload(payload, {
          hasOutputAtStart: await hasVoiceLineAudioOutput(line.id),
        }),
        billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, payload),
        idempotencyTaskId: voiceLineGenerationTaskId({
          userId: session.user.id,
          clientRequestId,
          lineId: line.id,
        }),
        dedupeKey: voiceLineGenerationDedupeKey({
          lineId: line.id,
        }),
      }
    }),
  )

  if (all) {
    const preparedByLine = new Map(preparedLines.map((prepared) => [prepared.line.id, prepared]))
    await preflightIdempotentTaskBatch({
      requests: requestedLineIds.map((requestedLineId) => {
        const replay = replayTaskByLine.get(requestedLineId)
        const prepared = preparedByLine.get(requestedLineId)
        if (replay) {
          return {
            idempotencyTaskId: replay.task.id,
            dedupeKey: voiceLineGenerationDedupeKey({ lineId: requestedLineId }),
            payload: replay.payload,
          }
        }
        if (!prepared) throwVoiceGenerationIdempotencyConflict()
        return {
          idempotencyTaskId: prepared.idempotencyTaskId,
          dedupeKey: prepared.dedupeKey,
          payload: prepared.payload,
        }
      }),
    })
  }

  const results = await Promise.all(
    preparedLines.map(async ({ line, payload, billingInfo, idempotencyTaskId, dedupeKey }) => {
      const result = await submitTask({
        idempotencyTaskId,
        userId: session.user.id,
        locale,
        requestId: getRequestId(request),
        projectId,
        episodeId: line.episodeId,
        type: TASK_TYPE.VOICE_LINE,
        targetType: 'NovelPromotionVoiceLine',
        targetId: line.id,
        payload,
        dedupeKey,
        dedupeMode: 'active',
        billingInfo,
      })

      return { lineId: line.id, taskId: result.taskId }
    }),
  )

  if (all) {
    const submittedTaskIdByLine = new Map(results.map((item) => [item.lineId, item.taskId]))
    const taskIds = requestedLineIds.map((requestedLineId) => (
      requireReplayTaskId(
        replayTaskByLine.get(requestedLineId)?.task.id
        ?? submittedTaskIdByLine.get(requestedLineId),
      )
    ))
    return NextResponse.json({
      success: true,
      async: true,
      taskIds,
      total: taskIds.length,
    })
  }

  return NextResponse.json({
    success: true,
    async: true,
    taskId: results[0].taskId,
  })
})

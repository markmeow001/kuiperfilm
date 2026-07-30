import { randomInt, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import {
  appendCandidateGenerationHistory,
  type CandidateGenerationSnapshot,
} from '@/lib/visual-development/candidate-history'
import { readResultKey } from '@/lib/visual-development/records'

type RouteContext = { params: Promise<{ projectId: string; candidateId: string }> }
type JsonRecord = Record<string, unknown>

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function requiredString(value: unknown, field: string, max = 30_000): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  if (normalized.length > max) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  }
  return normalized
}

async function requireAccess(projectId: string) {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const access = await requireProjectAccess(projectId, auth.session.user.id, 'write')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }
  return { userId: auth.session.user.id }
}

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId, candidateId } = await context.params
  const access = await requireAccess(projectId)
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const locale = resolveRequiredTaskLocale(request, body)
  const prompt = requiredString(body.prompt, 'prompt')
  const seedMode = body.seedMode === 'reuse' ? 'reuse' : 'new'

  const candidate = await prisma.visualDevelopmentCandidate.findUnique({
    where: { id: candidateId },
    include: { batch: { include: { character: { include: { workspace: true } } } } },
  })
  if (!candidate || candidate.batch.character.workspace.projectId !== projectId) {
    throw new ApiError('NOT_FOUND', { code: 'VISUAL_DEVELOPMENT_CANDIDATE_NOT_FOUND' })
  }
  const character = candidate.batch.character
  const consumesLockedAuthority = candidate.batch.status === 'canon_locked'
    || character.canonCandidateId === candidate.id
    || (candidate.batch.stage === 'hair-exploration' && candidate.isCanon && character.status !== 'hair_exploration_in_progress')
  if (consumesLockedAuthority) {
    throw new ApiError('CONFLICT', {
      code: 'VISUAL_DEVELOPMENT_CANON_LOCKED',
      message: '此資產已鎖定為 Canon。請先建立新的生成批次，避免覆蓋已被下游階段引用的版本。',
    })
  }
  if (!candidate.taskId) {
    throw new ApiError('CONFLICT', { code: 'VISUAL_DEVELOPMENT_CANDIDATE_INCOMPLETE' })
  }

  const previousTask = await prisma.task.findFirst({
    where: { id: candidate.taskId, projectId, userId: access.userId },
    select: {
      id: true,
      type: true,
      targetType: true,
      payload: true,
      result: true,
      status: true,
    },
  })
  const previousCompleted = previousTask?.status === 'completed' && Boolean(readResultKey(previousTask.result))
  const previousFailed = previousTask?.status === 'failed' || previousTask?.status === 'dismissed'
  if (!previousTask || (!previousCompleted && !previousFailed)) {
    throw new ApiError('CONFLICT', {
      code: 'VISUAL_DEVELOPMENT_CANDIDATE_NOT_READY',
      message: '這張資產仍在生成中，完成或失敗後才能建立新的重生版本。',
    })
  }
  if (
    previousTask.type !== TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE
    && previousTask.type !== TASK_TYPE.PLAYGROUND_VIDEO
  ) {
    throw new ApiError('CONFLICT', { code: 'VISUAL_DEVELOPMENT_TASK_TYPE_UNSUPPORTED' })
  }

  const claimed = await prisma.visualDevelopmentCandidate.updateMany({
    where: { id: candidate.id, taskId: previousTask.id, status: candidate.status },
    data: { status: 'regenerating' },
  })
  if (claimed.count !== 1) {
    throw new ApiError('CONFLICT', {
      code: 'VISUAL_DEVELOPMENT_REGENERATION_IN_PROGRESS',
      message: '這張資產已有重生工作正在送出，請稍後再試。',
    })
  }

  const seedSupported = candidate.seedStatus === 'applied'
  const requestedSeed = seedSupported
    ? seedMode === 'reuse' && candidate.requestedSeed !== null
      ? candidate.requestedSeed
      : randomInt(1, 2_147_483_647)
    : null
  const previousPayload = toRecord(previousTask.payload)
  const previousMeta = toRecord(previousPayload.meta)
  const payload: Record<string, unknown> = {
    ...previousPayload,
    prompt,
    ...(seedSupported && requestedSeed !== null ? { seed: requestedSeed } : {}),
    meta: {
      ...previousMeta,
      originPrompt: prompt,
      previousVisualDevelopmentTaskId: previousTask.id,
      visualDevelopmentBatchId: candidate.batchId,
      visualDevelopmentCandidateId: candidate.id,
      regenerationSeedMode: seedMode,
    },
  }
  if (!seedSupported) delete payload.seed

  const snapshot: CandidateGenerationSnapshot = {
    taskId: previousTask.id,
    prompt: candidate.prompt,
    negativePrompt: candidate.negativePrompt,
    requestedSeed: candidate.requestedSeed,
    effectiveSeed: candidate.effectiveSeed,
    seedStatus: candidate.seedStatus,
    modelKey: candidate.modelKey,
    provider: candidate.provider,
    modelId: candidate.modelId,
    modelVersion: candidate.modelVersion,
    aspectRatio: candidate.aspectRatio,
    resolution: candidate.resolution,
    shortlisted: candidate.shortlisted,
    isCanon: candidate.isCanon,
    rejectionNote: candidate.rejectionNote,
    createdAt: new Date().toISOString(),
  }

  try {
    const submitted = await submitTask({
      userId: access.userId,
      locale,
      projectId,
      type: previousTask.type,
      targetType: previousTask.targetType,
      targetId: candidate.id,
      dedupeKey: `visual-development-regenerate:${candidate.id}:${randomUUID()}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload,
    })

    await prisma.$transaction(async (transaction) => {
      const latestBatch = await transaction.visualDevelopmentBatch.findUnique({
        where: { id: candidate.batchId },
        select: { promptStack: true },
      })
      if (!latestBatch) throw new ApiError('NOT_FOUND', { code: 'VISUAL_DEVELOPMENT_BATCH_NOT_FOUND' })
      const promptStack = appendCandidateGenerationHistory(
        latestBatch.promptStack,
        candidate.id,
        snapshot,
      )
      await transaction.visualDevelopmentBatch.update({
        where: { id: candidate.batchId },
        data: { promptStack, status: 'queued' },
      })
      await transaction.visualDevelopmentCandidate.update({
        where: { id: candidate.id },
        data: {
          taskId: submitted.taskId,
          status: submitted.status,
          prompt,
          requestedSeed,
          effectiveSeed: requestedSeed,
          seedStatus: seedSupported ? 'applied' : 'unsupported',
          shortlisted: false,
          isCanon: false,
          rejectionNote: null,
        },
      })
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({
      success: true,
      data: {
        candidateId: candidate.id,
        taskId: submitted.taskId,
        seedMode,
        requestedSeed,
      },
    }, { status: 202 })
  } catch (error) {
    await prisma.visualDevelopmentCandidate.updateMany({
      where: { id: candidate.id, taskId: previousTask.id, status: 'regenerating' },
      data: { status: candidate.status },
    })
    throw error
  }
})

import { randomInt } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { resolveModelSelection } from '@/lib/api-config'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import {
  buildFaceLockPrompt,
  FACE_LOCK_VARIANTS,
  type StringRecord,
} from '@/lib/visual-development/prompt'
import { readResultKey } from '@/lib/visual-development/records'

type RouteContext = { params: Promise<{ projectId: string }> }
type JsonRecord = Record<string, unknown>

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function toStringRecord(value: unknown): StringRecord {
  return Object.fromEntries(
    Object.entries(toRecord(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, text]) => [key, text.trim()]),
  )
}

function requiredString(value: unknown, field: string, max = 4000): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  if (normalized.length > max) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  }
  return normalized
}

function normalizeCharacterCode(value: unknown): string {
  const code = requiredString(value, 'characterCode', 64).toUpperCase().replace(/[^A-Z0-9_-]/g, '-')
  if (!code) throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_CODE_INVALID' })
  return code
}

async function requireAccess(projectId: string, action: 'read' | 'write') {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const access = await requireProjectAccess(projectId, auth.session.user.id, action)
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }
  return { userId: auth.session.user.id }
}

function mergeStringJson(source: Prisma.JsonValue | null, additions: StringRecord): Prisma.InputJsonObject {
  return { ...toStringRecord(source), ...additions }
}

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const locale = resolveRequiredTaskLocale(request, body)
  const characterCode = normalizeCharacterCode(body.characterCode)
  const modelKey = requiredString(body.modelKey, 'modelKey', 255)
  const faceLockRecord = toStringRecord(body.faceLockRecord)
  requiredString(faceLockRecord.identityAnchors, 'faceLockRecord.identityAnchors')
  requiredString(faceLockRecord.forbiddenDrift, 'faceLockRecord.forbiddenDrift')

  const character = await prisma.visualDevelopmentCharacter.findFirst({
    where: { code: characterCode, workspace: { projectId } },
    include: { workspace: true },
  })
  if (!character) throw new ApiError('NOT_FOUND', { code: 'VISUAL_CHARACTER_NOT_FOUND' })
  if (!character.canonCandidateId) {
    throw new ApiError('CONFLICT', { code: 'CASTING_CANON_REQUIRED' })
  }

  const canonCandidate = await prisma.visualDevelopmentCandidate.findUnique({
    where: { id: character.canonCandidateId },
    include: { batch: true },
  })
  if (!canonCandidate || canonCandidate.batch.characterId !== character.id || canonCandidate.batch.stage !== 'casting') {
    throw new ApiError('CONFLICT', { code: 'CASTING_CANON_INVALID' })
  }
  if (!canonCandidate.taskId) throw new ApiError('CONFLICT', { code: 'CASTING_CANON_TASK_MISSING' })
  const canonTask = await prisma.task.findFirst({
    where: { id: canonCandidate.taskId, userId: access.userId, projectId, status: 'completed' },
    select: { id: true, result: true },
  })
  const referenceKey = canonTask ? readResultKey(canonTask.result) : null
  if (!canonTask || !referenceKey) throw new ApiError('CONFLICT', { code: 'CASTING_CANON_ASSET_MISSING' })

  let selection
  try {
    selection = await resolveModelSelection(access.userId, modelKey, 'image')
  } catch (error) {
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { message: error instanceof Error ? error.message : String(error) },
    })
  }
  const capabilities = findBuiltinCapabilities('image', selection.provider, selection.modelId)?.image
  if (capabilities?.supportReferenceImage !== true) {
    throw new ApiError('INVALID_PARAMS', { code: 'FACE_LOCK_REFERENCE_MODEL_REQUIRED', field: 'modelKey' })
  }
  const aspectRatio = requiredString(body.aspectRatio, 'aspectRatio', 16)
  if (!capabilities.aspectRatioOptions?.includes(aspectRatio)) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASPECT_RATIO_UNSUPPORTED', field: 'aspectRatio' })
  }
  const resolution = typeof body.resolution === 'string' && body.resolution.trim()
    ? body.resolution.trim()
    : null
  if (resolution && capabilities.resolutionOptions && !capabilities.resolutionOptions.includes(resolution)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESOLUTION_UNSUPPORTED', field: 'resolution' })
  }
  const seedSupported = capabilities.supportSeed === true
  const mergedCharacterDna = mergeStringJson(character.characterDna, faceLockRecord)
  await prisma.visualDevelopmentCharacter.update({
    where: { id: character.id },
    data: { characterDna: mergedCharacterDna, status: 'face_lock_in_progress' },
  })

  const promptResults = FACE_LOCK_VARIANTS.map((variant) => ({
    variant,
    result: buildFaceLockPrompt({
      characterCode,
      identityAnchors: faceLockRecord.identityAnchors,
      allowedVariation: faceLockRecord.allowedVariation,
      forbiddenDrift: faceLockRecord.forbiddenDrift,
      variant,
    }),
  }))
  const firstPrompt = promptResults[0]
  if (!firstPrompt) throw new ApiError('INTERNAL_ERROR', { code: 'FACE_LOCK_VARIANTS_EMPTY' })
  const batch = await prisma.visualDevelopmentBatch.create({
    data: {
      characterId: character.id,
      stage: 'face-lock',
      candidateCount: FACE_LOCK_VARIANTS.length,
      provider: selection.provider,
      modelKey: selection.modelKey,
      modelId: selection.modelId,
      seedSupported,
      prompt: firstPrompt.result.prompt,
      negativePrompt: firstPrompt.result.negativePrompt,
      promptStack: {
        ...firstPrompt.result.promptStack,
        sourceCandidateId: canonCandidate.id,
        sourceTaskId: canonTask.id,
        referenceImages: [referenceKey],
        referenceRole: 'identity-only',
      },
      worldBibleSnapshot: character.workspace.worldBible ?? undefined,
      characterDnaSnapshot: mergedCharacterDna,
      castingBriefSnapshot: character.castingBrief ?? undefined,
      aspectRatio,
      resolution,
      candidates: {
        create: promptResults.map(({ variant, result }) => {
          const requestedSeed = seedSupported ? randomInt(1, 2_147_483_647) : null
          return {
            code: variant.code,
            requestedSeed,
            effectiveSeed: requestedSeed,
            seedStatus: seedSupported ? 'applied' : 'unsupported',
            prompt: result.prompt,
            negativePrompt: result.negativePrompt,
            modelKey: selection.modelKey,
            provider: selection.provider,
            modelId: selection.modelId,
            aspectRatio,
            resolution,
          }
        }),
      },
    },
    include: { candidates: { orderBy: { code: 'asc' } } },
  })

  const promptsByCode = new Map<string, (typeof promptResults)[number]['result']>(
    promptResults.map((item) => [item.variant.code, item.result]),
  )
  const submissions = await Promise.allSettled(batch.candidates.map(async (candidate) => {
    const promptResult = promptsByCode.get(candidate.code)
    if (!promptResult) throw new Error(`FACE_LOCK_VARIANT_NOT_FOUND: ${candidate.code}`)
    const submitted = await submitTask({
      userId: access.userId,
      locale,
      projectId,
      type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
      targetType: 'visual-development-face-asset',
      targetId: candidate.id,
      dedupeKey: `visual-development-face:${candidate.id}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload: {
        prompt: candidate.prompt,
        modelKey: selection.modelKey,
        modelId: selection.modelId,
        referenceImages: [referenceKey],
        aspectRatio,
        ...(resolution ? { resolution } : {}),
        ...(capabilities.supportNegativePrompt === true ? { negativePrompt: candidate.negativePrompt } : {}),
        ...(seedSupported && candidate.requestedSeed !== null ? { seed: candidate.requestedSeed } : {}),
        generationCount: 1,
        meta: {
          originPrompt: candidate.prompt,
          originModelKey: selection.modelKey,
          visualDevelopmentBatchId: batch.id,
          visualDevelopmentCandidateId: candidate.id,
          faceLockVariant: candidate.code,
          identityReferenceCandidateId: canonCandidate.id,
          identityReferenceKey: referenceKey,
          referenceRole: 'identity-only',
          seedStatus: candidate.seedStatus,
        },
      },
    })
    await prisma.visualDevelopmentCandidate.update({
      where: { id: candidate.id },
      data: { taskId: submitted.taskId, status: submitted.status },
    })
    return submitted.taskId
  }))

  const failed = submissions.filter((result) => result.status === 'rejected').length
  if (failed > 0) {
    const failedCandidateIds = batch.candidates
      .filter((_, index) => submissions[index]?.status === 'rejected')
      .map((candidate) => candidate.id)
    await prisma.visualDevelopmentCandidate.updateMany({
      where: { id: { in: failedCandidateIds } },
      data: { status: 'submission_failed' },
    })
  }
  await prisma.visualDevelopmentBatch.update({
    where: { id: batch.id },
    data: { status: failed === 0 ? 'queued' : failed === batch.candidateCount ? 'failed' : 'partial_failed' },
  })

  return NextResponse.json({
    success: failed === 0,
    data: {
      batchId: batch.id,
      submitted: batch.candidateCount - failed,
      failed,
      seedSupported,
      referenceRole: 'identity-only',
    },
  }, { status: failed === 0 ? 202 : 207 })
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const action = requiredString(body.action, 'action', 32)

  if (action === 'asset-review') {
    const candidateId = requiredString(body.candidateId, 'candidateId', 191)
    const candidate = await prisma.visualDevelopmentCandidate.findUnique({
      where: { id: candidateId },
      include: { batch: { include: { character: { include: { workspace: true } } } } },
    })
    if (!candidate || candidate.batch.stage !== 'face-lock' || candidate.batch.character.workspace.projectId !== projectId) {
      throw new ApiError('NOT_FOUND')
    }
    if (!candidate.taskId) throw new ApiError('CONFLICT', { code: 'FACE_ASSET_NOT_GENERATED' })
    const task = await prisma.task.findFirst({
      where: { id: candidate.taskId, userId: access.userId, projectId, status: 'completed' },
      select: { id: true },
    })
    if (!task) throw new ApiError('CONFLICT', { code: 'FACE_ASSET_NOT_COMPLETED' })
    const approved = body.approved === true
    const rejectionNote = approved
      ? null
      : requiredString(body.rejectionNote, 'rejectionNote', 1000)
    const updated = await prisma.visualDevelopmentCandidate.update({
      where: { id: candidate.id },
      data: { shortlisted: approved, rejectionNote },
    })
    return NextResponse.json({ success: true, data: { candidate: { ...updated, approved } } })
  }

  if (action !== 'face-bible-lock') {
    throw new ApiError('INVALID_PARAMS', { code: 'FACE_BIBLE_ACTION_INVALID' })
  }
  const batchId = requiredString(body.batchId, 'batchId', 191)
  const batch = await prisma.visualDevelopmentBatch.findUnique({
    where: { id: batchId },
    include: { character: { include: { workspace: true } }, candidates: true },
  })
  if (!batch || batch.stage !== 'face-lock' || batch.character.workspace.projectId !== projectId) {
    throw new ApiError('NOT_FOUND')
  }
  if (batch.candidates.length !== FACE_LOCK_VARIANTS.length || batch.candidates.some((candidate) => !candidate.shortlisted)) {
    throw new ApiError('CONFLICT', { code: 'FACE_BIBLE_ALL_ASSETS_MUST_BE_APPROVED' })
  }
  const taskIds = batch.candidates.flatMap((candidate) => candidate.taskId ? [candidate.taskId] : [])
  const completedTaskCount = await prisma.task.count({
    where: { id: { in: taskIds }, userId: access.userId, projectId, status: 'completed' },
  })
  if (completedTaskCount !== FACE_LOCK_VARIANTS.length) {
    throw new ApiError('CONFLICT', { code: 'FACE_BIBLE_ASSETS_INCOMPLETE' })
  }
  const currentDna = toStringRecord(batch.character.characterDna)
  const currentVersion = Number.parseInt(currentDna.faceCanonVersion || '0', 10)
  const faceCanonVersion = Number.isFinite(currentVersion) ? currentVersion + 1 : 1
  await prisma.$transaction([
    prisma.visualDevelopmentCharacter.update({
      where: { id: batch.characterId },
      data: {
        status: 'face_locked',
        characterDna: {
          ...currentDna,
          faceBibleBatchId: batch.id,
          faceCanonId: `FACE-${batch.character.code}-v${String(faceCanonVersion).padStart(3, '0')}`,
          faceCanonVersion: String(faceCanonVersion),
          faceLockedAt: new Date().toISOString(),
        },
      },
    }),
    prisma.visualDevelopmentBatch.update({ where: { id: batch.id }, data: { status: 'canon_locked' } }),
  ])
  return NextResponse.json({
    success: true,
    data: { batchId: batch.id, faceCanonVersion },
  })
})

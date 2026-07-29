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
  buildHairExplorationPrompt,
  buildHairValidationPrompt,
  HAIR_EXPLORATION_VARIANTS,
  HAIR_VALIDATION_VARIANTS,
  type HairPromptInput,
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

async function requireAccess(projectId: string, action: 'write') {
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

function parseHairRecord(value: unknown, characterCode: string): HairPromptInput {
  const record = toStringRecord(value)
  return {
    characterCode,
    hairSilhouette: requiredString(record.hairSilhouette, 'hairRecord.hairSilhouette'),
    partingAndHairline: requiredString(record.partingAndHairline, 'hairRecord.partingAndHairline'),
    lengthAndTexture: requiredString(record.lengthAndTexture, 'hairRecord.lengthAndTexture'),
    storyRequirements: requiredString(record.storyRequirements, 'hairRecord.storyRequirements'),
    forbiddenDrift: requiredString(record.forbiddenDrift, 'hairRecord.forbiddenDrift'),
  }
}

async function resolveCompletedAsset(input: {
  taskId: string | null
  userId: string
  projectId: string
  missingCode: string
}): Promise<{ taskId: string; resultKey: string }> {
  if (!input.taskId) throw new ApiError('CONFLICT', { code: input.missingCode })
  const task = await prisma.task.findFirst({
    where: { id: input.taskId, userId: input.userId, projectId: input.projectId, status: 'completed' },
    select: { id: true, result: true },
  })
  const resultKey = task ? readResultKey(task.result) : null
  if (!task || !resultKey) throw new ApiError('CONFLICT', { code: input.missingCode })
  return { taskId: task.id, resultKey }
}

async function resolveFaceAuthority(characterId: string, userId: string, projectId: string) {
  const faceBatch = await prisma.visualDevelopmentBatch.findFirst({
    where: { characterId, stage: 'face-lock', status: 'canon_locked' },
    orderBy: { createdAt: 'desc' },
    include: { candidates: true },
  })
  if (!faceBatch) throw new ApiError('CONFLICT', { code: 'FACE_BIBLE_LOCK_REQUIRED' })
  const identityCandidate = faceBatch.candidates.find((candidate) => candidate.code === 'EXPR-RESTRAINED')
  if (!identityCandidate) throw new ApiError('CONFLICT', { code: 'FACE_IDENTITY_ASSET_MISSING' })
  const asset = await resolveCompletedAsset({
    taskId: identityCandidate.taskId,
    userId,
    projectId,
    missingCode: 'FACE_IDENTITY_ASSET_MISSING',
  })
  return { faceBatch, identityCandidate, ...asset }
}

async function resolveBoundModel(userId: string, modelKey: string) {
  let selection
  try {
    selection = await resolveModelSelection(userId, modelKey, 'image')
  } catch (error) {
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { message: error instanceof Error ? error.message : String(error) },
    })
  }
  const capabilities = findBuiltinCapabilities('image', selection.provider, selection.modelId)?.image
  if (capabilities?.supportReferenceImage !== true || capabilities.supportMultiReferenceImage !== true) {
    throw new ApiError('INVALID_PARAMS', { code: 'HAIR_MULTI_REFERENCE_MODEL_REQUIRED', field: 'modelKey' })
  }
  return { selection, capabilities }
}

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const action = requiredString(body.action, 'action', 32)
  if (action !== 'explore' && action !== 'validate') {
    throw new ApiError('INVALID_PARAMS', { code: 'HAIR_GENERATION_ACTION_INVALID' })
  }
  const locale = resolveRequiredTaskLocale(request, body)
  const characterCode = normalizeCharacterCode(body.characterCode)
  const modelKey = requiredString(body.modelKey, 'modelKey', 255)
  const hairRecord = parseHairRecord(body.hairRecord, characterCode)
  const hairRecordJson: StringRecord = {
    hairSilhouette: hairRecord.hairSilhouette,
    partingAndHairline: hairRecord.partingAndHairline,
    lengthAndTexture: hairRecord.lengthAndTexture,
    storyRequirements: hairRecord.storyRequirements,
    hairForbiddenDrift: hairRecord.forbiddenDrift,
  }

  const character = await prisma.visualDevelopmentCharacter.findFirst({
    where: { code: characterCode, workspace: { projectId } },
    include: { workspace: true },
  })
  if (!character) throw new ApiError('NOT_FOUND', { code: 'VISUAL_CHARACTER_NOT_FOUND' })
  const faceAuthority = await resolveFaceAuthority(character.id, access.userId, projectId)
  const { selection, capabilities } = await resolveBoundModel(access.userId, modelKey)
  const aspectRatio = requiredString(body.aspectRatio, 'aspectRatio', 16)
  if (capabilities.aspectRatioOptions && !capabilities.aspectRatioOptions.includes(aspectRatio)) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASPECT_RATIO_UNSUPPORTED', field: 'aspectRatio' })
  }
  const resolution = typeof body.resolution === 'string' && body.resolution.trim()
    ? body.resolution.trim()
    : null
  if (resolution && capabilities.resolutionOptions && !capabilities.resolutionOptions.includes(resolution)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESOLUTION_UNSUPPORTED', field: 'resolution' })
  }

  const seedSupported = capabilities.supportSeed === true
  const mergedCharacterDna = mergeStringJson(character.characterDna, hairRecordJson)
  let stage: 'hair-exploration' | 'hair-validation'
  let referenceImages: string[]
  let sourceHairCandidateId: string | null = null
  let promptResults: Array<{
    code: string
    prompt: string
    negativePrompt: string
    promptStack: StringRecord
  }>

  if (action === 'explore') {
    stage = 'hair-exploration'
    referenceImages = [faceAuthority.resultKey]
    promptResults = HAIR_EXPLORATION_VARIANTS.map((variant) => ({
      code: variant.code,
      ...buildHairExplorationPrompt({ ...hairRecord, variant }),
    }))
  } else {
    stage = 'hair-validation'
    const explorationCandidate = await prisma.visualDevelopmentCandidate.findFirst({
      where: {
        id: requiredString(body.explorationCandidateId, 'explorationCandidateId', 191),
        isCanon: true,
        batch: { characterId: character.id, stage: 'hair-exploration' },
      },
      include: { batch: true },
    })
    if (!explorationCandidate) {
      throw new ApiError('CONFLICT', { code: 'HAIR_EXPLORATION_SELECTION_REQUIRED' })
    }
    const hairAsset = await resolveCompletedAsset({
      taskId: explorationCandidate.taskId,
      userId: access.userId,
      projectId,
      missingCode: 'HAIR_EXPLORATION_ASSET_MISSING',
    })
    sourceHairCandidateId = explorationCandidate.id
    referenceImages = [faceAuthority.resultKey, hairAsset.resultKey]
    promptResults = HAIR_VALIDATION_VARIANTS.map((variant) => ({
      code: variant.code,
      ...buildHairValidationPrompt({ ...hairRecord, variant }),
    }))
  }

  const firstPrompt = promptResults[0]
  if (!firstPrompt) throw new ApiError('INTERNAL_ERROR', { code: 'HAIR_VARIANTS_EMPTY' })
  await prisma.visualDevelopmentCharacter.update({
    where: { id: character.id },
    data: {
      characterDna: mergedCharacterDna,
      status: action === 'explore' ? 'hair_exploration_in_progress' : 'hair_validation_in_progress',
    },
  })
  const batch = await prisma.visualDevelopmentBatch.create({
    data: {
      characterId: character.id,
      stage,
      candidateCount: promptResults.length,
      provider: selection.provider,
      modelKey: selection.modelKey,
      modelId: selection.modelId,
      seedSupported,
      prompt: firstPrompt.prompt,
      negativePrompt: firstPrompt.negativePrompt,
      promptStack: {
        ...firstPrompt.promptStack,
        identityFaceBatchId: faceAuthority.faceBatch.id,
        identityCandidateId: faceAuthority.identityCandidate.id,
        referenceImages,
        ...(sourceHairCandidateId ? { sourceHairCandidateId } : {}),
      },
      worldBibleSnapshot: character.workspace.worldBible ?? undefined,
      characterDnaSnapshot: mergedCharacterDna,
      castingBriefSnapshot: character.castingBrief ?? undefined,
      aspectRatio,
      resolution,
      candidates: {
        create: promptResults.map((result) => {
          const requestedSeed = seedSupported ? randomInt(1, 2_147_483_647) : null
          return {
            code: result.code,
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

  const submissions = await Promise.allSettled(batch.candidates.map(async (candidate) => {
    const submitted = await submitTask({
      userId: access.userId,
      locale,
      projectId,
      type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
      targetType: stage === 'hair-exploration'
        ? 'visual-development-hair-exploration'
        : 'visual-development-hair-validation',
      targetId: candidate.id,
      dedupeKey: `visual-development-hair:${candidate.id}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload: {
        prompt: candidate.prompt,
        modelKey: selection.modelKey,
        modelId: selection.modelId,
        referenceImages,
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
          hairStage: stage,
          identityReferenceKey: faceAuthority.resultKey,
          ...(sourceHairCandidateId ? { sourceHairCandidateId, hairReferenceKey: referenceImages[1] } : {}),
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
      stage,
      submitted: batch.candidateCount - failed,
      failed,
      seedSupported,
      referenceImageCount: referenceImages.length,
    },
  }, { status: failed === 0 ? 202 : 207 })
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const action = requiredString(body.action, 'action', 40)

  if (action === 'exploration-select') {
    const candidateId = requiredString(body.candidateId, 'candidateId', 191)
    const candidate = await prisma.visualDevelopmentCandidate.findUnique({
      where: { id: candidateId },
      include: { batch: { include: { character: { include: { workspace: true } } } } },
    })
    if (!candidate || candidate.batch.stage !== 'hair-exploration' || candidate.batch.character.workspace.projectId !== projectId) {
      throw new ApiError('NOT_FOUND')
    }
    await resolveCompletedAsset({
      taskId: candidate.taskId,
      userId: access.userId,
      projectId,
      missingCode: 'HAIR_EXPLORATION_ASSET_MISSING',
    })
    await prisma.$transaction([
      prisma.visualDevelopmentCandidate.updateMany({
        where: { batch: { characterId: candidate.batch.characterId, stage: 'hair-exploration' } },
        data: { isCanon: false },
      }),
      prisma.visualDevelopmentCandidate.update({
        where: { id: candidate.id },
        data: { isCanon: true, shortlisted: true },
      }),
      prisma.visualDevelopmentCharacter.update({
        where: { id: candidate.batch.characterId },
        data: { status: 'hair_direction_selected' },
      }),
    ])
    return NextResponse.json({ success: true, data: { candidateId: candidate.id } })
  }

  if (action === 'asset-review') {
    const candidateId = requiredString(body.candidateId, 'candidateId', 191)
    const candidate = await prisma.visualDevelopmentCandidate.findUnique({
      where: { id: candidateId },
      include: { batch: { include: { character: { include: { workspace: true } } } } },
    })
    if (!candidate || candidate.batch.stage !== 'hair-validation' || candidate.batch.character.workspace.projectId !== projectId) {
      throw new ApiError('NOT_FOUND')
    }
    await resolveCompletedAsset({
      taskId: candidate.taskId,
      userId: access.userId,
      projectId,
      missingCode: 'HAIR_VALIDATION_ASSET_INCOMPLETE',
    })
    const approved = body.approved === true
    const rejectionNote = approved ? null : requiredString(body.rejectionNote, 'rejectionNote', 1000)
    const updated = await prisma.visualDevelopmentCandidate.update({
      where: { id: candidate.id },
      data: { shortlisted: approved, rejectionNote },
    })
    return NextResponse.json({ success: true, data: { candidate: { ...updated, approved } } })
  }

  if (action !== 'hair-lock') {
    throw new ApiError('INVALID_PARAMS', { code: 'HAIR_ACTION_INVALID' })
  }
  const batchId = requiredString(body.batchId, 'batchId', 191)
  const batch = await prisma.visualDevelopmentBatch.findUnique({
    where: { id: batchId },
    include: { character: { include: { workspace: true } }, candidates: true },
  })
  if (!batch || batch.stage !== 'hair-validation' || batch.character.workspace.projectId !== projectId) {
    throw new ApiError('NOT_FOUND')
  }
  if (batch.candidates.length !== HAIR_VALIDATION_VARIANTS.length || batch.candidates.some((candidate) => !candidate.shortlisted)) {
    throw new ApiError('CONFLICT', { code: 'HAIR_ALL_VALIDATION_ASSETS_MUST_BE_APPROVED' })
  }
  const taskIds = batch.candidates.flatMap((candidate) => candidate.taskId ? [candidate.taskId] : [])
  const completedTaskCount = await prisma.task.count({
    where: { id: { in: taskIds }, userId: access.userId, projectId, status: 'completed' },
  })
  if (completedTaskCount !== HAIR_VALIDATION_VARIANTS.length) {
    throw new ApiError('CONFLICT', { code: 'HAIR_VALIDATION_ASSETS_INCOMPLETE' })
  }
  const currentDna = toStringRecord(batch.character.characterDna)
  const currentVersion = Number.parseInt(currentDna.hairCanonVersion || '0', 10)
  const hairCanonVersion = Number.isFinite(currentVersion) ? currentVersion + 1 : 1
  const promptStack = toRecord(batch.promptStack)
  const sourceHairCandidateId = requiredString(promptStack.sourceHairCandidateId, 'promptStack.sourceHairCandidateId', 191)
  await prisma.$transaction([
    prisma.visualDevelopmentCharacter.update({
      where: { id: batch.characterId },
      data: {
        status: 'hair_locked',
        characterDna: {
          ...currentDna,
          hairBibleBatchId: batch.id,
          hairDirectionCandidateId: sourceHairCandidateId,
          hairCanonId: `HAIR-${batch.character.code}-v${String(hairCanonVersion).padStart(3, '0')}`,
          hairCanonVersion: String(hairCanonVersion),
          hairLockedAt: new Date().toISOString(),
        },
      },
    }),
    prisma.visualDevelopmentBatch.update({ where: { id: batch.id }, data: { status: 'canon_locked' } }),
  ])
  return NextResponse.json({ success: true, data: { batchId: batch.id, hairCanonVersion } })
})

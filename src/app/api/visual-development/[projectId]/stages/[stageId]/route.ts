import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { resolveModelSelection } from '@/lib/api-config'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildProductionStagePrompt } from '@/lib/visual-development/production-prompt'
import { getVisualDevelopmentAspectRatios } from '@/lib/visual-development/model-options'
import {
  canEnterProductionStage,
  getProductionStage,
  type ProductionReferenceSource,
  type ProductionStageDefinition,
} from '@/lib/visual-development/production-stages'
import { readResultKey } from '@/lib/visual-development/records'
import {
  readProductionStageBriefState,
  submitProductionStageBrief,
} from '@/lib/visual-development/stage-brief-service'
import {
  parseStoredProductionStageBrief,
  productionStageBriefDnaKey,
  productionStageCreativePromptDnaKey,
} from '@/lib/visual-development/stage-brief'

type RouteContext = { params: Promise<{ projectId: string; stageId: string }> }
type JsonRecord = Record<string, unknown>
type StringRecord = Record<string, string>

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function toStringRecord(value: unknown): StringRecord {
  return Object.fromEntries(Object.entries(toRecord(value))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, text]) => [key, text.trim()]))
}

function requiredString(value: unknown, field: string, max = 4000): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  if (normalized.length > max) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  return normalized
}

function optionalString(value: unknown, field: string, max = 4000): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > max) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  return normalized
}

function normalizeCharacterCode(value: unknown): string {
  const code = requiredString(value, 'characterCode', 64).toUpperCase().replace(/[^A-Z0-9_-]/g, '-')
  if (!code) throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_CODE_INVALID' })
  return code
}

function resolveStage(stageId: string): ProductionStageDefinition {
  try {
    return getProductionStage(stageId)
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'PRODUCTION_STAGE_INVALID', field: 'stageId' })
  }
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

async function resolveCompletedCandidate(input: {
  candidateId?: string
  batchId?: string
  characterId: string
  stage: string
  userId: string
  projectId: string
  code?: string
}) {
  const candidate = await prisma.visualDevelopmentCandidate.findFirst({
    where: {
      ...(input.candidateId ? { id: input.candidateId } : {}),
      ...(input.code ? { code: input.code } : { isCanon: true }),
      batch: {
        ...(input.batchId ? { id: input.batchId } : {}),
        characterId: input.characterId,
        stage: input.stage,
        ...(input.stage === 'face-lock' || input.stage.startsWith('phase-') ? { status: 'canon_locked' } : {}),
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!candidate?.taskId) throw new ApiError('CONFLICT', { code: 'UPSTREAM_CANON_ASSET_MISSING' })
  const task = await prisma.task.findFirst({
    where: { id: candidate.taskId, userId: input.userId, projectId: input.projectId, status: 'completed' },
    select: { result: true },
  })
  const resultKey = task ? readResultKey(task.result) : null
  if (!resultKey) throw new ApiError('CONFLICT', { code: 'UPSTREAM_CANON_ASSET_INCOMPLETE' })
  return { candidate, resultKey }
}

async function resolveReferenceImages(input: {
  stage: ProductionStageDefinition
  characterId: string
  characterDna: StringRecord
  userId: string
  projectId: string
}) {
  return await Promise.all(input.stage.referenceSources.map(async (reference) => {
    const location = resolveReferenceLocation(reference)
    if (reference.source === 'hair') {
      const hairCandidateId = requiredString(input.characterDna.hairDirectionCandidateId, 'characterDna.hairDirectionCandidateId', 191)
      const hairBibleBatchId = requiredString(input.characterDna.hairBibleBatchId, 'characterDna.hairBibleBatchId', 191)
      const hairBible = await prisma.visualDevelopmentBatch.findFirst({
        where: { id: hairBibleBatchId, characterId: input.characterId, stage: 'hair-validation', status: 'canon_locked' },
        select: { promptStack: true },
      })
      if (toRecord(hairBible?.promptStack).sourceHairCandidateId !== hairCandidateId) {
        throw new ApiError('CONFLICT', { code: 'HAIR_CANON_LINEAGE_INVALID' })
      }
      const resolved = await resolveCompletedCandidate({
        candidateId: hairCandidateId,
        characterId: input.characterId,
        stage: location.stage,
        userId: input.userId,
        projectId: input.projectId,
      })
      return { candidateId: resolved.candidate.id, resultKey: resolved.resultKey }
    }
    if (reference.source === 'face') {
      const faceBibleBatchId = requiredString(input.characterDna.faceBibleBatchId, 'characterDna.faceBibleBatchId', 191)
      const resolved = await resolveCompletedCandidate({
        batchId: faceBibleBatchId,
        characterId: input.characterId,
        stage: location.stage,
        code: reference.candidateCode,
        userId: input.userId,
        projectId: input.projectId,
      })
      return { candidateId: resolved.candidate.id, resultKey: resolved.resultKey }
    }
    const sourceStage = getProductionStage(reference.source)
    const batchId = requiredString(input.characterDna[`${sourceStage.id}BatchId`], `characterDna.${sourceStage.id}BatchId`, 191)
    const candidateId = reference.candidateCode
      ? undefined
      : requiredString(input.characterDna[`${sourceStage.id}PrimaryCandidateId`], `characterDna.${sourceStage.id}PrimaryCandidateId`, 191)
    const resolved = await resolveCompletedCandidate({
      batchId,
      candidateId,
      characterId: input.characterId,
      stage: location.stage,
      code: reference.candidateCode,
      userId: input.userId,
      projectId: input.projectId,
    })
    return { candidateId: resolved.candidate.id, resultKey: resolved.resultKey }
  }))
}

function resolveReferenceLocation(reference: ProductionReferenceSource): { stage: string } {
  if (reference.source === 'face') return { stage: 'face-lock' }
  if (reference.source === 'hair') return { stage: 'hair-exploration' }
  return { stage: getProductionStage(reference.source).dbStage }
}

async function resolveBoundModel(userId: string, modelKey: string, stage: ProductionStageDefinition) {
  let selection
  try {
    selection = await resolveModelSelection(userId, modelKey, stage.mediaType)
  } catch (error) {
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { message: error instanceof Error ? error.message : String(error) },
    })
  }
  const capabilities = findBuiltinCapabilities(stage.mediaType, selection.provider, selection.modelId)
  if (stage.mediaType === 'image') {
    if (capabilities?.image?.supportReferenceImage !== true || capabilities.image.supportMultiReferenceImage !== true) {
      throw new ApiError('INVALID_PARAMS', { code: 'STAGE_MULTI_REFERENCE_MODEL_REQUIRED', field: 'modelKey' })
    }
  } else if (capabilities?.video?.supportReferenceImage !== true) {
    throw new ApiError('INVALID_PARAMS', { code: 'STAGE_IMAGE_TO_VIDEO_MODEL_REQUIRED', field: 'modelKey' })
  }
  return { selection, capabilities }
}

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId, stageId } = await context.params
  const stage = resolveStage(stageId)
  const access = await requireAccess(projectId, 'read')
  if (access instanceof Response) return access
  const characterCode = normalizeCharacterCode(request.nextUrl.searchParams.get('characterCode'))
  const state = await readProductionStageBriefState({
    projectId,
    userId: access.userId,
    characterCode,
    stage,
  })
  return NextResponse.json({ success: true, data: state })
})

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId, stageId } = await context.params
  const stage = resolveStage(stageId)
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const locale = resolveRequiredTaskLocale(request, body)
  const characterCode = normalizeCharacterCode(body.characterCode)
  if (body.action === 'create-stage-brief') {
    const submitted = await submitProductionStageBrief({
      projectId,
      userId: access.userId,
      locale,
      characterCode,
      stage,
    })
    return NextResponse.json({ success: true, data: submitted }, { status: 202 })
  }
  const modelKey = requiredString(body.modelKey, 'modelKey', 255)
  const creativePrompt = optionalString(body.creativePrompt, 'creativePrompt')

  const character = await prisma.visualDevelopmentCharacter.findFirst({
    where: { code: characterCode, workspace: { projectId } },
    include: { workspace: true },
  })
  if (!character) throw new ApiError('NOT_FOUND', { code: 'VISUAL_CHARACTER_NOT_FOUND' })
  if (!canEnterProductionStage(character.status, stage.id)) {
    throw new ApiError('CONFLICT', { code: 'UPSTREAM_CANON_LOCK_REQUIRED', details: { required: stage.prerequisiteStatus } })
  }
  const characterDna = toStringRecord(character.characterDna)
  const stageBrief = parseStoredProductionStageBrief(
    characterDna[productionStageBriefDnaKey(stage.id)],
    stage,
  )
  if (!stageBrief) throw new ApiError('CONFLICT', { code: 'STAGE_BRIEF_REQUIRED' })
  const stageRecord = Object.fromEntries(stage.fields.map((field) => [field, stageBrief.fields[field] ?? '']))
  for (const field of stage.fields) requiredString(stageRecord[field], `stageBrief.fields.${field}`)

  const referenceAssets = await resolveReferenceImages({
    stage,
    characterId: character.id,
    characterDna,
    userId: access.userId,
    projectId,
  })
  const referenceImages = referenceAssets.map((reference) => reference.resultKey)
  const { selection, capabilities } = await resolveBoundModel(access.userId, modelKey, stage)
  const imageCaps = capabilities?.image
  const videoCaps = capabilities?.video
  if (stage.mediaType === 'image') {
    const referenceLimit = imageCaps?.maxReferenceImages ?? (imageCaps?.supportMultiReferenceImage === true ? 2 : 1)
    if (referenceImages.length > referenceLimit) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MODEL_REFERENCE_IMAGE_LIMIT_EXCEEDED',
        details: { got: referenceImages.length, max: referenceLimit, modelKey },
      })
    }
  }
  const aspectRatio = typeof body.aspectRatio === 'string' && body.aspectRatio.trim()
    ? body.aspectRatio.trim()
    : stage.mediaType === 'video' ? '16:9' : '3:4'
  const ratioOptions = getVisualDevelopmentAspectRatios(capabilities, stage.mediaType)
  if (!ratioOptions.includes(aspectRatio)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASPECT_RATIO_UNSUPPORTED',
      field: 'aspectRatio',
      message: `目前模型不支援 ${aspectRatio}，請從模型比例選單重新選擇。`,
    })
  }
  const resolution = typeof body.resolution === 'string' && body.resolution.trim() ? body.resolution.trim() : null
  const resolutionOptions = stage.mediaType === 'image' ? imageCaps?.resolutionOptions : videoCaps?.resolutionOptions
  if (resolution && resolutionOptions && !resolutionOptions.includes(resolution)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESOLUTION_UNSUPPORTED', field: 'resolution' })
  }
  const requestedDuration = Number(body.duration)
  const durationOptions = videoCaps?.durationOptions ?? []
  const duration = stage.mediaType === 'video'
    ? (Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : durationOptions[0] ?? 5)
    : null
  if (duration !== null && durationOptions.length > 0 && !durationOptions.includes(duration)) {
    throw new ApiError('INVALID_PARAMS', { code: 'DURATION_UNSUPPORTED', field: 'duration' })
  }

  const worldBible = toStringRecord(character.workspace.worldBible)
  const promptResults = stage.variants.map((variant) => ({
    code: variant.code,
    ...buildProductionStagePrompt({
      stage,
      variant,
      characterCode,
      worldBible,
      characterDna,
      stageRecord,
      stageBrief,
      creativePrompt,
      inlineNegativeConstraints: stage.mediaType === 'image' && imageCaps?.supportNegativePrompt !== true,
    }),
  }))
  const seedSupported = stage.mediaType === 'image' && imageCaps?.supportSeed === true
  const firstPrompt = promptResults[0]
  if (!firstPrompt) throw new ApiError('INTERNAL_ERROR', { code: 'STAGE_VARIANTS_EMPTY' })

  const batch = await prisma.visualDevelopmentBatch.create({
    data: {
      characterId: character.id,
      stage: stage.dbStage,
      candidateCount: promptResults.length,
      provider: selection.provider,
      modelKey: selection.modelKey,
      modelId: selection.modelId,
      seedSupported,
      prompt: firstPrompt.prompt,
      negativePrompt: firstPrompt.negativePrompt,
      promptStack: {
        ...firstPrompt.promptStack,
        stageId: stage.id,
        stageRecord,
        stageBrief: {
          version: stageBrief.version,
          stageId: stageBrief.stageId,
          characterCode: stageBrief.characterCode,
          sourceAnalysisId: stageBrief.sourceAnalysisId,
          modelKey: stageBrief.modelKey,
          summary: stageBrief.summary,
          fields: { ...stageBrief.fields },
          evidence: [...stageBrief.evidence],
          constraints: [...stageBrief.constraints],
          createdAt: stageBrief.createdAt,
        },
        creativePrompt,
        referenceImages,
        referenceCandidateIds: referenceAssets.map((reference) => reference.candidateId),
        referenceResponsibilities: stage.referenceSources.map((reference, index) => ({
          image: index + 1,
          source: reference.source,
          candidateCode: reference.candidateCode ?? null,
          authority: reference.authority,
        })),
      },
      worldBibleSnapshot: character.workspace.worldBible ?? undefined,
      characterDnaSnapshot: character.characterDna ?? undefined,
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
    const type = stage.mediaType === 'video' ? TASK_TYPE.PLAYGROUND_VIDEO : TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE
    const payload: Record<string, unknown> = {
      prompt: candidate.prompt,
      modelKey: selection.modelKey,
      modelId: selection.modelId,
      outputType: stage.mediaType,
      referenceImages,
      aspectRatio,
      ...(resolution ? { resolution } : {}),
      ...(duration !== null ? { duration } : {}),
      ...(stage.mediaType === 'video' && videoCaps?.supportGenerateAudio === true ? { generateAudio: false } : {}),
      ...(stage.mediaType === 'image' && imageCaps?.supportNegativePrompt === true ? { negativePrompt: candidate.negativePrompt } : {}),
      ...(seedSupported && candidate.requestedSeed !== null ? { seed: candidate.requestedSeed } : {}),
      generationCount: 1,
      meta: {
        originPrompt: candidate.prompt,
        originModelKey: selection.modelKey,
        visualDevelopmentBatchId: batch.id,
        visualDevelopmentCandidateId: candidate.id,
        productionStageId: stage.id,
        referenceImages,
      },
    }
    const submitted = await submitTask({
      userId: access.userId,
      locale,
      projectId,
      type,
      targetType: `visual-development-${stage.id}`,
      targetId: candidate.id,
      dedupeKey: `visual-development-${stage.id}:${candidate.id}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload,
    })
    await prisma.visualDevelopmentCandidate.update({
      where: { id: candidate.id },
      data: { taskId: submitted.taskId, status: submitted.status },
    })
  }))
  const latestCharacter = await prisma.visualDevelopmentCharacter.findUnique({
    where: { id: character.id },
    select: { characterDna: true },
  })
  const latestCharacterDna = toStringRecord(latestCharacter?.characterDna)
  await prisma.visualDevelopmentCharacter.update({
    where: { id: character.id },
    data: {
      characterDna: {
        ...latestCharacterDna,
        [productionStageCreativePromptDnaKey(stage.id)]: creativePrompt,
      } satisfies Prisma.InputJsonObject,
    },
  })
  const failedIds = batch.candidates
    .filter((_, index) => submissions[index]?.status === 'rejected')
    .map((candidate) => candidate.id)
  if (failedIds.length > 0) {
    await prisma.visualDevelopmentCandidate.updateMany({ where: { id: { in: failedIds } }, data: { status: 'submission_failed' } })
  }
  await prisma.visualDevelopmentBatch.update({
    where: { id: batch.id },
    data: { status: failedIds.length === 0 ? 'queued' : failedIds.length === batch.candidateCount ? 'failed' : 'partial_failed' },
  })
  return NextResponse.json({
    success: failedIds.length === 0,
    data: { batchId: batch.id, stage: stage.id, submitted: batch.candidateCount - failedIds.length, failed: failedIds.length },
  }, { status: failedIds.length === 0 ? 202 : 207 })
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId, stageId } = await context.params
  const stage = resolveStage(stageId)
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const action = requiredString(body.action, 'action', 40)

  if (action === 'asset-review' || action === 'select-primary') {
    const candidateId = requiredString(body.candidateId, 'candidateId', 191)
    const approved = body.approved === true
    const rejectionNote = action === 'asset-review' && !approved
      ? requiredString(body.rejectionNote, 'rejectionNote', 1000)
      : null
    await prisma.$transaction(async (transaction) => {
      const candidate = await transaction.visualDevelopmentCandidate.findUnique({
        where: { id: candidateId },
        include: { batch: { include: { character: { include: { workspace: true } } } } },
      })
      if (!candidate || candidate.batch.stage !== stage.dbStage || candidate.batch.character.workspace.projectId !== projectId) {
        throw new ApiError('NOT_FOUND')
      }
      if (candidate.batch.status === 'canon_locked' || candidate.batch.status === 'superseded') {
        throw new ApiError('CONFLICT', { code: 'STAGE_BATCH_IMMUTABLE' })
      }
      const touched = await transaction.visualDevelopmentBatch.updateMany({
        where: { id: candidate.batchId, status: candidate.batch.status },
        data: { updatedAt: new Date() },
      })
      if (touched.count !== 1) throw new ApiError('CONFLICT', { code: 'STAGE_BATCH_IMMUTABLE' })
      if (!candidate.taskId) throw new ApiError('CONFLICT', { code: 'STAGE_ASSET_INCOMPLETE' })
      const task = await transaction.task.findFirst({
        where: { id: candidate.taskId, userId: access.userId, projectId, status: 'completed' },
        select: { result: true },
      })
      if (!task || !readResultKey(task.result)) throw new ApiError('CONFLICT', { code: 'STAGE_ASSET_INCOMPLETE' })
      if (action === 'select-primary') {
        await transaction.visualDevelopmentCandidate.updateMany({ where: { batchId: candidate.batchId }, data: { isCanon: false } })
        await transaction.visualDevelopmentCandidate.update({ where: { id: candidate.id }, data: { isCanon: true, shortlisted: true } })
      } else {
        await transaction.visualDevelopmentCandidate.update({
          where: { id: candidate.id },
          data: { shortlisted: approved, rejectionNote, ...(approved ? {} : { isCanon: false }) },
        })
      }
    })
    return NextResponse.json({ success: true, data: { candidateId } })
  }

  if (action !== 'canon-lock') throw new ApiError('INVALID_PARAMS', { code: 'STAGE_ACTION_INVALID' })
  const batchId = requiredString(body.batchId, 'batchId', 191)
  const version = await prisma.$transaction(async (transaction) => {
    const initialBatch = await transaction.visualDevelopmentBatch.findUnique({
      where: { id: batchId },
      include: { character: { include: { workspace: true } } },
    })
    if (!initialBatch || initialBatch.stage !== stage.dbStage || initialBatch.character.workspace.projectId !== projectId) {
      throw new ApiError('NOT_FOUND')
    }
    if (initialBatch.status === 'canon_locked' || initialBatch.status === 'superseded') {
      throw new ApiError('CONFLICT', { code: 'STAGE_BATCH_IMMUTABLE' })
    }
    const claimed = await transaction.visualDevelopmentBatch.updateMany({
      where: { id: initialBatch.id, status: initialBatch.status },
      data: { status: 'canon_locked' },
    })
    if (claimed.count !== 1) throw new ApiError('CONFLICT', { code: 'STAGE_BATCH_IMMUTABLE' })
    const batch = await transaction.visualDevelopmentBatch.findUnique({
      where: { id: batchId },
      include: { character: { include: { workspace: true } }, candidates: true },
    })
    if (!batch) throw new ApiError('NOT_FOUND')
    if (batch.candidates.length !== stage.variants.length || batch.candidates.some((candidate) => !candidate.shortlisted)) {
      throw new ApiError('CONFLICT', { code: 'STAGE_ALL_ASSETS_MUST_BE_APPROVED' })
    }
    const primary = batch.candidates.find((candidate) => candidate.isCanon)
    if (!primary) throw new ApiError('CONFLICT', { code: 'STAGE_PRIMARY_ASSET_REQUIRED' })
    const taskIds = batch.candidates.flatMap((candidate) => candidate.taskId ? [candidate.taskId] : [])
    const completed = await transaction.task.count({
      where: { id: { in: taskIds }, userId: access.userId, projectId, status: 'completed' },
    })
    if (completed !== stage.variants.length) throw new ApiError('CONFLICT', { code: 'STAGE_ASSETS_INCOMPLETE' })

    const promptStack = toRecord(batch.promptStack)
    const storedReferenceCandidateIds = Array.isArray(promptStack.referenceCandidateIds)
      ? promptStack.referenceCandidateIds.filter((value): value is string => typeof value === 'string')
      : []
    const currentCharacter = await transaction.visualDevelopmentCharacter.findUnique({
      where: { id: batch.characterId },
      select: { status: true, characterDna: true, updatedAt: true },
    })
    if (!currentCharacter || !canEnterProductionStage(currentCharacter.status, stage.id)) {
      throw new ApiError('CONFLICT', { code: 'UPSTREAM_CANON_LOCK_REQUIRED', details: { required: stage.prerequisiteStatus } })
    }
    const currentDna = toStringRecord(currentCharacter.characterDna)
    const currentReferenceAssets = await resolveReferenceImages({
      stage,
      characterId: batch.characterId,
      characterDna: currentDna,
      userId: access.userId,
      projectId,
    })
    const currentReferenceCandidateIds = currentReferenceAssets.map((reference) => reference.candidateId)
    if (
      storedReferenceCandidateIds.length !== currentReferenceCandidateIds.length
      || storedReferenceCandidateIds.some((candidateId, index) => candidateId !== currentReferenceCandidateIds[index])
    ) {
      throw new ApiError('CONFLICT', { code: 'UPSTREAM_CANON_LINEAGE_CHANGED' })
    }
    const versionKey = `${stage.id}CanonVersion`
    const currentVersion = Number.parseInt(currentDna[versionKey] || '0', 10)
    const nextVersion = Number.isFinite(currentVersion) ? currentVersion + 1 : 1
    const stageRecord = toStringRecord(promptStack.stageRecord)
    const prefixedRecord = Object.fromEntries(Object.entries(stageRecord).map(([key, value]) => [`${stage.id}_${key}`, value]))
    const nextDna: Prisma.InputJsonObject = {
      ...currentDna,
      ...prefixedRecord,
      [`${stage.id}CanonId`]: `${stage.id.toUpperCase()}-${batch.character.code}-v${String(nextVersion).padStart(3, '0')}`,
      [`${stage.id}CanonVersion`]: String(nextVersion),
      [`${stage.id}BatchId`]: batch.id,
      [`${stage.id}PrimaryCandidateId`]: primary.id,
      [`${stage.id}LockedAt`]: new Date().toISOString(),
    }
    const advanced = await transaction.visualDevelopmentCharacter.updateMany({
      where: { id: batch.characterId, updatedAt: currentCharacter.updatedAt },
      data: { status: stage.lockedStatus, characterDna: nextDna },
    })
    if (advanced.count !== 1) {
      throw new ApiError('CONFLICT', { code: 'VISUAL_DEVELOPMENT_WRITE_CONFLICT' })
    }
    return nextVersion
  })
  return NextResponse.json({ success: true, data: { batchId, stage: stage.id, version } })
})

import { randomInt, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler, isApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { resolveModelSelection } from '@/lib/api-config'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { projectCandidateTask, readResultKey } from '@/lib/visual-development/records'
import type { CandidateGenerationSnapshot } from '@/lib/visual-development/candidate-history'
import { getSignedUrl } from '@/lib/cos'
import { buildWorldBibleAssetPrompt } from '@/lib/visual-development/world-bible-prompt'
import { updateVisualDevelopmentWorkspaceAtRevision } from '@/lib/visual-development/workspace-concurrency'
import {
  MAX_WORLD_GENERATION_REFERENCES,
  approvedResearchReferenceKeys,
  evaluateResearchGate,
} from '@/lib/visual-development/research'
import {
  EMPTY_WORLD_BIBLE,
  WORLD_ASSET_DEFINITIONS,
  parseWorldBible,
  toWorldBibleJson,
  worldBibleRequiredFieldsComplete,
  type WorldAssetCode,
  type WorldBibleAsset,
  type WorldBibleDocument,
  type PendingWorldBibleAsset,
  type WorldGenerationReservation,
} from '@/lib/visual-development/world-bible'

type RouteContext = { params: Promise<{ projectId: string }> }
type JsonRecord = Record<string, unknown>

const EDITABLE_FIELDS = [
  'projectPremise',
  'visualThesis',
  'eraAndGeography',
  'societyAndFactions',
  'technologyRules',
  'colorScript',
  'materialRules',
  'architectureLanguage',
  'cameraFormat',
  'forbiddenElements',
] as const

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function requiredString(value: unknown, field: string, max = 4000): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  if (normalized.length > max) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  }
  return normalized
}

function isWorldAssetCode(value: unknown): value is WorldAssetCode {
  return WORLD_ASSET_DEFINITIONS.some((definition) => definition.code === value)
}

function mergeEditableWorldBible(current: WorldBibleDocument, value: unknown): WorldBibleDocument {
  const input = record(value)
  const next = { ...current }
  for (const field of EDITABLE_FIELDS) {
    if (typeof input[field] === 'string') {
      if (input[field].length > 8_000) {
        throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max: 8_000 } })
      }
      next[field] = input[field].trim()
    }
  }
  if (typeof input.modelKey === 'string') {
    if (input.modelKey.length > 255) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field: 'modelKey', details: { max: 255 } })
    next.modelKey = input.modelKey.trim()
  }
  if (typeof input.resolution === 'string') {
    if (input.resolution.length > 64) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field: 'resolution', details: { max: 64 } })
    next.resolution = input.resolution.trim()
  }
  if (typeof input.aspectRatio === 'string' && input.aspectRatio.trim()) {
    if (input.aspectRatio.length > 32) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field: 'aspectRatio', details: { max: 32 } })
    next.aspectRatio = input.aspectRatio.trim()
  }
  return next
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

async function loadWorkspace(projectId: string) {
  return await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
}

function isWorkspaceWriteConflict(error: unknown): boolean {
  if (!isApiError(error)) return false
  return record(error.details).code === 'VISUAL_DEVELOPMENT_WRITE_CONFLICT'
}

async function finalizeReservedWorldGeneration(input: {
  projectId: string
  runId: string
  taskIdsByCode: Map<WorldAssetCode, string>
  status: string
}): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const workspace = await loadWorkspace(input.projectId)
    if (!workspace) throw new ApiError('NOT_FOUND')
    const document = parseWorldBible(workspace.worldBible)
    const reservation = document.generationReservation
    if (reservation?.id !== input.runId) {
      const alreadyPersisted = [...input.taskIdsByCode.values()].every((taskId) =>
        document.assets.some((asset) => asset.taskId === taskId),
      )
      if (alreadyPersisted) return
      throw new ApiError('CONFLICT', { code: 'WORLD_GENERATION_RESERVATION_LOST' })
    }
    const resolvedAssets: WorldBibleAsset[] = reservation.pendingAssets.flatMap((pending) => {
      const taskId = input.taskIdsByCode.get(pending.code)
      return taskId ? [{ ...pending, taskId }] : []
    })
    document.assets = reservation.kind === 'initial'
      ? resolvedAssets
      : document.assets.map((asset) => resolvedAssets.find((candidate) => candidate.code === asset.code) ?? asset)
    document.generationReservation = null
    document.canonId = null
    document.lockedAt = null
    try {
      await updateVisualDevelopmentWorkspaceAtRevision(workspace, {
        worldBible: toWorldBibleJson(document),
        status: input.status,
      })
      return
    } catch (error) {
      if (!isWorkspaceWriteConflict(error) || attempt === 4) throw error
    }
  }
}

const WORLD_RESERVATION_STALE_MS = 5 * 60 * 1000

async function reconcileReservedWorldGeneration(input: {
  projectId: string
  userId: string
  reservation: WorldGenerationReservation
}): Promise<{ resolved: boolean; recovered: number; expected: number; stale: boolean }> {
  if (!input.reservation.ownerUserId) {
    // Ownerless reservations only exist in legacy rows. Recovery is restricted
    // to the project owner; collaborators never gain cross-user task access.
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { userId: true },
    })
    if (!project || project.userId !== input.userId) {
      throw new ApiError('FORBIDDEN', { code: 'WORLD_GENERATION_RESERVATION_OWNER_REQUIRED' })
    }
  } else if (input.reservation.ownerUserId !== input.userId) {
    throw new ApiError('FORBIDDEN', { code: 'WORLD_GENERATION_RESERVATION_OWNER_REQUIRED' })
  }
  const tasks = await prisma.task.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      targetType: 'visual-development-world-asset',
      targetId: { endsWith: `:${input.reservation.id}` },
    },
    select: { id: true, payload: true },
  })
  const expectedCodes = new Set(input.reservation.pendingAssets.map((asset) => asset.code))
  const taskIdsByCode = new Map<WorldAssetCode, string>()
  for (const task of tasks) {
    const payload = record(task.payload)
    const meta = record(payload.meta)
    const code = meta.visualDevelopmentWorldAssetCode
    if (isWorldAssetCode(code) && expectedCodes.has(code)) taskIdsByCode.set(code, task.id)
  }
  const startedAt = Date.parse(input.reservation.startedAt)
  const stale = !Number.isFinite(startedAt) || Date.now() - startedAt >= WORLD_RESERVATION_STALE_MS
  const complete = taskIdsByCode.size === expectedCodes.size
  if (!complete && !stale) {
    return { resolved: false, recovered: taskIdsByCode.size, expected: expectedCodes.size, stale: false }
  }
  await finalizeReservedWorldGeneration({
    projectId: input.projectId,
    runId: input.reservation.id,
    taskIdsByCode,
    status: complete ? 'world_generating' : taskIdsByCode.size > 0 ? 'world_partial_failed' : 'world_failed',
  })
  return { resolved: true, recovered: taskIdsByCode.size, expected: expectedCodes.size, stale }
}

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'read')
  if (access instanceof Response) return access
  const workspace = await loadWorkspace(projectId)
  const document = workspace ? parseWorldBible(workspace.worldBible) : EMPTY_WORLD_BIBLE
  const legacyReservationOwner = document.generationReservation && !document.generationReservation.ownerUserId
    ? await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } })
    : null
  const taskIds = [...new Set(document.assets.flatMap((asset) => [
    asset.taskId,
    ...asset.history.map((revision) => revision.taskId),
  ]))]
  const tasks = taskIds.length > 0
    ? await prisma.task.findMany({
      where: { id: { in: taskIds }, projectId, userId: access.userId },
      select: { id: true, status: true, progress: true, result: true, errorCode: true, errorMessage: true },
    })
    : []
  const tasksById = new Map(tasks.map((task) => [task.id, task]))

  return NextResponse.json({
    success: true,
    data: {
      worldBible: {
        ...document,
        generationReservation: document.generationReservation
          && (document.generationReservation.ownerUserId === access.userId
            || (!document.generationReservation.ownerUserId && legacyReservationOwner?.userId === access.userId))
          ? { id: document.generationReservation.id }
          : null,
        generationReservationActive: Boolean(document.generationReservation),
        references: document.references.map((reference) => ({
          ...reference,
          previewUrl: getSignedUrl(reference.key, 3600),
        })),
        status: workspace?.status ?? 'draft',
        version: workspace?.worldVersion ?? 1,
        researchStatus: document.research.status,
        inheritedReferenceCount: approvedResearchReferenceKeys(document.research).length,
        assets: document.assets.map((asset) => ({
          ...asset,
          ...projectCandidateTask({ taskId: asset.taskId, status: 'pending' }, tasksById),
          history: [...asset.history].reverse().map((revision) => ({
            ...revision,
            ...projectCandidateTask({ taskId: revision.taskId, status: 'completed' }, tasksById),
          })),
        })),
      },
    },
  })
})

export const PUT = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = record(await request.json())
  const workspace = await loadWorkspace(projectId)
  if (workspace?.status === 'world_locked') {
    throw new ApiError('CONFLICT', { code: 'WORLD_BIBLE_LOCKED' })
  }
  const document = mergeEditableWorldBible(
    workspace ? parseWorldBible(workspace.worldBible) : EMPTY_WORLD_BIBLE,
    body.worldBible,
  )
  if (workspace) {
    await updateVisualDevelopmentWorkspaceAtRevision(workspace, {
      worldBible: toWorldBibleJson(document),
      status: 'world_draft',
    })
  } else {
    await prisma.visualDevelopmentWorkspace.create({
      data: { projectId, worldBible: toWorldBibleJson(document), status: 'world_draft' },
    })
  }
  return NextResponse.json({ success: true, data: { status: 'world_draft', version: workspace?.worldVersion ?? 1 } })
})

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = record(await request.json())
  const locale = resolveRequiredTaskLocale(request, body)
  const workspace = await loadWorkspace(projectId)
  if (workspace?.status === 'world_locked') {
    throw new ApiError('CONFLICT', { code: 'WORLD_BIBLE_LOCKED' })
  }
  const document = mergeEditableWorldBible(
    workspace ? parseWorldBible(workspace.worldBible) : EMPTY_WORLD_BIBLE,
    body.worldBible,
  )
  if (!worldBibleRequiredFieldsComplete(document)) {
    throw new ApiError('INVALID_PARAMS', { code: 'WORLD_BIBLE_REQUIRED_FIELDS_INCOMPLETE' })
  }
  if (document.research.status !== 'locked' || !evaluateResearchGate(document.research).ready) {
    throw new ApiError('CONFLICT', { code: 'RESEARCH_CANON_REQUIRED' })
  }
  if (document.generationReservation) {
    const reconciliation = await reconcileReservedWorldGeneration({
      projectId,
      userId: access.userId,
      reservation: document.generationReservation,
    })
    if (reconciliation.resolved) {
      return NextResponse.json({
        success: true,
        data: {
          action: 'recover-generation',
          runId: document.generationReservation.id,
          reconciled: true,
          ...reconciliation,
        },
      })
    }
    throw new ApiError('CONFLICT', {
      code: 'WORLD_ASSET_GENERATION_RESERVED',
      details: { runId: document.generationReservation.id, ...reconciliation },
    })
  }
  const existingTaskIds = document.assets.map((asset) => asset.taskId)
  if (existingTaskIds.length > 0) {
    const activeTaskCount = await prisma.task.count({
      where: {
        id: { in: existingTaskIds },
        projectId,
        userId: access.userId,
        status: { in: ['queued', 'processing'] },
      },
    })
    if (activeTaskCount > 0) {
      throw new ApiError('CONFLICT', {
        code: 'WORLD_ASSET_GENERATION_ACTIVE',
        activeTaskCount,
      })
    }
  }
  const modelKey = requiredString(body.modelKey ?? document.modelKey, 'modelKey', 255)
  document.modelKey = modelKey

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
  // Phase 00 uploads are internal visual notes. Only Phase -1 references with
  // reviewed rights and explicit external-processing consent may leave KuiperFilm.
  const referenceKeys = [...new Set(approvedResearchReferenceKeys(document.research))]
  if (referenceKeys.length > MAX_WORLD_GENERATION_REFERENCES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'REFERENCE_IMAGE_LIMIT_EXCEEDED',
      details: { got: referenceKeys.length, max: MAX_WORLD_GENERATION_REFERENCES },
    })
  }
  if (referenceKeys.length === 1 && capabilities?.supportReferenceImage !== true) {
    throw new ApiError('INVALID_PARAMS', { code: 'REFERENCE_IMAGE_UNSUPPORTED' })
  }
  if (referenceKeys.length > 1 && capabilities?.supportMultiReferenceImage !== true) {
    throw new ApiError('INVALID_PARAMS', { code: 'MULTI_REFERENCE_IMAGE_UNSUPPORTED' })
  }
  const modelReferenceLimit = capabilities?.maxReferenceImages
    ?? (capabilities?.supportMultiReferenceImage === true
      ? MAX_WORLD_GENERATION_REFERENCES
      : capabilities?.supportReferenceImage === true ? 1 : 0)
  if (referenceKeys.length > modelReferenceLimit) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_REFERENCE_IMAGE_LIMIT_EXCEEDED',
      details: { got: referenceKeys.length, max: modelReferenceLimit, modelKey },
    })
  }
  if (!capabilities?.aspectRatioOptions?.includes(document.aspectRatio)) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASPECT_RATIO_UNSUPPORTED', field: 'aspectRatio' })
  }
  if (document.resolution && capabilities?.resolutionOptions && !capabilities.resolutionOptions.includes(document.resolution)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESOLUTION_UNSUPPORTED', field: 'resolution' })
  }

  const seedSupported = capabilities?.supportSeed === true
  const runId = randomUUID()
  const pendingAssets: PendingWorldBibleAsset[] = WORLD_ASSET_DEFINITIONS.map((definition) => {
    const prompt = buildWorldBibleAssetPrompt(document, definition.code)
    const effectivePrompt = capabilities?.supportNegativePrompt === true
      ? prompt.prompt
      : `${prompt.prompt}\n\nThe selected model has no separate negative-prompt channel. Explicit exclusions: ${prompt.negativePrompt}. Do not render any excluded item.`
    const requestedSeed = seedSupported ? randomInt(1, 2_147_483_647) : null
    return {
      code: definition.code,
      prompt: effectivePrompt,
      negativePrompt: prompt.negativePrompt,
      requestedSeed,
      seedStatus: requestedSeed === null ? 'unsupported' as const : 'applied' as const,
      approved: false,
      rejectionNote: null,
      originPrompt: effectivePrompt,
      history: [],
    }
  })
  if (!workspace) throw new ApiError('CONFLICT', { code: 'RESEARCH_CANON_REQUIRED' })
  document.generationReservation = {
    id: runId,
    ownerUserId: access.userId,
    kind: 'initial',
    startedAt: new Date().toISOString(),
    pendingAssets,
  }
  await updateVisualDevelopmentWorkspaceAtRevision(workspace, {
    worldBible: toWorldBibleJson(document),
    status: 'world_submitting',
  })

  const submissions = await Promise.allSettled(pendingAssets.map(async (pending) => {
    const submitted = await submitTask({
      userId: access.userId,
      locale,
      projectId,
      type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
      targetType: 'visual-development-world-asset',
      targetId: `${projectId}:${pending.code}:${runId}`,
      dedupeKey: `visual-development-world:${projectId}:${runId}:${pending.code}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload: {
        prompt: pending.prompt,
        modelKey: selection.modelKey,
        modelId: selection.modelId,
        aspectRatio: document.aspectRatio,
        ...(document.resolution ? { resolution: document.resolution } : {}),
        ...(referenceKeys.length > 0 ? { referenceImages: referenceKeys } : {}),
        ...(capabilities?.supportNegativePrompt === true ? { negativePrompt: pending.negativePrompt } : {}),
        ...(pending.requestedSeed !== null ? { seed: pending.requestedSeed } : {}),
        generationCount: 1,
        meta: {
          originPrompt: pending.prompt,
          originModelKey: selection.modelKey,
          visualDevelopmentWorldRunId: runId,
          visualDevelopmentWorldAssetCode: pending.code,
        },
      },
    })
    return { code: pending.code, taskId: submitted.taskId }
  }))
  const submittedAssets = submissions.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failed = submissions.length - submittedAssets.length
  await finalizeReservedWorldGeneration({
    projectId,
    runId,
    taskIdsByCode: new Map(submittedAssets.map((asset) => [asset.code, asset.taskId])),
    status: failed === 0 ? 'world_generating' : failed === submissions.length ? 'world_failed' : 'world_partial_failed',
  })
  return NextResponse.json({
    success: failed === 0,
    data: { runId, submitted: submittedAssets.length, failed, seedSupported },
  }, { status: failed === 0 ? 202 : 207 })
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = record(await request.json())
  const action = requiredString(body.action, 'action', 32)
  const workspace = await loadWorkspace(projectId)
  if (!workspace) throw new ApiError('NOT_FOUND')
  const document = parseWorldBible(workspace.worldBible)
  if (document.generationReservation) {
    const reconciliation = await reconcileReservedWorldGeneration({
      projectId,
      userId: access.userId,
      reservation: document.generationReservation,
    })
    if (reconciliation.resolved) {
      return NextResponse.json({
        success: true,
        data: {
          action: 'recover-generation',
          requestedAction: action,
          runId: document.generationReservation.id,
          reconciled: true,
          ...reconciliation,
        },
      })
    }
    throw new ApiError('CONFLICT', {
      code: 'WORLD_ASSET_GENERATION_RESERVED',
      details: { runId: document.generationReservation.id, ...reconciliation },
    })
  }
  if (action === 'recover-generation') {
    return NextResponse.json({ success: true, data: { action, resolved: false, recovered: 0, expected: 0 } })
  }

  if (action === 'regenerate-asset') {
    if (workspace.status === 'world_locked') throw new ApiError('CONFLICT', { code: 'WORLD_BIBLE_LOCKED' })
    if (!isWorldAssetCode(body.code)) throw new ApiError('INVALID_PARAMS', { code: 'WORLD_ASSET_CODE_INVALID' })
    const asset = document.assets.find((item) => item.code === body.code)
    if (!asset) throw new ApiError('NOT_FOUND', { code: 'WORLD_ASSET_NOT_FOUND' })
    const prompt = requiredString(body.prompt, 'prompt', 30_000)
    const seedMode = body.seedMode === 'reuse' ? 'reuse' : 'new'
    const previousTask = await prisma.task.findFirst({
      where: { id: asset.taskId, projectId, userId: access.userId },
      select: { id: true, type: true, targetType: true, payload: true, result: true, status: true },
    })
    const previousCompleted = previousTask?.status === 'completed' && Boolean(readResultKey(previousTask.result))
    const previousFailed = previousTask?.status === 'failed' || previousTask?.status === 'dismissed'
    if (!previousTask || (!previousCompleted && !previousFailed)) {
      throw new ApiError('CONFLICT', { code: 'WORLD_ASSET_NOT_COMPLETED' })
    }
    if (previousTask.type !== TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE) {
      throw new ApiError('CONFLICT', { code: 'WORLD_ASSET_TASK_TYPE_UNSUPPORTED' })
    }
    const previousPayload = record(previousTask.payload)
    const previousMeta = record(previousPayload.meta)
    const regenerationReferenceKeys = [...new Set(approvedResearchReferenceKeys(document.research))]
    const previousModelKey = typeof previousPayload.modelKey === 'string' ? previousPayload.modelKey : document.modelKey
    const previousSelection = await resolveModelSelection(access.userId, previousModelKey, 'image')
    const previousCapabilities = findBuiltinCapabilities('image', previousSelection.provider, previousSelection.modelId)?.image
    const previousReferenceLimit = previousCapabilities?.maxReferenceImages
      ?? (previousCapabilities?.supportMultiReferenceImage === true ? 2 : previousCapabilities?.supportReferenceImage === true ? 1 : 0)
    if (regenerationReferenceKeys.length > previousReferenceLimit) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MODEL_REFERENCE_IMAGE_LIMIT_EXCEEDED',
        details: { got: regenerationReferenceKeys.length, max: previousReferenceLimit, modelKey: previousModelKey },
      })
    }
    const seedSupported = asset.seedStatus === 'applied'
    const requestedSeed = seedSupported
      ? seedMode === 'reuse' && asset.requestedSeed !== null
        ? asset.requestedSeed
        : randomInt(1, 2_147_483_647)
      : null
    const runId = randomUUID()
    const payload: Record<string, unknown> = {
      ...previousPayload,
      prompt,
      ...(regenerationReferenceKeys.length > 0 ? { referenceImages: regenerationReferenceKeys } : {}),
      ...(seedSupported && requestedSeed !== null ? { seed: requestedSeed } : {}),
      meta: {
        ...previousMeta,
        originPrompt: prompt,
        previousVisualDevelopmentTaskId: previousTask.id,
        visualDevelopmentWorldRunId: runId,
        visualDevelopmentWorldAssetCode: asset.code,
        regenerationSeedMode: seedMode,
      },
    }
    if (regenerationReferenceKeys.length === 0) delete payload.referenceImages
    if (!seedSupported) delete payload.seed
    const snapshot: CandidateGenerationSnapshot = {
      taskId: previousTask.id,
      prompt: asset.prompt,
      negativePrompt: asset.negativePrompt,
      requestedSeed: asset.requestedSeed,
      effectiveSeed: asset.requestedSeed,
      seedStatus: asset.seedStatus,
      modelKey: typeof previousPayload.modelKey === 'string' ? previousPayload.modelKey : document.modelKey,
      provider: '',
      modelId: typeof previousPayload.modelId === 'string' ? previousPayload.modelId : '',
      modelVersion: null,
      aspectRatio: document.aspectRatio,
      resolution: document.resolution || null,
      shortlisted: asset.approved,
      isCanon: false,
      rejectionNote: asset.rejectionNote,
      createdAt: new Date().toISOString(),
    }
    const appended = [...asset.history, snapshot]
    const history = appended.length <= 30 || !appended[0]
      ? appended
      : [appended[0], ...appended.slice(-29)]
    const pendingAsset: PendingWorldBibleAsset = {
      code: asset.code,
      prompt,
      negativePrompt: asset.negativePrompt,
      requestedSeed,
      seedStatus: seedSupported ? 'applied' : 'unsupported',
      approved: false,
      rejectionNote: null,
      originPrompt: asset.originPrompt || snapshot.prompt,
      history,
    }
    document.generationReservation = {
      id: runId,
      ownerUserId: access.userId,
      kind: 'regenerate',
      startedAt: new Date().toISOString(),
      pendingAssets: [pendingAsset],
    }
    await updateVisualDevelopmentWorkspaceAtRevision(workspace, {
      worldBible: toWorldBibleJson(document),
      status: 'world_submitting',
    })
    let submitted
    try {
      submitted = await submitTask({
        userId: access.userId,
        locale: resolveRequiredTaskLocale(request, body),
        projectId,
        type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
        targetType: previousTask.targetType,
        targetId: `${projectId}:${asset.code}:${runId}`,
        dedupeKey: `visual-development-world-regenerate:${projectId}:${runId}:${asset.code}`,
        dedupeMode: 'idempotent',
        skipRateLimit: true,
        payload,
      })
    } catch (error) {
      await finalizeReservedWorldGeneration({
        projectId,
        runId,
        taskIdsByCode: new Map(),
        status: 'world_failed',
      })
      throw error
    }
    await finalizeReservedWorldGeneration({
      projectId,
      runId,
      taskIdsByCode: new Map([[asset.code, submitted.taskId]]),
      status: 'world_generating',
    })
    return NextResponse.json({
      success: true,
      data: { code: asset.code, taskId: submitted.taskId, requestedSeed, seedMode },
    }, { status: 202 })
  }

  if (action === 'asset-review') {
    if (workspace.status === 'world_locked') throw new ApiError('CONFLICT', { code: 'WORLD_BIBLE_LOCKED' })
    if (!isWorldAssetCode(body.code)) throw new ApiError('INVALID_PARAMS', { code: 'WORLD_ASSET_CODE_INVALID' })
    const asset = document.assets.find((item) => item.code === body.code)
    if (!asset) throw new ApiError('NOT_FOUND')
    const task = await prisma.task.findFirst({
      where: { id: asset.taskId, projectId, userId: access.userId, status: 'completed' },
      select: { id: true },
    })
    if (!task) throw new ApiError('CONFLICT', { code: 'WORLD_ASSET_NOT_COMPLETED' })
    asset.approved = body.approved === true
    asset.rejectionNote = asset.approved ? null : requiredString(body.rejectionNote, 'rejectionNote', 2000)
    await updateVisualDevelopmentWorkspaceAtRevision(workspace, {
      worldBible: toWorldBibleJson(document),
      status: 'world_review',
    })
    return NextResponse.json({ success: true, data: { code: asset.code, approved: asset.approved } })
  }

  if (action !== 'canon-lock') {
    throw new ApiError('INVALID_PARAMS', { code: 'WORLD_BIBLE_ACTION_INVALID' })
  }
  if (document.research.status !== 'locked' || !evaluateResearchGate(document.research).ready) {
    throw new ApiError('CONFLICT', { code: 'RESEARCH_CANON_REQUIRED' })
  }
  if (!worldBibleRequiredFieldsComplete(document)) {
    throw new ApiError('CONFLICT', { code: 'WORLD_BIBLE_REQUIRED_FIELDS_INCOMPLETE' })
  }
  if (document.assets.length !== WORLD_ASSET_DEFINITIONS.length || document.assets.some((asset) => !asset.approved)) {
    throw new ApiError('CONFLICT', { code: 'WORLD_ASSETS_APPROVAL_REQUIRED' })
  }
  const completedTasks = await prisma.task.count({
    where: { id: { in: document.assets.map((asset) => asset.taskId) }, projectId, userId: access.userId, status: 'completed' },
  })
  if (completedTasks !== WORLD_ASSET_DEFINITIONS.length) {
    throw new ApiError('CONFLICT', { code: 'WORLD_ASSETS_NOT_COMPLETED' })
  }
  const lockedAt = new Date()
  document.lockedAt = lockedAt.toISOString()
  document.canonId = `WORLD-${projectId.slice(0, 8).toUpperCase()}-v${String(workspace.worldVersion).padStart(3, '0')}`
  await updateVisualDevelopmentWorkspaceAtRevision(workspace, {
    worldBible: toWorldBibleJson(document),
    status: 'world_locked',
  })
  return NextResponse.json({ success: true, data: { canonId: document.canonId, lockedAt: document.lockedAt } })
})

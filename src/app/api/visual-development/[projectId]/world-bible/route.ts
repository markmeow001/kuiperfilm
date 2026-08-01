import { randomInt, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
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
  type WorldBibleDocument,
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

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'read')
  if (access instanceof Response) return access
  const workspace = await loadWorkspace(projectId)
  const document = workspace ? parseWorldBible(workspace.worldBible) : EMPTY_WORLD_BIBLE
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
  const saved = await prisma.visualDevelopmentWorkspace.upsert({
    where: { projectId },
    create: { projectId, worldBible: toWorldBibleJson(document), status: 'world_draft' },
    update: { worldBible: toWorldBibleJson(document), status: 'world_draft' },
  })
  return NextResponse.json({ success: true, data: { status: saved.status, version: saved.worldVersion } })
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
  const referenceKeys = [...new Set([
    ...approvedResearchReferenceKeys(document.research),
    ...document.references.map((reference) => reference.key),
  ])]
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
  if (!capabilities?.aspectRatioOptions?.includes(document.aspectRatio)) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASPECT_RATIO_UNSUPPORTED', field: 'aspectRatio' })
  }
  if (document.resolution && capabilities?.resolutionOptions && !capabilities.resolutionOptions.includes(document.resolution)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESOLUTION_UNSUPPORTED', field: 'resolution' })
  }

  const seedSupported = capabilities?.supportSeed === true
  const runId = randomUUID()
  const submissions = await Promise.allSettled(WORLD_ASSET_DEFINITIONS.map(async (definition) => {
    const prompt = buildWorldBibleAssetPrompt(document, definition.code)
    const requestedSeed = seedSupported ? randomInt(1, 2_147_483_647) : null
    const submitted = await submitTask({
      userId: access.userId,
      locale,
      projectId,
      type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
      targetType: 'visual-development-world-asset',
      targetId: `${projectId}:${definition.code}:${runId}`,
      dedupeKey: `visual-development-world:${projectId}:${runId}:${definition.code}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload: {
        prompt: prompt.prompt,
        modelKey: selection.modelKey,
        modelId: selection.modelId,
        aspectRatio: document.aspectRatio,
        ...(document.resolution ? { resolution: document.resolution } : {}),
        ...(referenceKeys.length > 0 ? { referenceImages: referenceKeys } : {}),
        ...(capabilities?.supportNegativePrompt === true ? { negativePrompt: prompt.negativePrompt } : {}),
        ...(requestedSeed !== null ? { seed: requestedSeed } : {}),
        generationCount: 1,
        meta: {
          originPrompt: prompt.prompt,
          originModelKey: selection.modelKey,
          visualDevelopmentWorldRunId: runId,
          visualDevelopmentWorldAssetCode: definition.code,
        },
      },
    })
    return {
      code: definition.code,
      taskId: submitted.taskId,
      prompt: prompt.prompt,
      negativePrompt: prompt.negativePrompt,
      requestedSeed,
      seedStatus: requestedSeed === null ? 'unsupported' as const : 'applied' as const,
      approved: false,
      rejectionNote: null,
      originPrompt: prompt.prompt,
      history: [],
    }
  }))
  const assets = submissions.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  document.assets = assets
  document.canonId = null
  document.lockedAt = null
  const failed = submissions.length - assets.length
  await prisma.visualDevelopmentWorkspace.upsert({
    where: { projectId },
    create: {
      projectId,
      worldBible: toWorldBibleJson(document),
      status: failed === 0 ? 'world_generating' : failed === submissions.length ? 'world_failed' : 'world_partial_failed',
    },
    update: {
      worldBible: toWorldBibleJson(document),
      status: failed === 0 ? 'world_generating' : failed === submissions.length ? 'world_failed' : 'world_partial_failed',
    },
  })
  return NextResponse.json({
    success: failed === 0,
    data: { runId, submitted: assets.length, failed, seedSupported },
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
    const seedSupported = asset.seedStatus === 'applied'
    const requestedSeed = seedSupported
      ? seedMode === 'reuse' && asset.requestedSeed !== null
        ? asset.requestedSeed
        : randomInt(1, 2_147_483_647)
      : null
    const payload: Record<string, unknown> = {
      ...previousPayload,
      prompt,
      ...(seedSupported && requestedSeed !== null ? { seed: requestedSeed } : {}),
      meta: {
        ...previousMeta,
        originPrompt: prompt,
        previousVisualDevelopmentTaskId: previousTask.id,
        visualDevelopmentWorldAssetCode: asset.code,
        regenerationSeedMode: seedMode,
      },
    }
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
    const submitted = await submitTask({
      userId: access.userId,
      locale: resolveRequiredTaskLocale(request, body),
      projectId,
      type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
      targetType: previousTask.targetType,
      targetId: `${projectId}:${asset.code}:${randomUUID()}`,
      dedupeKey: `visual-development-world-regenerate:${projectId}:${asset.code}:${randomUUID()}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload,
    })
    const appended = [...asset.history, snapshot]
    asset.history = appended.length <= 30 || !appended[0]
      ? appended
      : [appended[0], ...appended.slice(-29)]
    asset.originPrompt = asset.originPrompt || snapshot.prompt
    asset.taskId = submitted.taskId
    asset.prompt = prompt
    asset.requestedSeed = requestedSeed
    asset.seedStatus = seedSupported ? 'applied' : 'unsupported'
    asset.approved = false
    asset.rejectionNote = null
    document.canonId = null
    document.lockedAt = null
    await prisma.visualDevelopmentWorkspace.update({
      where: { id: workspace.id },
      data: { worldBible: toWorldBibleJson(document), status: 'world_generating' },
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
    await prisma.visualDevelopmentWorkspace.update({
      where: { id: workspace.id },
      data: { worldBible: toWorldBibleJson(document), status: 'world_review' },
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
  await prisma.visualDevelopmentWorkspace.update({
    where: { id: workspace.id },
    data: { worldBible: toWorldBibleJson(document), status: 'world_locked' },
  })
  return NextResponse.json({ success: true, data: { canonId: document.canonId, lockedAt: document.lockedAt } })
})

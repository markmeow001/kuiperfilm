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
import { projectCandidateTask } from '@/lib/visual-development/records'
import { getSignedUrl } from '@/lib/cos'
import { buildWorldBibleAssetPrompt } from '@/lib/visual-development/world-bible-prompt'
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
  const taskIds = document.assets.map((asset) => asset.taskId)
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
        assets: document.assets.map((asset) => ({
          ...asset,
          ...projectCandidateTask({ taskId: asset.taskId, status: 'pending' }, tasksById),
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
  if (document.references.length === 1 && capabilities?.supportReferenceImage !== true) {
    throw new ApiError('INVALID_PARAMS', { code: 'REFERENCE_IMAGE_UNSUPPORTED' })
  }
  if (document.references.length > 1 && capabilities?.supportMultiReferenceImage !== true) {
    throw new ApiError('INVALID_PARAMS', { code: 'MULTI_REFERENCE_IMAGE_UNSUPPORTED' })
  }
  if (capabilities?.aspectRatioOptions && !capabilities.aspectRatioOptions.includes(document.aspectRatio)) {
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
        ...(document.references.length > 0 ? { referenceImages: document.references.map((reference) => reference.key) } : {}),
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

import { ApiError } from '@/lib/api-errors'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { isSafeReference } from '@/lib/playground/reference-guard'
import { TASK_TYPE } from '@/lib/task/types'
import {
  isAssetMimeCompatible,
  readTaskResultStorageKey,
  readTaskWorkspaceId,
  type CanvasAssetCreateInput,
  type CanvasAssetType,
} from './canvas-assets-contract'

interface CanvasAssetRow {
  id: string
  scopeKey: string
  ownerUserId: string
  workspaceId: string | null
  sourceCanvasId: string | null
  storageKey: string
  primaryMediaId: string
  firstFrameMediaId: string | null
  lastFrameMediaId: string | null
  type: string
  name: string
  folder: string | null
  description: string | null
  createdAt: Date
  primaryMedia: { publicId: string; mimeType: string | null }
  firstFrameMedia: { publicId: string; storageKey: string } | null
  lastFrameMedia: { publicId: string; storageKey: string } | null
}

type CanvasAssetModel = {
  findFirst(args: unknown): Promise<CanvasAssetRow | null>
  findMany(args: unknown): Promise<CanvasAssetRow[]>
  create(args: unknown): Promise<CanvasAssetRow>
}

const canvasAssetModel = (prisma as unknown as { canvasAsset: CanvasAssetModel }).canvasAsset
const ALLOWED_TASK_TYPES = new Set<string>([
  TASK_TYPE.PLAYGROUND_IMAGE,
  TASK_TYPE.PLAYGROUND_VIDEO,
  TASK_TYPE.CANVAS_COMPOSE_VIDEO,
])

export interface CanvasAssetScope {
  scopeKey: string
  workspaceId: string | null
}

function mediaRoute(publicId: string): string {
  return `/m/${encodeURIComponent(publicId)}`
}

function assertBareStorageKey(key: string): string {
  const normalized = key.trim().replace(/^\/+/, '')
  if (!normalized || normalized.includes('..') || /^[a-z]+:\/\//i.test(normalized)) {
    throw new ApiError('FORBIDDEN', { code: 'CANVAS_ASSET_KEY_INVALID' })
  }
  return normalized
}

function assetView(row: CanvasAssetRow) {
  return {
    id: row.id,
    type: row.type as CanvasAssetType,
    name: row.name,
    folder: row.folder,
    description: row.description,
    storageKey: row.storageKey,
    mediaUrl: mediaRoute(row.primaryMedia.publicId),
    mimeType: row.primaryMedia.mimeType,
    firstFrameKey: row.firstFrameMedia?.storageKey ?? null,
    firstFrameUrl: row.firstFrameMedia ? mediaRoute(row.firstFrameMedia.publicId) : null,
    lastFrameKey: row.lastFrameMedia?.storageKey ?? null,
    lastFrameUrl: row.lastFrameMedia ? mediaRoute(row.lastFrameMedia.publicId) : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function resolveCanvasAssetScope(
  canvasId: string,
  userId: string,
  options: { write: boolean; isAdmin: boolean },
): Promise<CanvasAssetScope> {
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: { id: true, userId: true, workspaceId: true },
  })
  if (!canvas) throw new ApiError('NOT_FOUND', { code: 'CANVAS_NOT_FOUND' })

  if (!canvas.workspaceId) {
    if (!options.isAdmin && canvas.userId !== userId) {
      throw new ApiError('NOT_FOUND', { code: 'CANVAS_NOT_FOUND' })
    }
    return { scopeKey: `user:${canvas.userId}`, workspaceId: null }
  }

  if (options.isAdmin) return { scopeKey: `workspace:${canvas.workspaceId}`, workspaceId: canvas.workspaceId }
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: canvas.workspaceId }, select: { ownerEditorId: true } }),
    prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: canvas.workspaceId, userId } },
      select: { role: true },
    }),
  ])
  if (!workspace || (workspace.ownerEditorId !== userId && !membership)) {
    throw new ApiError('FORBIDDEN', { code: 'CANVAS_WORKSPACE_ACCESS_DENIED' })
  }
  if (options.write && workspace.ownerEditorId !== userId && membership?.role !== 'editor') {
    throw new ApiError('FORBIDDEN', { code: 'CANVAS_ASSET_WRITE_DENIED' })
  }
  return { scopeKey: `workspace:${canvas.workspaceId}`, workspaceId: canvas.workspaceId }
}

async function assertDirectKeyAllowed(key: string, userId: string, scopeKey: string): Promise<string> {
  const normalized = assertBareStorageKey(key)
  if (isSafeReference(normalized, userId)) return normalized
  const existing = await canvasAssetModel.findFirst({ where: { scopeKey, storageKey: normalized }, select: { id: true } })
  if (!existing) throw new ApiError('FORBIDDEN', { code: 'CANVAS_ASSET_KEY_NOT_OWNED' })
  return normalized
}

async function resolvePrimaryKey(
  input: CanvasAssetCreateInput,
  userId: string,
  scope: CanvasAssetScope,
): Promise<string> {
  if (input.source.kind === 'storage-key') {
    return assertDirectKeyAllowed(input.source.storageKey, userId, scope.scopeKey)
  }
  const task = await prisma.task.findUnique({
    where: { id: input.source.taskId },
    select: { userId: true, type: true, status: true, payload: true, result: true },
  })
  if (!task || task.status !== 'completed' || !ALLOWED_TASK_TYPES.has(task.type)) {
    throw new ApiError('NOT_FOUND', { code: 'CANVAS_ASSET_SOURCE_NOT_READY' })
  }
  if (scope.workspaceId) {
    if (readTaskWorkspaceId(task.payload) !== scope.workspaceId) {
      throw new ApiError('FORBIDDEN', { code: 'CANVAS_ASSET_SOURCE_SCOPE_MISMATCH' })
    }
  } else if (task.userId !== userId || readTaskWorkspaceId(task.payload)) {
    throw new ApiError('FORBIDDEN', { code: 'CANVAS_ASSET_SOURCE_SCOPE_MISMATCH' })
  }
  const key = readTaskResultStorageKey(task.result)
  if (!key) throw new ApiError('NOT_FOUND', { code: 'CANVAS_ASSET_SOURCE_NOT_READY' })
  return assertBareStorageKey(key)
}

export async function listCanvasAssets(scope: CanvasAssetScope, type?: CanvasAssetType) {
  const rows = await canvasAssetModel.findMany({
    where: { scopeKey: scope.scopeKey, ...(type ? { type } : {}) },
    include: { primaryMedia: true, firstFrameMedia: true, lastFrameMedia: true },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(assetView)
}

export async function createCanvasAsset(
  input: CanvasAssetCreateInput,
  userId: string,
  scope: CanvasAssetScope,
) {
  const storageKey = await resolvePrimaryKey(input, userId, scope)
  const duplicate = await canvasAssetModel.findFirst({ where: { scopeKey: scope.scopeKey, storageKey }, select: { id: true } })
  if (duplicate) throw new ApiError('CONFLICT', { code: 'CANVAS_ASSET_ALREADY_EXISTS' })

  const [primary, firstFrame, lastFrame] = await Promise.all([
    ensureMediaObjectFromStorageKey(storageKey, undefined, { uploadedByUserId: userId }),
    input.firstFrameKey
      ? assertDirectKeyAllowed(input.firstFrameKey, userId, scope.scopeKey).then((key) => ensureMediaObjectFromStorageKey(key, undefined, { uploadedByUserId: userId }))
      : null,
    input.lastFrameKey
      ? assertDirectKeyAllowed(input.lastFrameKey, userId, scope.scopeKey).then((key) => ensureMediaObjectFromStorageKey(key, undefined, { uploadedByUserId: userId }))
      : null,
  ])
  if (!isAssetMimeCompatible(input.type, primary.mimeType)) {
    throw new ApiError('INVALID_PARAMS', { code: 'CANVAS_ASSET_MEDIA_TYPE_MISMATCH' })
  }
  if ((firstFrame && !firstFrame.mimeType?.startsWith('image/')) || (lastFrame && !lastFrame.mimeType?.startsWith('image/'))) {
    throw new ApiError('INVALID_PARAMS', { code: 'CANVAS_ASSET_FRAME_NOT_IMAGE' })
  }

  try {
    const row = await canvasAssetModel.create({
      data: {
        scopeKey: scope.scopeKey,
        ownerUserId: userId,
        workspaceId: scope.workspaceId,
        sourceCanvasId: input.canvasId,
        storageKey,
        primaryMediaId: primary.id,
        firstFrameMediaId: firstFrame?.id ?? null,
        lastFrameMediaId: lastFrame?.id ?? null,
        type: input.type,
        name: input.name,
        folder: input.folder || null,
        description: input.description || null,
      },
      include: { primaryMedia: true, firstFrameMedia: true, lastFrameMedia: true },
    })
    return assetView(row)
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new ApiError('CONFLICT', { code: 'CANVAS_ASSET_ALREADY_EXISTS' })
    }
    throw error
  }
}

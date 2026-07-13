import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canvasAssetCreateSchema,
  isAssetMimeCompatible,
  readTaskResultStorageKey,
  readTaskWorkspaceId,
} from '@/lib/canvas/canvas-assets-contract'
import { canvasAssetNodeData, canvasAssetNodeType } from '@/app/[locale]/canvas/lib/canvas-asset-drop'

const db = vi.hoisted(() => ({
  canvasFindUnique: vi.fn(),
  workspaceFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  assetFindFirst: vi.fn(),
  assetFindMany: vi.fn(),
  assetCreate: vi.fn(),
  taskFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    canvas: { findUnique: db.canvasFindUnique },
    workspace: { findUnique: db.workspaceFindUnique },
    workspaceMember: { findUnique: db.memberFindUnique },
    canvasAsset: { findFirst: db.assetFindFirst, findMany: db.assetFindMany, create: db.assetCreate },
    task: { findUnique: db.taskFindUnique },
  },
}))

vi.mock('@/lib/media/service', () => ({ ensureMediaObjectFromStorageKey: vi.fn() }))

import { createCanvasAsset, resolveCanvasAssetScope } from '@/lib/canvas/canvas-assets'

const ID = '11111111-1111-4111-8111-111111111111'

describe('canvas asset contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts the complete save-dialog payload and rejects client workspace scope', () => {
    expect(canvasAssetCreateSchema.safeParse({
      canvasId: ID,
      name: '海边远景',
      type: 'scene',
      folder: '外景',
      description: '黄昏版本',
      source: { kind: 'task', taskId: ID },
    }).success).toBe(true)
    expect(canvasAssetCreateSchema.safeParse({
      canvasId: ID,
      workspaceId: ID,
      name: '越权 scope',
      type: 'image',
      source: { kind: 'task', taskId: ID },
    }).success).toBe(false)
  })

  it('extracts only durable task keys and enforces image/video media families', () => {
    expect(readTaskResultStorageKey({ resultUrls: ['images/playground-runs/a/out.jpg'] })).toBe('images/playground-runs/a/out.jpg')
    expect(readTaskResultStorageKey({ resultKey: 'images/playground-runs/a/out.mp4' })).toBe('images/playground-runs/a/out.mp4')
    expect(readTaskResultStorageKey({ resultUrls: [''] })).toBeNull()
    expect(readTaskWorkspaceId({ workspaceId: 'ws-1' })).toBe('ws-1')
    expect(isAssetMimeCompatible('scene', 'image/jpeg')).toBe(true)
    expect(isAssetMimeCompatible('video', 'image/jpeg')).toBe(false)
    expect(isAssetMimeCompatible('video', 'video/mp4')).toBe(true)
  })

  it('keeps personal assets creator-only and derives scope server-side', async () => {
    db.canvasFindUnique.mockResolvedValue({ id: ID, userId: 'owner', workspaceId: null })
    await expect(resolveCanvasAssetScope(ID, 'intruder', { write: false, isAdmin: false }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', details: { code: 'CANVAS_NOT_FOUND' } })
    await expect(resolveCanvasAssetScope(ID, 'owner', { write: true, isAdmin: false }))
      .resolves.toEqual({ scopeKey: 'user:owner', workspaceId: null })
  })

  it('allows workspace viewers to read but rejects writes', async () => {
    db.canvasFindUnique.mockResolvedValue({ id: ID, userId: 'creator', workspaceId: 'ws-1' })
    db.workspaceFindUnique.mockResolvedValue({ ownerEditorId: 'owner' })
    db.memberFindUnique.mockResolvedValue({ role: 'viewer' })
    await expect(resolveCanvasAssetScope(ID, 'viewer', { write: false, isAdmin: false }))
      .resolves.toEqual({ scopeKey: 'workspace:ws-1', workspaceId: 'ws-1' })
    await expect(resolveCanvasAssetScope(ID, 'viewer', { write: true, isAdmin: false }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', details: { code: 'CANVAS_ASSET_WRITE_DENIED' } })
  })

  it('reports duplicate durable keys explicitly instead of copying', async () => {
    db.assetFindFirst.mockResolvedValue({ id: 'existing' })
    await expect(createCanvasAsset({
      canvasId: ID,
      name: '角色 A',
      type: 'character',
      source: { kind: 'storage-key', storageKey: 'images/playground-ref/user-1/a.jpg' },
    }, 'user-1', { scopeKey: 'user:user-1', workspaceId: null }))
      .rejects.toMatchObject({ code: 'CONFLICT', details: { code: 'CANVAS_ASSET_ALREADY_EXISTS' } })
    expect(db.assetCreate).not.toHaveBeenCalled()
  })

  it('keeps the durable key when an image is dragged into a different canvas', () => {
    const asset = {
      id: 'asset-1', type: 'scene' as const, name: '码头', folder: null, description: null,
      storageKey: 'images/playground-runs/task-1/out.jpg', mediaUrl: '/m/public-1', mimeType: 'image/jpeg',
      firstFrameUrl: null, lastFrameUrl: null, createdAt: '2026-07-13T00:00:00.000Z',
    }
    expect(canvasAssetNodeType(asset)).toBe('image')
    expect(canvasAssetNodeData(asset)).toMatchObject({
      resultUrl: '/m/public-1',
      referenceKey: 'images/playground-runs/task-1/out.jpg',
      assetStorageKey: 'images/playground-runs/task-1/out.jpg',
    })
  })
})

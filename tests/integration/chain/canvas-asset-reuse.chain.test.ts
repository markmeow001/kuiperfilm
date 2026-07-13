import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, mockRole, resetAuthMockState } from '../../helpers/auth'
import { canvasAssetNodeData } from '@/app/[locale]/canvas/lib/canvas-asset-drop'
import type { CanvasAssetLibraryItem } from '@/app/[locale]/canvas/lib/canvas-assets-client'

const storedAssets = vi.hoisted(() => [] as Array<{
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
  firstFrameMedia: null
  lastFrameMedia: null
}>)

const prismaMock = vi.hoisted(() => ({
  canvas: { findUnique: vi.fn() },
  workspace: { findUnique: vi.fn(), findFirst: vi.fn() },
  workspaceMember: { findUnique: vi.fn(), findFirst: vi.fn() },
  task: { findUnique: vi.fn() },
  canvasAsset: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
}))
const submitterMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const mediaMock = vi.hoisted(() => ({ ensureMediaObjectFromStorageKey: vi.fn() }))
const apiConfigMock = vi.hoisted(() => ({ resolveModelSelection: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/api-config', () => apiConfigMock)

const CANVAS_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'
const STORAGE_KEY = 'images/playground-runs/task-1/out.jpg'

describe('canvas durable asset reuse chain', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    storedAssets.splice(0)
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    mockRole('editor')
    prismaMock.canvas.findUnique.mockResolvedValue({ id: CANVAS_ID, userId: 'user-1', workspaceId: 'ws-1' })
    prismaMock.workspace.findUnique.mockResolvedValue({ ownerEditorId: 'user-1' })
    prismaMock.workspaceMember.findUnique.mockResolvedValue(null)
    prismaMock.task.findUnique.mockResolvedValue({
      userId: 'user-1', type: 'playground_image', status: 'completed', payload: { meta: { workspaceId: 'ws-1' } },
      result: { resultUrls: [STORAGE_KEY] },
    })
    prismaMock.canvasAsset.findFirst.mockResolvedValue(null)
    prismaMock.canvasAsset.findMany.mockImplementation(async (args: { where?: { storageKey?: string } }) => (
      storedAssets.filter((asset) => !args.where?.storageKey || asset.storageKey === args.where.storageKey)
    ))
    prismaMock.canvasAsset.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      const row = {
        id: 'asset-1',
        scopeKey: String(args.data.scopeKey),
        ownerUserId: String(args.data.ownerUserId),
        workspaceId: typeof args.data.workspaceId === 'string' ? args.data.workspaceId : null,
        sourceCanvasId: CANVAS_ID,
        storageKey: String(args.data.storageKey),
        primaryMediaId: 'media-1',
        firstFrameMediaId: null,
        lastFrameMediaId: null,
        type: String(args.data.type),
        name: String(args.data.name),
        folder: null,
        description: null,
        createdAt: new Date('2026-07-13T00:00:00.000Z'),
        primaryMedia: { publicId: 'public-1', mimeType: 'image/jpeg' },
        firstFrameMedia: null,
        lastFrameMedia: null,
      }
      storedAssets.push(row)
      return row
    })
    mediaMock.ensureMediaObjectFromStorageKey.mockResolvedValue({
      id: 'media-1', publicId: 'public-1', storageKey: STORAGE_KEY, mimeType: 'image/jpeg',
    })
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud', modelId: 'nano-banana-pro', modelKey: 'atlascloud::nano-banana-pro', mediaType: 'image',
    })
    submitterMock.submitTask.mockResolvedValue({ taskId: 'new-task', runId: 'new-run', status: 'queued' })
  })

  it('save generated asset -> drag into canvas -> playground run passes reference guard', async () => {
    const assetsRoute = await import('@/app/api/canvas/assets/route')
    const saveResponse = await assetsRoute.POST(buildMockRequest({
      path: '/api/canvas/assets',
      method: 'POST',
      body: {
        canvasId: CANVAS_ID,
        name: '可复用场景',
        type: 'scene',
        source: { kind: 'task', taskId: TASK_ID },
      },
    }), { params: Promise.resolve({}) })
    expect(saveResponse.status).toBe(200)
    const saved = (await saveResponse.json()).asset as CanvasAssetLibraryItem
    expect(saved.storageKey).toBe(STORAGE_KEY)

    const draggedNode = canvasAssetNodeData(saved)
    expect(draggedNode.referenceKey).toBe(STORAGE_KEY)

    mockAuthenticated('user-2')
    prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws-1' })
    const runRoute = await import('@/app/api/playground/run/route')
    const runResponse = await runRoute.POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: '以该场景继续生成',
        outputType: 'image',
        modelKey: 'atlascloud::nano-banana-pro',
        referenceImages: [draggedNode.referenceKey],
      },
    }), { params: Promise.resolve({}) })

    expect(runResponse.status).toBe(200)
    const submitted = submitterMock.submitTask.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitted?.payload?.referenceImages).toEqual([STORAGE_KEY])
    expect(prismaMock.canvasAsset.findMany).toHaveBeenCalledWith({
      where: { storageKey: STORAGE_KEY },
      select: { ownerUserId: true, workspaceId: true },
    })
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledWith({
      where: {
        id: { in: ['ws-1'] },
        OR: [{ ownerEditorId: 'user-2' }, { members: { some: { userId: 'user-2' } } }],
      },
      select: { id: true },
    })
  })

  it('unregistered generated key -> playground run keeps returning 403', async () => {
    mockAuthenticated('user-2')
    const runRoute = await import('@/app/api/playground/run/route')
    const runResponse = await runRoute.POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: 'attempt foreign reference',
        outputType: 'image',
        modelKey: 'atlascloud::nano-banana-pro',
        referenceImages: ['images/playground-runs/foreign/out.jpg'],
      },
    }), { params: Promise.resolve({}) })

    expect(runResponse.status).toBe(403)
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})

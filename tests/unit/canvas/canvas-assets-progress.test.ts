import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'

const taskState = vi.hoisted(() => ({
  status: 'processing',
  payload: {} as Record<string, unknown>,
  result: null as Record<string, unknown> | null,
}))

const db = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdateMany: vi.fn(),
  assetFindFirst: vi.fn(),
  assetFindMany: vi.fn(),
  assetCreate: vi.fn(),
}))

const mediaMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: db.taskFindUnique, updateMany: db.taskUpdateMany },
    canvasAsset: { findFirst: db.assetFindFirst, findMany: db.assetFindMany, create: db.assetCreate },
  },
}))
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: vi.fn(), publishTaskStreamEvent: vi.fn() }))
vi.mock('@/lib/task/queues', () => ({ rateLimitAwareBackoff: vi.fn(() => 1_000) }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logInfo: vi.fn(),
  logError: vi.fn(),
}))

import { createCanvasAsset } from '@/lib/canvas/canvas-assets'
import { reportTaskProgress } from '@/lib/workers/shared'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const CANVAS_ID = '22222222-2222-4222-8222-222222222222'
const STORAGE_KEY = 'images/playground-runs/task-1/out.jpg'

describe('canvas asset scope after worker progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskState.status = 'processing'
    taskState.payload = {
      prompt: 'workspace image',
      meta: { workspaceId: 'ws-1', originPrompt: 'workspace image' },
    }
    taskState.result = null
    db.taskFindUnique.mockImplementation(async () => ({
      id: TASK_ID,
      userId: 'creator',
      type: 'playground_image',
      status: taskState.status,
      payload: taskState.payload,
      result: taskState.result,
    }))
    db.taskUpdateMany.mockImplementation(async (args: { data: { payload?: Record<string, unknown> } }) => {
      if (args.data.payload) taskState.payload = args.data.payload
      return { count: 1 }
    })
    db.assetFindFirst.mockResolvedValue(null)
    mediaMock.ensureMediaObjectFromStorageKey.mockResolvedValue({
      id: 'media-1', publicId: 'public-1', storageKey: STORAGE_KEY, mimeType: 'image/jpeg',
    })
    db.assetCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...args.data,
      id: 'asset-1',
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
      primaryMedia: { publicId: 'public-1', mimeType: 'image/jpeg' },
      firstFrameMedia: null,
      lastFrameMedia: null,
    }))
  })

  it('workspace task reports progress at least once -> asset save still resolves workspace scope', async () => {
    const job = {
      queueName: 'image',
      data: {
        taskId: TASK_ID,
        userId: 'creator',
        projectId: 'playground',
        type: 'playground_image',
        targetType: 'playground',
        targetId: 'target-1',
        locale: 'zh',
        payload: taskState.payload,
      },
    } as unknown as Job<TaskJobData>

    await reportTaskProgress(job, 50, { stage: 'polling_provider' })
    expect(taskState.payload).toMatchObject({
      stage: 'polling_provider',
      meta: { workspaceId: 'ws-1', originPrompt: 'workspace image', locale: 'zh' },
    })

    taskState.status = 'completed'
    taskState.result = { resultUrls: [STORAGE_KEY] }
    const asset = await createCanvasAsset({
      canvasId: CANVAS_ID,
      name: '共享场景',
      type: 'scene',
      source: { kind: 'task', taskId: TASK_ID },
    }, 'creator', { scopeKey: 'workspace:ws-1', workspaceId: 'ws-1' })

    expect(asset.storageKey).toBe(STORAGE_KEY)
    expect(db.assetCreate.mock.calls.at(-1)?.[0]).toMatchObject({
      data: { scopeKey: 'workspace:ws-1', workspaceId: 'ws-1', storageKey: STORAGE_KEY },
    })
  })
})

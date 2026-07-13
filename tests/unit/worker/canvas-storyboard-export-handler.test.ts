import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({ task: { findMany: vi.fn() } }))
const renderMock = vi.hoisted(() => vi.fn())
const releaseMock = vi.hoisted(() => vi.fn())
const lockMock = vi.hoisted(() => vi.fn())
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async (_job: unknown, _stage: string) => undefined))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({ getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`) }))
vi.mock('@/lib/canvas/heavy-render-lock', () => ({ acquireCanvasHeavyRenderLock: lockMock }))
vi.mock('@/lib/canvas/remotion-storyboard-executor', () => ({ renderCanvasStoryboard: renderMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn() }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: assertTaskActiveMock }))

import { handleCanvasStoryboardExportTask } from '@/lib/workers/handlers/canvas-storyboard-export'

const job = { id: 'job-1', data: { taskId: 'export-1', userId: 'user-1', payload: { taskIds: ['img-1', 'img-2'], titles: ['镜一', '镜二'], columns: 4, showShotNumber: true } } } as never

beforeEach(() => {
  vi.clearAllMocks(); lockMock.mockResolvedValue(releaseMock)
  prismaMock.task.findMany.mockResolvedValue([
    { id: 'img-1', type: 'playground_image', status: 'completed', result: { resultUrls: ['images/playground-runs/a.jpg'] } },
    { id: 'img-2', type: 'playground_image', status: 'completed', result: { resultUrls: ['images/playground-runs/b.jpg'] } },
  ])
  renderMock.mockResolvedValue({ resultKey: 'images/canvas/storyboard/out.jpg', peakRssBytes: 700_000_000, outputBytes: 180_000 })
})

describe('canvas storyboard export worker', () => {
  it('ordered owned images -> shared heavy lock + Remotion executor', async () => {
    const result = await handleCanvasStoryboardExportTask(job)
    expect(lockMock).toHaveBeenCalledWith('storyboard:job-1')
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ items: [{ title: '镜一', imageUrl: 'https://signed.example/images/playground-runs/a.jpg' }, { title: '镜二', imageUrl: 'https://signed.example/images/playground-runs/b.jpg' }], columns: 4 }))
    expect(result).toMatchObject({ resultKey: 'images/canvas/storyboard/out.jpg', peakRssBytes: 700_000_000 })
    expect(assertTaskActiveMock.mock.calls.map((call) => call[1])).toEqual(['canvas_storyboard_export_prepare', 'canvas_storyboard_export_persist'])
    expect(releaseMock).toHaveBeenCalled()
  })

  it('middle image missing -> fails whole export before render', async () => {
    prismaMock.task.findMany.mockResolvedValue([{ id: 'img-1', type: 'playground_image', status: 'completed', result: { resultUrls: ['images/playground-runs/a.jpg'] } }])
    await expect(handleCanvasStoryboardExportTask(job)).rejects.toThrow('STORYBOARD_SOURCE_NOT_READY:img-2')
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('more than 25 items -> explicit failure', async () => {
    const ids = Array.from({ length: 26 }, (_, index) => `id-${index}`)
    const tooMany = { id: 'job-1', data: { taskId: 'export-1', userId: 'user-1', payload: { taskIds: ids, titles: ids } } } as never
    await expect(handleCanvasStoryboardExportTask(tooMany)).rejects.toThrow('STORYBOARD_EXPORT_INPUT_INVALID')
  })

  it('video task using images namespace -> rejects before spending render budget', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      { id: 'img-1', type: 'playground_video', status: 'completed', result: { resultUrls: ['images/playground-runs/not-an-image.mp4'] } },
      { id: 'img-2', type: 'playground_image', status: 'completed', result: { resultUrls: ['images/playground-runs/b.jpg'] } },
    ])
    await expect(handleCanvasStoryboardExportTask(job)).rejects.toThrow('STORYBOARD_SOURCE_NOT_READY:img-1')
    expect(lockMock).not.toHaveBeenCalled()
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('image task outside playground-runs namespace -> rejects durable key', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      { id: 'img-1', type: 'playground_image', status: 'completed', result: { resultUrls: ['images/video/playground-ref/a.jpg'] } },
      { id: 'img-2', type: 'playground_image', status: 'completed', result: { resultUrls: ['images/playground-runs/b.jpg'] } },
    ])
    await expect(handleCanvasStoryboardExportTask(job)).rejects.toThrow('STORYBOARD_SOURCE_NOT_READY:img-1')
    expect(renderMock).not.toHaveBeenCalled()
  })
})

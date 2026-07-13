import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({ task: { findMany: vi.fn() } }))
const redisMock = vi.hoisted(() => ({ set: vi.fn(), eval: vi.fn() }))
const executorMock = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ queueRedis: redisMock }))
vi.mock('@/lib/canvas/ffmpeg-compose-executor', () => ({ canvasComposeExecutor: executorMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn() }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: vi.fn() }))

import { handleCanvasComposeVideoTask } from '@/lib/workers/handlers/canvas-compose-video'

const job = (taskIds = ['source-1', 'source-2']) => ({ id: 'job-1', data: { taskId: 'compose-1', userId: 'user-1', payload: { taskIds, transition: 'cut', crossfadeSec: 0.5 } } }) as never

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.set.mockResolvedValue('OK')
  redisMock.eval.mockResolvedValue(1)
  prismaMock.task.findMany.mockResolvedValue([
    { id: 'source-1', status: 'completed', result: { resultUrls: ['video/playground-ref/user-1/a.mp4'] } },
    { id: 'source-2', status: 'completed', result: { resultUrls: ['video/playground-ref/user-1/b.mp4'] } },
  ])
  executorMock.execute.mockResolvedValue({ resultKey: 'video/playground-ref/user-1/composition-out.mp4', durationSec: 12 })
})

describe('canvas compose worker', () => {
  it('ordered owned sources -> invokes replaceable executor and returns durable result', async () => {
    const result = await handleCanvasComposeVideoTask(job())
    expect(executorMock.execute).toHaveBeenCalledWith(expect.objectContaining({ sourceKeys: ['video/playground-ref/user-1/a.mp4', 'video/playground-ref/user-1/b.mp4'], transition: 'cut' }))
    expect(result).toEqual({ success: true, resultUrls: ['video/playground-ref/user-1/composition-out.mp4'], resultKey: 'video/playground-ref/user-1/composition-out.mp4', durationSec: 12 })
    expect(redisMock.eval).toHaveBeenCalled()
  })

  it('foreign source key -> explicit failure before executor', async () => {
    prismaMock.task.findMany.mockResolvedValue([{ id: 'source-1', status: 'completed', result: { resultUrls: ['video/playground-ref/other/a.mp4'] } }])
    await expect(handleCanvasComposeVideoTask(job(['source-1']))).rejects.toThrow('CANVAS_COMPOSE_SOURCE_NOT_OWNED')
    expect(executorMock.execute).not.toHaveBeenCalled()
  })

  it('global lock occupied -> retryable rate-limit failure, no second compose execution', async () => {
    redisMock.set.mockResolvedValue(null)
    await expect(handleCanvasComposeVideoTask(job())).rejects.toMatchObject({ message: 'CANVAS_COMPOSE_BUSY', code: 'RATE_LIMIT' })
    expect(executorMock.execute).not.toHaveBeenCalled()
  })

  it('middle source missing -> whole task fails instead of silently skipping clip', async () => {
    prismaMock.task.findMany.mockResolvedValue([{ id: 'source-1', status: 'completed', result: { resultUrls: ['video/playground-ref/user-1/a.mp4'] } }])
    await expect(handleCanvasComposeVideoTask(job())).rejects.toThrow('CANVAS_COMPOSE_SOURCE_NOT_READY:source-2')
    expect(executorMock.execute).not.toHaveBeenCalled()
  })

  it('voice and music tasks -> validates owned audio keys and passes mix controls', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      { id: 'source-1', status: 'completed', result: { resultUrls: ['video/playground-ref/user-1/a.mp4'] } },
      { id: 'voice-1', status: 'completed', result: { audioKey: 'voice/playground-ref/user-1/voice.wav' } },
      { id: 'music-1', status: 'completed', result: { audioKey: 'voice/playground-ref/user-1/music.wav' } },
    ])
    const mixedJob = { id: 'job-1', data: { taskId: 'compose-1', userId: 'user-1', payload: { taskIds: ['source-1'], voiceTaskId: 'voice-1', musicTaskId: 'music-1', voiceVolume: 1.1, musicVolume: 0.2, preserveOriginalAudio: false } } } as never
    await handleCanvasComposeVideoTask(mixedJob)
    expect(executorMock.execute).toHaveBeenCalledWith(expect.objectContaining({ voiceKey: 'voice/playground-ref/user-1/voice.wav', musicKey: 'voice/playground-ref/user-1/music.wav', voiceVolume: 1.1, musicVolume: 0.2, preserveOriginalAudio: false }))
  })
})

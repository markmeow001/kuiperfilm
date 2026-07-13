import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()
const submitMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const prismaMock = vi.hoisted(() => ({ task: { findFirst: vi.fn() } }))
vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({ getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`) }))

type RouteModule = typeof import('@/app/api/canvas/compose/route')
let route: RouteModule
beforeAll(async () => { route = await import('@/app/api/canvas/compose/route') })

describe('/api/canvas/compose', () => {
  beforeEach(() => {
    vi.clearAllMocks(); resetAuthMockState(); mockAuthenticated('user-1')
    submitMock.submitTask.mockResolvedValue({ taskId: 'compose-task', status: 'queued' })
  })

  it('POST valid clips -> submits free canvas composition task', async () => {
    const request = new NextRequest('http://localhost/api/canvas/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskIds: [crypto.randomUUID(), crypto.randomUUID()], transition: 'cut' }) })
    const response = await route.POST(request, {} as never)
    expect(response.status).toBe(200)
    expect(submitMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: 'canvas_compose_video', billingInfo: { billable: false, source: 'task', status: 'skipped' }, payload: expect.objectContaining({ transition: 'cut' }) }))
  })

  it('POST 11 clips -> 400 and no task submission', async () => {
    const request = new NextRequest('http://localhost/api/canvas/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskIds: Array.from({ length: 11 }, () => crypto.randomUUID()) }) })
    const response = await route.POST(request, {} as never)
    expect(response.status).toBe(400)
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('GET owned completed result -> signs durable result key', async () => {
    prismaMock.task.findFirst.mockResolvedValue({ status: 'completed', result: { resultKey: 'video/playground-ref/user-1/out.mp4', durationSec: 9 }, errorMessage: null })
    const response = await route.GET(new NextRequest('http://localhost/api/canvas/compose?taskId=compose-task'), {} as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'completed', resultKey: 'video/playground-ref/user-1/out.mp4', resultUrl: 'https://signed.example/video/playground-ref/user-1/out.mp4', durationSec: 9 })
    expect(prismaMock.task.findFirst).toHaveBeenCalledWith({ where: { id: 'compose-task', userId: 'user-1', type: 'canvas_compose_video' } })
  })
})

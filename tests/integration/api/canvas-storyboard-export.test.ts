import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()
const submitMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const prismaMock = vi.hoisted(() => ({ task: { findFirst: vi.fn() } }))
vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({ getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`) }))

type RouteModule = typeof import('@/app/api/canvas/storyboard-export/route')
let route: RouteModule
beforeAll(async () => { route = await import('@/app/api/canvas/storyboard-export/route') })

describe('/api/canvas/storyboard-export', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAuthMockState(); mockAuthenticated('user-1'); submitMock.submitTask.mockResolvedValue({ taskId: 'export-task', status: 'queued' }) })

  it('POST valid storyboard -> submits free worker task', async () => {
    const request = new NextRequest('http://localhost/api/canvas/storyboard-export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskIds: [crypto.randomUUID()], titles: ['镜一'], columns: 4 }) })
    const response = await route.POST(request, {} as never)
    expect(response.status).toBe(200)
    expect(submitMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: 'canvas_storyboard_export', billingInfo: { billable: false, source: 'task', status: 'skipped' } }))
  })

  it('POST mismatched task/title count -> 400', async () => {
    const request = new NextRequest('http://localhost/api/canvas/storyboard-export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskIds: [crypto.randomUUID()], titles: [] }) })
    const response = await route.POST(request, {} as never)
    expect(response.status).toBe(400); expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('GET owned result -> signs durable storyboard key', async () => {
    prismaMock.task.findFirst.mockResolvedValue({ status: 'completed', result: { resultKey: 'images/canvas/storyboard/out.jpg' }, errorMessage: null })
    const response = await route.GET(new NextRequest('http://localhost/api/canvas/storyboard-export?taskId=export-task'), {} as never)
    expect(await response.json()).toMatchObject({ status: 'completed', resultKey: 'images/canvas/storyboard/out.jpg', resultUrl: 'https://signed.example/images/canvas/storyboard/out.jpg' })
  })
})

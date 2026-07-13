import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()

const repositoryMock = vi.hoisted(() => ({
  getLatestCanvasForUser: vi.fn(),
  listCanvasResourcesForUser: vi.fn(),
  upsertCanvasForUser: vi.fn(),
  deleteCanvasResourceForUser: vi.fn(),
}))
vi.mock('@/lib/canvas/canvas-repository', () => repositoryMock)

type RouteModule = typeof import('@/app/api/canvas/route')
let route: RouteModule
beforeAll(async () => { route = await import('@/app/api/canvas/route') })

const graph = {
  nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, data: { title: '脚本' } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

function record(over: Record<string, unknown> = {}) {
  return { id: 'c1', title: '画布一', kind: 'canvas', ...graph, updatedAt: '2026-07-12T00:00:00.000Z', ...over }
}

describe('/api/canvas persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMockState()
    mockAuthenticated('user-1')
  })

  it('GET -> returns latest normal canvas and complete resource list', async () => {
    repositoryMock.getLatestCanvasForUser.mockResolvedValue(record())
    repositoryMock.listCanvasResourcesForUser.mockResolvedValue([record(), record({ id: 'w1', kind: 'workflow' })])
    const response = await route.GET(new NextRequest('http://localhost/api/canvas'), {} as never)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.canvas.id).toBe('c1')
    expect(body.resources.map((item: { id: string; kind: string }) => [item.id, item.kind])).toEqual([['c1', 'canvas'], ['w1', 'workflow']])
    expect(repositoryMock.getLatestCanvasForUser).toHaveBeenCalledWith('user-1')
  })

  it('POST workflow -> preserves workflow kind and graph payload', async () => {
    repositoryMock.upsertCanvasForUser.mockResolvedValue(record({ id: 'w1', kind: 'workflow', title: '我的流程' }))
    const request = new NextRequest('http://localhost/api/canvas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...graph, title: '我的流程', kind: 'workflow' }) })
    const response = await route.POST(request, {} as never)
    expect(response.status).toBe(200)
    expect(repositoryMock.upsertCanvasForUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ kind: 'workflow', title: '我的流程', nodes: graph.nodes }))
  })

  it('DELETE owned resource -> passes authenticated owner and exact id', async () => {
    const response = await route.DELETE(new NextRequest('http://localhost/api/canvas?id=w1', { method: 'DELETE' }), {} as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ deletedId: 'w1' }))
    expect(repositoryMock.deleteCanvasResourceForUser).toHaveBeenCalledWith('user-1', 'w1')
  })

  it('DELETE foreign resource -> returns 404 without creating a replacement', async () => {
    repositoryMock.deleteCanvasResourceForUser.mockRejectedValue(new Error('CANVAS_NOT_FOUND'))
    const response = await route.DELETE(new NextRequest('http://localhost/api/canvas?id=foreign', { method: 'DELETE' }), {} as never)
    expect(response.status).toBe(404)
    expect(JSON.stringify(await response.json())).toContain('CANVAS_NOT_FOUND')
    expect(repositoryMock.upsertCanvasForUser).not.toHaveBeenCalled()
  })
})

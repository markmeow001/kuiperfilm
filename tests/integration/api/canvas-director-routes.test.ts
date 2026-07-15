import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()

const submitMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const configMock = vi.hoisted(() => ({ getProjectModelConfig: vi.fn() }))

vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/config-service', () => configMock)

type RouteModule = typeof import('@/app/api/canvas/director-routes/route')
let route: RouteModule

beforeAll(async () => { route = await import('@/app/api/canvas/director-routes/route') })

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/canvas/director-routes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/canvas/director-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMockState()
    mockAuthenticated('user-1')
    configMock.getProjectModelConfig.mockResolvedValue({ analysisModel: 'gpt-analysis' })
    submitMock.submitTask.mockResolvedValue({ taskId: 'route-task', status: 'queued' })
  })

  it('完整分镜 5000 字 -> 以 storyboard 模式和扩大后的 token 预算提交', async () => {
    const description = '镜'.repeat(5000)
    const response = await route.POST(request({ description, mode: 'storyboard', cast: ['角色A'], props: ['车'] }), {} as never)
    expect(response.status).toBe(200)
    expect(submitMock.submitTask.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'canvas_director_routes',
      payload: {
        description,
        mode: 'storyboard',
        cast: ['角色A'],
        props: ['车'],
        maxInputTokens: 12000,
        maxOutputTokens: 12000,
      },
    })
  })

  it('完整分镜超过 5000 字 -> 400 且不建立任务', async () => {
    const response = await route.POST(request({ description: '镜'.repeat(5001), mode: 'storyboard' }), {} as never)
    expect(response.status).toBe(400)
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('短描述超过 500 字 -> 仍维持 500 字边界', async () => {
    const response = await route.POST(request({ description: '镜'.repeat(501), mode: 'brief' }), {} as never)
    expect(response.status).toBe(400)
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('缺少输入模式 -> 400 且显式拒绝', async () => {
    const response = await route.POST(request({ description: '两人对峙' }), {} as never)
    expect(response.status).toBe(400)
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })
})

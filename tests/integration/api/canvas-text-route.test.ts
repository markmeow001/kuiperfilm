import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()

const submitMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const configMock = vi.hoisted(() => ({ getProjectModelConfig: vi.fn() }))
const prismaMock = vi.hoisted(() => ({
  task: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/canvas-text', () => ({
  R2V_CANVAS_TEXT_MAX_CHARS: 500,
  isCanvasTextMode: (mode: unknown) => typeof mode === 'string' && [
    'expand',
    'rewrite',
    'polish',
    'continue',
    'compress',
    'assistant',
    'r2v_character',
    'r2v_scene_motion',
  ].includes(mode),
  isR2VCanvasTextMode: (mode: unknown) => (
    mode === 'r2v_character' || mode === 'r2v_scene_motion'
  ),
  getR2VCanvasTextPolicy: (mode: string) => ({
    maxOutputTokens: mode === 'r2v_character' ? 800 : 1000,
    systemPrompt: 'test-only',
  }),
}))

type RouteModule = typeof import('@/app/api/canvas/text/route')
let route: RouteModule

beforeAll(async () => {
  route = await import('@/app/api/canvas/text/route')
})

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/canvas/text', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/canvas/text R2V completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMockState()
    mockAuthenticated('user-1')
    configMock.getProjectModelConfig.mockResolvedValue({ analysisModel: 'gpt-analysis' })
    prismaMock.task.findFirst.mockResolvedValue(null)
    submitMock.submitTask.mockResolvedValue({
      taskId: 'text-task',
      status: 'queued',
      deduped: false,
    })
  })

  it.each([
    ['r2v_character', 800],
    ['r2v_scene_motion', 1000],
  ] as const)('%s pins the billing/runtime token budget and one queue attempt', async (
    mode,
    maxOutputTokens,
  ) => {
    const response = await route.POST(request({
      text: '一位 1930 年代的記者',
      mode,
      locale: 'zh',
      requestKey: `request-${mode}`,
    }), {} as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      taskId: 'text-task',
      requestKey: `request-${mode}`,
      deduped: false,
    })
    const submission = submitMock.submitTask.mock.calls.at(-1)?.[0]
    const expectedInputTokens = Math.min(
      2000,
      '一位 1930 年代的記者'.length * 2 + 800,
    )
    expect(submission).toMatchObject({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'playground',
      type: 'canvas_text',
      maxAttempts: 1,
      dedupeMode: 'idempotent',
      payload: {
        text: '一位 1930 年代的記者',
        mode,
        requestKey: `request-${mode}`,
        analysisModel: 'gpt-analysis',
        model: 'gpt-analysis',
        maxInputTokens: expectedInputTokens,
        maxOutputTokens,
      },
    })
    expect(submission.dedupeKey).toMatch(/^canvas-text-r2v:[a-f0-9]{64}$/)
  })

  it('accepts exactly 500 characters for R2V and rejects 501', async () => {
    const accepted = await route.POST(request({
      text: '角'.repeat(500),
      mode: 'r2v_character',
      locale: 'zh',
    }), {} as never)
    expect(accepted.status).toBe(200)
    expect(submitMock.submitTask).toHaveBeenCalledOnce()

    submitMock.submitTask.mockClear()
    const rejected = await route.POST(request({
      text: '角'.repeat(501),
      mode: 'r2v_character',
      locale: 'zh',
    }), {} as never)
    expect(rejected.status).toBe(400)
    const json = await rejected.json()
    expect(json.error.details).toMatchObject({
      code: 'TEXT_TOO_LONG',
      details: { max: 500, got: 501 },
    })
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('keeps the legacy 20,000-character limit and 3,000-token quote', async () => {
    const text = '原'.repeat(501)
    const response = await route.POST(request({ text, mode: 'polish', locale: 'zh' }), {} as never)

    expect(response.status).toBe(200)
    expect(submitMock.submitTask.mock.calls.at(-1)?.[0]).toMatchObject({
      payload: { text, maxOutputTokens: 3000 },
    })
    expect(submitMock.submitTask.mock.calls.at(-1)?.[0]).not.toHaveProperty('maxAttempts')
    expect(submitMock.submitTask.mock.calls.at(-1)?.[0]).not.toHaveProperty('dedupeKey')
  })

  it('accepts only zh or en locale values', async () => {
    for (const locale of ['zh-TW', 'ja', '', 123]) {
      const response = await route.POST(request({
        text: '角色',
        mode: 'r2v_character',
        locale,
      }), {} as never)
      expect(response.status, String(locale)).toBe(400)
      expect((await response.json()).error.details.code).toBe('INVALID_LOCALE')
    }
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('derives a stable requestKey and DB dedupeKey when the client omits one', async () => {
    const body = {
      text: '雨夜上海街道',
      mode: 'r2v_scene_motion',
      locale: 'zh',
    }
    const first = await route.POST(request(body), {} as never)
    const firstJson = await first.json()
    const firstSubmission = submitMock.submitTask.mock.calls[0]?.[0]

    const second = await route.POST(request(body), {} as never)
    const secondJson = await second.json()
    const secondSubmission = submitMock.submitTask.mock.calls[1]?.[0]

    expect(firstJson.requestKey).toMatch(/^auto-[a-f0-9]{64}$/)
    expect(secondJson.requestKey).toBe(firstJson.requestKey)
    expect(secondSubmission.dedupeKey).toBe(firstSubmission.dedupeKey)
    expect(secondSubmission.payload.requestKey).toBe(firstSubmission.payload.requestKey)
  })

  it('相同 requestKey 的任務已完成但 POST 回應遺失 -> 回傳原任務且不建立第二筆付費任務', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'terminal-task-1' })

    const response = await route.POST(request({
      text: '雨夜上海街道',
      mode: 'r2v_scene_motion',
      locale: 'zh',
      requestKey: 'lost-response-request',
    }), {} as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      taskId: 'terminal-task-1',
      requestKey: 'lost-response-request',
      deduped: true,
    })
    expect(prismaMock.task.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        dedupeKey: expect.stringMatching(/^canvas-text-r2v:[a-f0-9]{64}$/),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('includes mode, locale, and text in the dedupe hash even when requestKey is reused', async () => {
    const common = { requestKey: 'shared-key' }
    await route.POST(request({
      ...common,
      text: '角色設定',
      mode: 'r2v_character',
      locale: 'zh',
    }), {} as never)
    await route.POST(request({
      ...common,
      text: '角色設定',
      mode: 'r2v_scene_motion',
      locale: 'zh',
    }), {} as never)
    await route.POST(request({
      ...common,
      text: 'different brief',
      mode: 'r2v_character',
      locale: 'en',
    }), {} as never)

    const dedupeKeys = submitMock.submitTask.mock.calls.map(([submission]) => submission.dedupeKey)
    expect(new Set(dedupeKeys).size).toBe(3)
  })

  it('rejects malformed explicit request keys before task submission', async () => {
    for (const requestKey of ['', 'x'.repeat(161), { nope: true }]) {
      const response = await route.POST(request({
        text: '角色',
        mode: 'r2v_character',
        locale: 'en',
        requestKey,
      }), {} as never)
      expect(response.status).toBe(400)
      expect((await response.json()).error.details.code).toBe('INVALID_REQUEST_KEY')
    }
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })
})

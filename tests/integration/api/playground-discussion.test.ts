import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const executeAiTextStepMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: executeAiTextStepMock }))

describe('POST /api/playground/discussion', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('writer-1')
    executeAiTextStepMock.mockResolvedValue({
      text: '第二幕的目標需要更明確。',
      reasoning: '',
      usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
    })
  })

  async function post(body: unknown) {
    const { POST } = await import('@/app/api/playground/discussion/route')
    return await POST(buildMockRequest({
      path: '/api/playground/discussion',
      method: 'POST',
      body,
    }), { params: Promise.resolve({}) })
  }

  it('sends a multi-turn screenplay discussion to the selected OpenRouter model', async () => {
    const res = await post({
      modelKey: 'openrouter::sao10k/l3.3-euryale-70b',
      messages: [
        { role: 'user', content: '主角在第二幕失去目標。' },
        { role: 'assistant', content: '可以加入限時任務。' },
        { role: 'user', content: '還有別的做法嗎？' },
      ],
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      modelKey: 'openrouter::sao10k/l3.3-euryale-70b',
      message: { role: 'assistant', content: '第二幕的目標需要更明確。' },
    })
    expect(executeAiTextStepMock).toHaveBeenCalledOnce()
    const request = executeAiTextStepMock.mock.calls[0]?.[0]
    expect(request.userId).toBe('writer-1')
    expect(request.model).toBe('openrouter::sao10k/l3.3-euryale-70b')
    expect(request.action).toBe('playground_script_discussion')
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: '還有別的做法嗎？' })
  })

  it('rejects arbitrary model keys before reading provider credentials', async () => {
    const res = await post({
      modelKey: 'openrouter::openai/gpt-4o',
      messages: [{ role: 'user', content: '分析這一場戲' }],
    })

    expect(res.status).toBe(403)
    expect(executeAiTextStepMock).not.toHaveBeenCalled()
  })

  it('rejects a conversation that does not end with a user turn', async () => {
    const res = await post({
      modelKey: 'openrouter::cognitivecomputations/dolphin-mistral-24b-venice-edition',
      messages: [{ role: 'assistant', content: '上一個回答' }],
    })

    expect(res.status).toBe(400)
    expect(executeAiTextStepMock).not.toHaveBeenCalled()
  })
})

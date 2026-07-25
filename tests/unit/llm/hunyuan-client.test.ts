import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}))

vi.mock('tencentcloud-sdk-nodejs-common', () => ({
  CommonClient: class {
    request = mocks.request
  },
}))

import { hunyuanChatCompletion } from '@/lib/llm/hunyuan-client'

describe('hunyuanChatCompletion output-token limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockResolvedValue({
      Response: {
        Id: 'hunyuan-1',
        Choices: [{
          Index: 0,
          FinishReason: 'stop',
          Message: { Role: 'assistant', Content: 'ok' },
        }],
        Usage: { PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2 },
      },
    })
  })

  it('sends a positive integer MaxTokens value to Tencent', async () => {
    await hunyuanChatCompletion({
      apiKey: JSON.stringify({ secretId: 'id', secretKey: 'secret' }),
      modelId: 'hunyuan-lite',
      messages: [{ role: 'user', content: 'brief' }],
      options: { maxTokens: 800.9 },
    })

    expect(mocks.request).toHaveBeenCalledWith(
      'ChatCompletions',
      expect.objectContaining({
        MaxTokens: 800,
        Stream: false,
      }),
    )
  })

  it('omits MaxTokens for invalid values', async () => {
    await hunyuanChatCompletion({
      apiKey: JSON.stringify({ secretId: 'id', secretKey: 'secret' }),
      modelId: 'hunyuan-lite',
      messages: [{ role: 'user', content: 'brief' }],
      options: { maxTokens: -1 },
    })

    expect(mocks.request.mock.calls[0]?.[1]).not.toHaveProperty('MaxTokens')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openAiCreate: vi.fn(),
  getProviderConfig: vi.fn(),
  getProviderKey: vi.fn((provider: string) => provider),
  resolveLlmRuntimeModel: vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(),
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.openAiCreate } }
  },
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: mocks.getProviderConfig,
  getProviderKey: mocks.getProviderKey,
}))
vi.mock('@/lib/llm/runtime-shared', () => ({
  completionUsageSummary: vi.fn(() => ({
    promptTokens: 0,
    completionTokens: 0,
  })),
  llmLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logLlmRawInput: vi.fn(),
  logLlmRawOutput: vi.fn(),
  recordCompletionUsage: vi.fn(),
  resolveLlmRuntimeModel: mocks.resolveLlmRuntimeModel,
}))
vi.mock('@/lib/llm/reasoning-capability', () => ({
  shouldUseOpenAIReasoningProviderOptions: vi.fn(() => false),
}))

import { chatCompletionStream } from '@/lib/llm/chat-stream'

function successfulStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{
          delta: { content: 'ok' },
        }],
      }
    },
  }
}

function failedStream() {
  return {
    async *[Symbol.asyncIterator]() {
      throw new Error('Network connection lost')
    },
  }
}

function completion() {
  return {
    id: 'completion-1',
    object: 'chat.completion',
    created: 1,
    model: 'openrouter-model',
    choices: [{
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: 'fallback', refusal: null },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

describe('chatCompletionStream maxOutputTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OPENROUTER_MAX_OUTPUT_TOKENS
    mocks.resolveLlmRuntimeModel.mockResolvedValue({
      provider: 'openrouter',
      modelId: 'openrouter-model',
      modelKey: 'openrouter::openrouter-model',
    })
    mocks.getProviderConfig.mockResolvedValue({
      apiKey: 'key',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiMode: 'openai',
    })
  })

  afterEach(() => {
    delete process.env.OPENROUTER_MAX_OUTPUT_TOKENS
  })

  it('uses the requested output cap for the stream request', async () => {
    mocks.openAiCreate.mockResolvedValueOnce(successfulStream())

    const result = await chatCompletionStream(
      'user-1',
      'openrouter-model',
      [{ role: 'user', content: 'brief' }],
      { maxOutputTokens: 800, reasoning: false },
    )

    expect(mocks.openAiCreate).toHaveBeenCalledWith(expect.objectContaining({
      max_tokens: 800,
      stream: true,
    }))
    expect(result.choices[0]?.message.content).toBe('ok')
  })

  it('keeps the same cap on the non-stream fallback and respects the OpenRouter ceiling', async () => {
    process.env.OPENROUTER_MAX_OUTPUT_TOKENS = '600'
    mocks.openAiCreate
      .mockResolvedValueOnce(failedStream())
      .mockResolvedValueOnce(completion())

    const result = await chatCompletionStream(
      'user-1',
      'openrouter-model',
      [{ role: 'user', content: 'brief' }],
      { maxOutputTokens: 800, reasoning: false },
    )

    expect(mocks.openAiCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      max_tokens: 600,
      stream: true,
    }))
    expect(mocks.openAiCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      max_tokens: 600,
      stream: false,
    }))
    expect(result.choices[0]?.message.content).toBe('fallback')
  })
})

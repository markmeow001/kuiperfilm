import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => ({ model: 'mock-model' })) })),
  openAiCreate: vi.fn(),
  googleGenerateContent: vi.fn(),
  getProviderConfig: vi.fn(),
  getProviderKey: vi.fn((provider: string) => provider),
  getInternalCallbacks: vi.fn(),
  resolveLlmRuntimeModel: vi.fn(),
  isRetryableError: vi.fn(() => true),
}))

vi.mock('ai', () => ({
  generateText: mocks.generateText,
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.googleGenerateContent }
  },
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
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  getInternalLLMStreamCallbacks: mocks.getInternalCallbacks,
}))
vi.mock('@/lib/llm/runtime-shared', () => ({
  _ulogError: vi.fn(),
  _ulogWarn: vi.fn(),
  completionUsageSummary: vi.fn(() => ({
    promptTokens: 0,
    completionTokens: 0,
  })),
  isRetryableError: mocks.isRetryableError,
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

import { chatCompletion } from '@/lib/llm/chat-completion'

function openAiCompletion(text = 'ok') {
  return {
    id: 'completion-1',
    object: 'chat.completion',
    created: 1,
    model: 'model-1',
    choices: [{
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: text, refusal: null },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

describe('chatCompletion generation controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getInternalCallbacks.mockReturnValue({ onChunk: vi.fn() })
    mocks.resolveLlmRuntimeModel.mockResolvedValue({
      provider: 'atlascloud',
      modelId: 'analysis-model',
      modelKey: 'atlascloud::analysis-model',
    })
    mocks.getProviderConfig.mockResolvedValue({
      apiKey: 'key',
      baseUrl: 'https://atlas.example/v1',
      apiMode: 'openai',
    })
    mocks.generateText.mockResolvedValue({
      text: 'ok',
      reasoningText: '',
      usage: { inputTokens: 2, outputTokens: 3 },
    })
    mocks.openAiCreate.mockResolvedValue(openAiCompletion())
    mocks.googleGenerateContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{ text: 'ok' }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    })
  })

  it('stream:false stays non-streaming and forwards maxOutputTokens/maxRetries to AI SDK', async () => {
    await chatCompletion(
      'user-1',
      'analysis-model',
      [{ role: 'user', content: 'brief' }],
      {
        stream: false,
        reasoning: false,
        maxRetries: 0,
        maxOutputTokens: 800,
      },
    )

    expect(mocks.generateText).toHaveBeenCalledOnce()
    expect(mocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      maxRetries: 0,
      maxOutputTokens: 800,
    })
  })

  it('maxRetries:0 performs only one provider request on a retryable failure', async () => {
    mocks.generateText.mockRejectedValueOnce(new Error('temporary network failure'))

    await expect(chatCompletion(
      'user-1',
      'analysis-model',
      [{ role: 'user', content: 'brief' }],
      { stream: false, maxRetries: 0, maxOutputTokens: 800 },
    )).rejects.toThrow('temporary network failure')

    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it('forwards maxOutputTokens as max_tokens for OpenRouter', async () => {
    mocks.resolveLlmRuntimeModel.mockResolvedValueOnce({
      provider: 'openrouter',
      modelId: 'openrouter-model',
      modelKey: 'openrouter::openrouter-model',
    })
    mocks.getProviderConfig.mockResolvedValueOnce({
      apiKey: 'key',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiMode: 'openai',
    })

    await chatCompletion(
      'user-1',
      'openrouter-model',
      [{ role: 'user', content: 'brief' }],
      { stream: false, maxRetries: 0, maxOutputTokens: 1000 },
    )

    expect(mocks.openAiCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openrouter-model',
      max_tokens: 1000,
    }))
  })

  it('forwards maxOutputTokens to Google generateContent', async () => {
    mocks.resolveLlmRuntimeModel.mockResolvedValueOnce({
      provider: 'google',
      modelId: 'gemini-2.5-flash',
      modelKey: 'google::gemini-2.5-flash',
    })
    mocks.getProviderConfig.mockResolvedValueOnce({
      apiKey: 'key',
      baseUrl: '',
      apiMode: 'google',
    })

    await chatCompletion(
      'user-1',
      'gemini-2.5-flash',
      [{ role: 'user', content: 'brief' }],
      { stream: false, maxRetries: 0, maxOutputTokens: 800 },
    )

    expect(mocks.googleGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        maxOutputTokens: 800,
      }),
    }))
  })

  it('forwards maxOutputTokens as max_completion_tokens for Ark', async () => {
    mocks.resolveLlmRuntimeModel.mockResolvedValueOnce({
      provider: 'ark',
      modelId: 'doubao-seed-2-0-test',
      modelKey: 'ark::doubao-seed-2-0-test',
    })
    mocks.getProviderConfig.mockResolvedValueOnce({
      apiKey: 'key',
      baseUrl: '',
      apiMode: 'openai',
    })

    await chatCompletion(
      'user-1',
      'doubao-seed-2-0-test',
      [{ role: 'user', content: 'brief' }],
      { stream: false, reasoning: false, maxRetries: 0, maxOutputTokens: 1000 },
    )

    expect(mocks.openAiCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'doubao-seed-2-0-test',
      max_completion_tokens: 1000,
    }))
  })
})

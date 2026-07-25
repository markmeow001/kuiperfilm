import { beforeEach, describe, expect, it, vi } from 'vitest'

const llmMock = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  chatCompletionWithVision: vi.fn(),
}))

vi.mock('@/lib/llm-client', () => ({
  chatCompletion: llmMock.chatCompletion,
  chatCompletionWithVision: llmMock.chatCompletionWithVision,
  getCompletionContent: (completion: {
    choices?: Array<{ message?: { content?: string | null } }>
  }) => completion.choices?.[0]?.message?.content || '',
}))

import { executeAiTextStep } from '@/lib/ai-runtime/client'

function completion(text = 'completed') {
  return {
    id: 'completion-1',
    object: 'chat.completion' as const,
    created: 1,
    model: 'model-1',
    choices: [{
      index: 0,
      finish_reason: 'stop' as const,
      logprobs: null,
      message: {
        role: 'assistant' as const,
        content: text,
        refusal: null,
      },
    }],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    },
  }
}

describe('executeAiTextStep generation controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    llmMock.chatCompletion.mockResolvedValue(completion())
  })

  it('forwards retry, output-token, and non-stream controls to chatCompletion', async () => {
    const result = await executeAiTextStep({
      userId: 'user-1',
      model: 'model-1',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'brief' },
      ],
      projectId: 'playground',
      action: 'canvas_text',
      meta: {
        stepId: 'canvas_text',
        stepTitle: 'Canvas text',
        stepIndex: 1,
        stepTotal: 1,
      },
      reasoning: false,
      maxRetries: 0,
      maxOutputTokens: 800,
      stream: false,
    })

    expect(llmMock.chatCompletion).toHaveBeenCalledWith(
      'user-1',
      'model-1',
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'brief' },
      ],
      expect.objectContaining({
        reasoning: false,
        maxRetries: 0,
        maxOutputTokens: 800,
        stream: false,
        projectId: 'playground',
        action: 'canvas_text',
      }),
    )
    expect(result.text).toBe('completed')
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    })
  })
})

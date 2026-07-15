import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { findPlaygroundDiscussionModel } from '@/lib/playground/discussion-models'

const MAX_MESSAGES = 40
const MAX_MESSAGE_CHARS = 12_000
const MAX_TOTAL_CHARS = 60_000

type DiscussionMessage = {
  role: 'user' | 'assistant'
  content: string
}

function parseMessages(value: unknown): DiscussionMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DISCUSSION_MESSAGES_INVALID',
      message: `對話需包含 1–${MAX_MESSAGES} 則訊息`,
    })
  }

  let totalChars = 0
  const messages = value.map((entry): DiscussionMessage => {
    const role = (entry as { role?: unknown })?.role
    const rawContent = (entry as { content?: unknown })?.content
    const content = typeof rawContent === 'string' ? rawContent.trim() : ''
    if ((role !== 'user' && role !== 'assistant') || !content || content.length > MAX_MESSAGE_CHARS) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'DISCUSSION_MESSAGE_INVALID',
        message: `每則訊息需為 ${MAX_MESSAGE_CHARS} 字以內的有效文字`,
      })
    }
    totalChars += content.length
    return { role, content }
  })

  if (totalChars > MAX_TOTAL_CHARS) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DISCUSSION_CONTEXT_TOO_LONG',
      message: '對話內容過長，請清除對話後再開始新的討論',
    })
  }
  if (messages[messages.length - 1]?.role !== 'user') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DISCUSSION_LAST_MESSAGE_INVALID',
      message: '最後一則訊息必須來自使用者',
    })
  }
  return messages
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: { modelKey?: unknown; messages?: unknown }
  try {
    body = await request.json() as { modelKey?: unknown; messages?: unknown }
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_JSON_BODY',
      message: 'request body must be valid JSON',
    })
  }

  const modelKey = typeof body.modelKey === 'string' ? body.modelKey.trim() : ''
  const model = findPlaygroundDiscussionModel(modelKey)
  if (!model) {
    throw new ApiError('FORBIDDEN', {
      code: 'DISCUSSION_MODEL_NOT_ALLOWED',
      message: '此模型不在劇本討論白名單中',
    })
  }
  const messages = parseMessages(body.messages)
  let result
  try {
    result = await executeAiTextStep({
      userId: authResult.session.user.id,
      model: model.modelKey,
      projectId: 'playground',
      action: 'playground_script_discussion',
      meta: {
        stepId: 'playground_script_discussion',
        stepTitle: '劇本討論',
        stepIndex: 1,
        stepTotal: 1,
      },
      reasoning: false,
      temperature: 0.8,
      messages: [
        {
          role: 'system',
          content:
            '你是資深電影劇本顧問。協助使用者分析人物弧線、衝突、結構、節奏、主題與場次，' +
            '也能共同發展故事。回覆必須具體、可執行，清楚區分觀察、問題與修改建議；' +
            '除非使用者要求，使用繁體中文回答。不要聲稱看過未提供的劇本內容。',
        },
        ...messages,
      ],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('MODEL_NOT_FOUND') || message.includes('MODEL_NOT_CONFIGURED')) {
      throw new ApiError('FORBIDDEN', {
        code: 'DISCUSSION_MODEL_NOT_ENABLED',
        message: '請先在 API 設定中啟用這個 OpenRouter 模型',
      })
    }
    throw error
  }
  const content = result.text.trim()
  if (!content) {
    throw new ApiError('INTERNAL_ERROR', {
      code: 'DISCUSSION_EMPTY_RESPONSE',
      message: '模型沒有回傳內容，請再試一次',
    })
  }

  return NextResponse.json({
    message: { role: 'assistant', content },
    modelKey: model.modelKey,
  })
})

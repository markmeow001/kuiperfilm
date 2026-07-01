/**
 * Canvas 无限画布 — Audio node: text + reference voice → cloned TTS.
 *
 * POST { text, referenceAudioKey, emotionPrompt?, strength? } → submits a
 * CANVAS_TTS task on the voice worker and returns { taskId }. The canvas polls
 * GET /api/tasks/[taskId] and reads task.result.audioUrl when completed.
 *
 * No direct provider call here (CLAUDE.md §3): the route only resolves + submits;
 * the voice worker runs FAL IndexTTS2. Uses the 'playground' virtual project id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { estimateVoiceLineMaxSeconds } from '@/lib/voice/generate-voice-line'
import { isSafeReference } from '@/lib/playground/reference-guard'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

const CANVAS_PROJECT_ID = 'playground'
const MAX_TTS_CHARS = 2000

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const body = (await request.json()) as {
    text?: unknown
    referenceAudioKey?: unknown
    emotionPrompt?: unknown
    strength?: unknown
    locale?: unknown
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const referenceAudioKey = typeof body.referenceAudioKey === 'string' ? body.referenceAudioKey.trim() : ''
  const emotionPrompt = typeof body.emotionPrompt === 'string' ? body.emotionPrompt.trim() : ''
  const strength = typeof body.strength === 'number' && Number.isFinite(body.strength)
    ? Math.min(Math.max(body.strength, 0), 1)
    : 0.4
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale

  if (!text) {
    throw new ApiError('INVALID_PARAMS', { code: 'TEXT_REQUIRED' })
  }
  if (text.length > MAX_TTS_CHARS) {
    throw new ApiError('INVALID_PARAMS', { code: 'TEXT_TOO_LONG', details: { max: MAX_TTS_CHARS, got: text.length } })
  }
  if (!referenceAudioKey) {
    throw new ApiError('INVALID_PARAMS', { code: 'REFERENCE_AUDIO_REQUIRED' })
  }
  if (emotionPrompt.length > 500) {
    throw new ApiError('INVALID_PARAMS', { code: 'EMOTION_PROMPT_TOO_LONG', details: { max: 500 } })
  }
  // Reference audio must be a BARE own-namespace voice key — the audio node only
  // ever uploads a clip (→ voice/playground-ref/<userId>/…). Rejecting URLs
  // outright (not just isSafeReference, which permits external https) closes the
  // server-side-fetch-of-attacker-URL vector for this path.
  if (!referenceAudioKey.startsWith('voice/') || !isSafeReference(referenceAudioKey, userId)) {
    throw new ApiError('FORBIDDEN', {
      code: 'REFERENCE_NOT_ALLOWED',
      details: { message: 'reference audio must be your own uploaded voice key' },
    })
  }

  const targetId = crypto.randomUUID()
  // Use the shared voice estimator so the billing quote matches the rest of the
  // voice pipeline (chars/2), capped at 120s for the canvas node.
  const maxSeconds = Math.min(120, estimateVoiceLineMaxSeconds(text))

  const submitted = await submitTask({
    userId,
    locale,
    projectId: CANVAS_PROJECT_ID,
    type: TASK_TYPE.CANVAS_TTS,
    targetType: 'canvas-tts',
    targetId,
    payload: {
      text,
      referenceAudioKey,
      ...(emotionPrompt ? { emotionPrompt } : {}),
      strength,
      maxSeconds,
    },
  })

  _ulogInfo(`[canvas.tts] submitted taskId=${submitted.taskId} userId=${userId} chars=${text.length}`)

  return NextResponse.json({
    success: true,
    taskId: submitted.taskId,
    runId: submitted.runId ?? null,
    status: submitted.status,
  })
})

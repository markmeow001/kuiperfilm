/**
 * Canvas 无限画布 — Audio node: text + reference voice → cloned TTS.
 *
 * POST { text, referenceAudioKey, emotionPrompt?, strength? } → submits a
 * CANVAS_TTS task on the voice worker and returns { taskId }. The canvas polls
 * GET /api/tasks/[taskId] and reads task.result.audioUrl when completed.
 *
 * No direct provider call here (CLAUDE.md §3): the route only resolves and
 * pins the AtlasCloud audio contract before submitting to the voice worker.
 * Uses the 'playground' virtual project id.
 */
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { estimateVoiceLineMaxSeconds } from '@/lib/voice/generate-voice-line'
import { isSafeReference } from '@/lib/playground/reference-guard'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import {
  buildAtlasCloudSeedAudioText,
  countUnicodeCodePoints,
} from '@/lib/voice/atlascloud-seed-audio-input'
import { requireAtlasCloudSeedAudioSelection } from '@/lib/voice/atlascloud-seed-audio-route-config'
import { prisma } from '@/lib/prisma'

const CANVAS_PROJECT_ID = 'playground'
const MAX_TTS_CHARS = 2000
const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canvasTtsDedupeKey(userId: string, clientRequestId: string): string {
  return `canvas-tts:v1:${sha256(`${userId}\0${clientRequestId}`)}`
}

function canvasTtsIdempotencyFingerprint(input: {
  text: string
  referenceAudioKey: string
  emotionPrompt: string
  strength: number
  locale: Locale
}): string {
  return sha256(JSON.stringify({
    version: 1,
    text: input.text,
    referenceAudioKey: input.referenceAudioKey,
    emotionPrompt: input.emotionPrompt,
    strength: input.strength,
    locale: input.locale,
  }))
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function taskRunId(payload: Record<string, unknown>): string | null {
  const direct = typeof payload.runId === 'string' ? payload.runId.trim() : ''
  if (direct) return direct
  const meta = toObject(payload.meta)
  const nested = typeof meta.runId === 'string' ? meta.runId.trim() : ''
  return nested || null
}

function canvasTtsReplayConflict(): never {
  throw new ApiError('CONFLICT', {
    code: 'TASK_IDEMPOTENCY_CONFLICT',
    message: 'clientRequestId 已綁定另一個 Canvas 配音請求內容',
  })
}

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
    clientRequestId?: unknown
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const referenceAudioKey = typeof body.referenceAudioKey === 'string' ? body.referenceAudioKey.trim() : ''
  const emotionPrompt = typeof body.emotionPrompt === 'string' ? body.emotionPrompt.trim() : ''
  const strength = typeof body.strength === 'number' && Number.isFinite(body.strength)
    ? Math.min(Math.max(body.strength, 0.1), 1)
    : 0.4
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale
  const clientRequestId = typeof body.clientRequestId === 'string'
    ? body.clientRequestId.trim().toLowerCase()
    : ''

  if (!CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CLIENT_REQUEST_ID_INVALID',
      message: 'clientRequestId 必須是有效 UUID；重試同一次提交時請沿用相同值',
    })
  }

  if (!text) {
    throw new ApiError('INVALID_PARAMS', { code: 'TEXT_REQUIRED' })
  }
  const textCharacters = countUnicodeCodePoints(text)
  if (textCharacters > MAX_TTS_CHARS) {
    throw new ApiError('INVALID_PARAMS', { code: 'TEXT_TOO_LONG', details: { max: MAX_TTS_CHARS, got: textCharacters } })
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

  const dedupeKey = canvasTtsDedupeKey(userId, clientRequestId)
  const idempotencyFingerprint = canvasTtsIdempotencyFingerprint({
    text,
    referenceAudioKey,
    emotionPrompt,
    strength,
    locale,
  })
  const replay = await prisma.task.findUnique({
    where: { dedupeKey },
    select: {
      id: true,
      userId: true,
      projectId: true,
      type: true,
      targetType: true,
      targetId: true,
      status: true,
      payload: true,
    },
  })
  if (replay) {
    const payload = toObject(replay.payload)
    if (
      replay.userId !== userId
      || replay.projectId !== CANVAS_PROJECT_ID
      || replay.type !== TASK_TYPE.CANVAS_TTS
      || replay.targetType !== 'canvas-tts'
      || !replay.targetId
      || payload.clientRequestId !== clientRequestId
      || payload.idempotencyFingerprint !== idempotencyFingerprint
    ) {
      canvasTtsReplayConflict()
    }
    return NextResponse.json({
      success: true,
      taskId: replay.id,
      runId: taskRunId(payload),
      status: replay.status,
    })
  }

  const audioSelection = await requireAtlasCloudSeedAudioSelection(userId)
  const audioModel = audioSelection.modelKey
  const providerText = buildAtlasCloudSeedAudioText({
    dialogue: text,
    emotionPrompt,
    emotionStrength: emotionPrompt ? strength : null,
  })

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
    dedupeKey,
    dedupeMode: 'idempotent',
    payload: {
      text,
      referenceAudioKey,
      ...(emotionPrompt ? { emotionPrompt } : {}),
      strength,
      maxSeconds,
      audioModel,
      providerText,
      clientRequestId,
      idempotencyFingerprint,
    },
  })

  _ulogInfo(
    `[canvas.tts] submitted taskId=${submitted.taskId} userId=${userId} chars=${countUnicodeCodePoints(providerText)}`,
  )

  return NextResponse.json({
    success: true,
    taskId: submitted.taskId,
    runId: submitted.runId ?? null,
    status: submitted.status,
  })
})

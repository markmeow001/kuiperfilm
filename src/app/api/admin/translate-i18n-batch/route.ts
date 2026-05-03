/**
 * Admin-only batch translator for i18n migration.
 *
 * POST { strings: string[], targetLang?: 'en' (default) }
 *   → { translations: Record<string, string> }
 *
 * Uses the admin's stored OpenRouter key (decrypted server-side via
 * getProviderConfig) — no client-side key handling. Designed for the
 * `scripts/translate-extracted-to-en.mjs` migration tool, but kept
 * general so future i18n batches don't need a new endpoint.
 *
 * Why admin-only: this endpoint accesses paid LLM credits. Members /
 * editors can't trigger arbitrary translation jobs.
 *
 * Why not stream: caller is a one-off script that batches in chunks
 * of 50 — round-trip latency is fine and simpler to consume.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getProviderConfig } from '@/lib/api-config'

const SYSTEM_PROMPT = `You are a precise UI string translator for a video editing
SaaS targeting Chinese-speaking creators of short dramas. Translate the
provided list of Simplified Chinese UI strings to natural English UI
copy.

Rules:
- Preserve brevity. UI labels stay 1-3 words. Buttons stay imperative.
- Preserve any placeholders unchanged: {0}, {name}, \${expr}, %s, etc.
- Preserve HTML entities like &#10; verbatim.
- Preserve emoji / arrow / check marks (✓ ⚠ ↻ → ← ▶ ▦ ◷ ☰).
- Preserve trailing ellipses … (don't expand to "...").
- Never invent meaning. If a Chinese phrase is ambiguous, pick the
  shortest reasonable English; do not add explanatory text.
- Domain context: 分镜=storyboard panel, 多镜头=multi-shot, 角色=
  character, 场景=scene/location, 道具=prop, 配音=voice/dub,
  对白/对话=dialogue, 主体=subjects, 集=episode, 储存=save,
  生图=image gen, 生视频=video gen.
- Return ONLY a JSON object whose keys are the Chinese source strings
  and whose values are the English translations. No extra prose.`

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const strings = (body as { strings?: unknown }).strings
  const targetLang = (body as { targetLang?: unknown }).targetLang ?? 'en'

  if (!Array.isArray(strings) || strings.length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'strings must be a non-empty array' })
  }
  if (strings.length > 200) {
    throw new ApiError('INVALID_PARAMS', { message: 'max 200 strings per batch' })
  }
  if (!strings.every((s) => typeof s === 'string')) {
    throw new ApiError('INVALID_PARAMS', { message: 'all strings must be strings' })
  }
  if (targetLang !== 'en') {
    throw new ApiError('INVALID_PARAMS', { message: 'only targetLang=en supported today' })
  }

  // Pull the admin's decrypted OpenRouter key. requireAdminAuth already
  // verified session.user is admin, so session.user.id is the admin
  // userId we want.
  const config = await getProviderConfig(session.user.id, 'openrouter')
  if (!config.apiKey) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPENROUTER_NOT_CONFIGURED',
      message: 'Admin has no OpenRouter API key configured. Set it in /zh/profile.',
    })
  }

  const userPrompt =
    `Translate the following array of Chinese UI strings to English.\n` +
    `Return a JSON object mapping each input string to its English translation.\n\n` +
    JSON.stringify(strings)

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter's recommended attribution headers — helps with
      // rate-limit shaping and quota visibility on their dashboard.
      'HTTP-Referer': 'https://art.kuiperfilmailab.com',
      'X-Title': 'KuiperAI i18n migration',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  })

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPENROUTER_HTTP_ERROR',
      message: `OpenRouter HTTP ${upstream.status}: ${text.slice(0, 300)}`,
    })
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPENROUTER_EMPTY_RESPONSE',
      message: 'OpenRouter returned an empty response',
    })
  }

  let translations: Record<string, string>
  try {
    translations = JSON.parse(content)
  } catch {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPENROUTER_NON_JSON',
      message: `OpenRouter returned non-JSON: ${content.slice(0, 200)}`,
    })
  }

  return NextResponse.json({ translations })
})

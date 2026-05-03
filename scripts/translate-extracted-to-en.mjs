#!/usr/bin/env node
/**
 * Translate `_migration-out/flat-zh-Hans.json` into English via an
 * OpenAI-compatible chat endpoint. Output written to
 * `_migration-out/messages-en.json` keyed by simplified Chinese
 * source string.
 *
 * Usage — three modes, pick whichever has access:
 *
 *   # 1. Use admin's stored OpenRouter key on production (no local key
 *   #    needed — server reads it from DB). Recommended.
 *   KUIPER_BASE_URL=https://art.kuiperfilmailab.com \
 *   KUIPER_SESSION='next-auth.session-token=eyJ...' \
 *     node scripts/translate-extracted-to-en.mjs
 *
 *   # 2. Direct OpenAI
 *   OPENAI_API_KEY=sk-... node scripts/translate-extracted-to-en.mjs
 *
 *   # 3. Direct OpenRouter (your own key)
 *   OPENROUTER_API_KEY=sk-or-... node scripts/translate-extracted-to-en.mjs
 *
 * For mode 1: log into prod as admin, open devtools, copy the
 * `next-auth.session-token` cookie value, paste into KUIPER_SESSION
 * (the script handles wrapping in Cookie header).
 *
 * Optional env:
 *   TRANSLATE_MODEL=gpt-4o-mini  (modes 2/3 only; mode 1 is fixed
 *                                 server-side)
 *   TRANSLATE_BASE_URL=...       (override; defaults follow whichever
 *                                 key is set)
 *   BATCH_SIZE=50                (strings per request; default 50)
 *
 * Cost estimate: ~489 unique strings, ~6300 source chars, batched 50
 * per request ≈ 10 calls × ~1500 in / ~1000 out tokens. With
 * gpt-4o-mini that's ≈ $0.005. With openrouter free tier even less.
 *
 * Quality: the prompt instructs the model to keep UI brevity, preserve
 * placeholders ({0}, ${...}, %, &#10;), and never expand short labels
 * ("登出" → "Sign Out", not "Log Out of Your Account"). Output is
 * machine-translation; a human review pass before --apply is the
 * cheapest insurance against weird CTA wording.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, '_migration-out')
const INPUT = join(OUT_DIR, 'flat-zh-Hans.json')
const OUTPUT = join(OUT_DIR, 'messages-en.json')

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 50
const MODEL = process.env.TRANSLATE_MODEL || 'gpt-4o-mini'

function pickEndpoint() {
  // Mode 1: hit our admin-only proxy that reads the stored OpenRouter
  // key server-side. Preferred — no local secret handling.
  if (process.env.KUIPER_BASE_URL && process.env.KUIPER_SESSION) {
    return {
      mode: 'kuiper',
      url: `${process.env.KUIPER_BASE_URL}/api/admin/translate-i18n-batch`,
      cookie: process.env.KUIPER_SESSION.startsWith('next-auth')
        ? process.env.KUIPER_SESSION
        : `next-auth.session-token=${process.env.KUIPER_SESSION}`,
    }
  }
  if (process.env.TRANSLATE_BASE_URL && process.env.OPENAI_API_KEY) {
    return { mode: 'openai', url: process.env.TRANSLATE_BASE_URL, key: process.env.OPENAI_API_KEY }
  }
  if (process.env.OPENAI_API_KEY) {
    return { mode: 'openai', url: 'https://api.openai.com/v1', key: process.env.OPENAI_API_KEY }
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { mode: 'openai', url: 'https://openrouter.ai/api/v1', key: process.env.OPENROUTER_API_KEY }
  }
  console.error('ERROR: set KUIPER_BASE_URL+KUIPER_SESSION (preferred), OPENAI_API_KEY, or OPENROUTER_API_KEY.')
  process.exit(1)
}

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

async function translateBatch(endpoint, batch) {
  if (endpoint.mode === 'kuiper') {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Cookie': endpoint.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ strings: batch.map((b) => b.s), targetLang: 'en' }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = await res.json()
    if (!data.translations) throw new Error('Server returned no translations field')
    return data.translations
  }

  // Direct OpenAI-compatible mode (modes 2/3)
  const userPrompt = JSON.stringify(batch.map((b) => b.s))
  const res = await fetch(`${endpoint.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${endpoint.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `Translate the following array of Chinese UI strings to English.\n` +
            `Return a JSON object mapping each input string to its English translation.\n\n` +
            userPrompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty response from model')
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Model returned non-JSON: ${content.slice(0, 300)}`)
  }
  return parsed
}

async function main() {
  if (!existsSync(INPUT)) {
    console.error(`Input missing: ${INPUT}\nRun: node scripts/migrate-traditional-to-simplified.mjs first.`)
    process.exit(1)
  }
  const endpoint = pickEndpoint()
  const flat = JSON.parse(readFileSync(INPUT, 'utf8'))
  console.log(`endpoint     : ${endpoint.url}`)
  console.log(`model        : ${MODEL}`)
  console.log(`batch size   : ${BATCH_SIZE}`)
  console.log(`unique strs  : ${flat.length}`)

  // Resume: load any prior partial output so re-running on rate-limit
  // failures doesn't repay the entire bill.
  const out = existsSync(OUTPUT)
    ? JSON.parse(readFileSync(OUTPUT, 'utf8'))
    : {}

  const remaining = flat.filter((e) => !(e.s in out))
  console.log(`already done : ${flat.length - remaining.length}`)
  console.log(`to translate : ${remaining.length}`)

  let done = 0
  let failed = 0
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE)
    const t0 = Date.now()
    try {
      const translated = await translateBatch(endpoint, batch)
      let mapped = 0
      for (const e of batch) {
        if (typeof translated[e.s] === 'string') {
          out[e.s] = translated[e.s]
          mapped += 1
        }
      }
      // Persist after every batch so a mid-run crash doesn't lose progress.
      writeFileSync(OUTPUT, JSON.stringify(out, null, 2))
      done += mapped
      const ms = Date.now() - t0
      console.log(
        `batch ${(i / BATCH_SIZE + 1).toString().padStart(2)}/${Math.ceil(
          remaining.length / BATCH_SIZE,
        )}  +${mapped}/${batch.length}  ${ms}ms`,
      )
      if (mapped < batch.length) {
        const missing = batch.filter((e) => !(e.s in out)).map((e) => e.s).slice(0, 3)
        console.log(`  WARN: ${batch.length - mapped} unmapped (sample: ${JSON.stringify(missing)})`)
      }
    } catch (err) {
      failed += batch.length
      console.error(`batch failed: ${err.message}`)
    }
  }

  console.log()
  console.log(`done   : ${done}`)
  console.log(`failed : ${failed}`)
  console.log(`output : ${OUTPUT}`)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})

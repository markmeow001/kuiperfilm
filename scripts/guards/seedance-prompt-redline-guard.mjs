#!/usr/bin/env node
/**
 * Seedance prompt red-line guard.
 *
 * Static check that prevents future edits to the storyboard prompt
 * templates from silently stripping the 7-rule "五要素红线" block
 * (and the 戏剧运镜词汇库 in the detail variant) that commit 661737d
 * baked in on 2026-05-18. The rules teach the planner / detail LLM
 * not to over-stuff descriptions with appearance details, negative
 * directives, camera equipment terms, vague collective nouns, etc.
 *
 * Why this guard exists:
 *   - The rules live in plain .txt prompt files, so a refactor of the
 *     prompt phrasing can accidentally drop a numbered rule without
 *     any test catching it.
 *   - The matching is intentionally loose — we anchor on the rule
 *     header / number, not the full phrasing, so prompt copy-edits
 *     stay possible without breaking the guard.
 *   - When this guard fails, the fix is either to restore the missing
 *     rule (preferred) or — if the rule was genuinely retired — to
 *     update this script's REQUIRED_TOKENS list in the same commit so
 *     the deletion is documented.
 *
 * Out of scope (runtime LLM output validation):
 *   The 661737d commit body mentioned a "post-hoc lint of LLM output"
 *   that would catch violations at the worker level. That is a runtime
 *   validator (likely src/lib/workers/...), not a static guard, and is
 *   not implemented here.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const PROMPT_DIR = path.join(ROOT, 'lib/prompts/novel-promotion')

// Each file lists tokens that MUST appear as a substring. Tokens are
// anchored on either:
//   - The numbered rule header (1 / 2 / 3 ...) plus a short stable
//     keyword from that rule, OR
//   - A section header in 【...】 brackets / ALL-CAPS.
//
// Wording inside each rule can drift freely without breaking the
// guard, but removing a rule or its self-check checklist trips it.
const REQUIRED_TOKENS = [
  {
    file: 'agent_storyboard_plan.zh.txt',
    label: '五要素红线 (planner zh)',
    tokens: [
      '【五要素红线',
      '禁止重复 @图片',
      '动作链 ≤ 5',
      '禁止否定句指令',
      '禁止剪辑 / 器材术语',
      '禁止模糊集合词',
      '≤ 30 字',
      '自检清单',
    ],
  },
  {
    file: 'agent_storyboard_plan.en.txt',
    label: '五要素红线 (planner en)',
    tokens: [
      'Action chain ≤ 5',
      'NO negative directives',
      'NO camera / film-equipment',
      'NO vague collective nouns',
      '≤ 30 words',
      'Self-check before output',
    ],
  },
  {
    file: 'agent_storyboard_detail.zh.txt',
    label: '五要素红线 + 戏剧运镜 (detail zh)',
    tokens: [
      '【五要素红线',
      '【戏剧运镜词汇库',
    ],
  },
  {
    file: 'agent_storyboard_detail.en.txt',
    label: '五要素红线 + dramatic camera (detail en)',
    tokens: [
      'Action chain ≤ 5',
      'NO negative directives',
      'Dramatic camera vocabulary',
    ],
  },
]

const results = []
for (const entry of REQUIRED_TOKENS) {
  const abs = path.join(PROMPT_DIR, entry.file)
  if (!fs.existsSync(abs)) {
    results.push({
      file: entry.file,
      label: entry.label,
      ok: false,
      missing: ['<file does not exist>'],
    })
    continue
  }
  const content = fs.readFileSync(abs, 'utf8')
  const missing = entry.tokens.filter((tok) => !content.includes(tok))
  results.push({
    file: entry.file,
    label: entry.label,
    ok: missing.length === 0,
    missing,
  })
}

const failures = results.filter((r) => !r.ok)
if (failures.length === 0) {
  const totalTokens = REQUIRED_TOKENS.reduce((s, e) => s + e.tokens.length, 0)
  console.log(
    `[seedance-prompt-redline-guard] OK — ${totalTokens} red-line tokens present across ${REQUIRED_TOKENS.length} prompt files`,
  )
  process.exit(0)
}

console.error('[seedance-prompt-redline-guard] FAILED — required red-line tokens missing:')
for (const r of failures) {
  console.error(`  - lib/prompts/novel-promotion/${r.file}  (${r.label})`)
  for (const tok of r.missing) {
    console.error(`      missing: ${JSON.stringify(tok)}`)
  }
}
console.error('')
console.error('Either restore the missing rule(s) in the prompt template, or')
console.error('— if the rule was genuinely retired — update scripts/guards/')
console.error('seedance-prompt-redline-guard.mjs REQUIRED_TOKENS in the same commit.')
process.exit(1)

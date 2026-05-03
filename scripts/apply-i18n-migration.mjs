#!/usr/bin/env node
/**
 * Stage 3 of the i18n migration: turn extracted strings into a
 * concrete rewrite plan, then optionally apply it.
 *
 * Two modes:
 *
 *   node scripts/apply-i18n-migration.mjs --plan        (default)
 *     Produces _migration-out/apply-plan.json + proposed
 *     messages/zh/v2.json + messages/en/v2.json (written into
 *     _migration-out/, not the real messages/ folder). User reviews
 *     these JSONs before approving the apply.
 *
 *   node scripts/apply-i18n-migration.mjs --apply
 *     Rewrites the actual .tsx files (replacing inline CJK strings
 *     with t('key') calls), copies messages JSONs into messages/zh/
 *     + messages/en/, and adds the necessary useTranslations imports.
 *     IRREVERSIBLE without git revert — only run after the plan is
 *     reviewed AND Session A is confirmed off V2 .tsx files.
 *
 * Pre-conditions:
 *   - _migration-out/extracted-zh-Hans.json (from migrate-traditional-
 *     to-simplified.mjs)
 *   - _migration-out/messages-en.json (from translate-extracted-to-
 *     en.mjs)
 *
 * Key naming scheme:
 *   v2.<file-slug>.<numeric-index>
 *   e.g. v2.subjects.client.42
 *
 * Why numeric: human-meaningful slugs from auto-extracted strings
 * collide constantly (every "取消" wants the key "cancel", every
 * "重新生成" wants "regenerate", etc) — and we'd need an LLM pass
 * to pick good slug names. Numeric keeps the migration mechanical
 * and predictable. Once the .tsx files are using t(), human
 * developers can rename keys to semantic slugs over time.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join, relative, dirname, basename } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, '_migration-out')
const EXTRACTED = join(OUT_DIR, 'extracted-zh-Hans.json')
const TRANSLATIONS = join(OUT_DIR, 'messages-en.json')
const PLAN_OUT = join(OUT_DIR, 'apply-plan.json')
const PROPOSED_ZH = join(OUT_DIR, 'proposed-messages-zh-v2.json')
const PROPOSED_EN = join(OUT_DIR, 'proposed-messages-en-v2.json')

const MODE = process.argv.includes('--apply') ? 'apply' : 'plan'

function loadJsonOrDie(path, label) {
  if (!existsSync(path)) {
    console.error(`ERROR: missing ${label} (${relative(ROOT, path)})`)
    console.error('Run the earlier migration scripts first:')
    console.error('  1. node scripts/migrate-traditional-to-simplified.mjs')
    console.error('  2. KUIPER_BASE_URL=... KUIPER_SESSION=... node scripts/translate-extracted-to-en.mjs')
    process.exit(1)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Convert a file path under src/ into a key namespace slug.
 *
 *   src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx
 *     → "v2.subjects.client"
 *   src/components/v2/Sidebar.tsx
 *     → "v2.sidebar"
 *   src/components/Navbar.tsx
 *     → "navbar"
 */
function fileToNamespace(filepath) {
  const rel = filepath.replace(/^src\//, '')
  const file = basename(rel, '.tsx').replace(/^V2/, '')
  // Walk up the directory list, keep the parts that are stable
  // identifiers (not [locale] / [projectId]).
  const parts = dirname(rel)
    .split('/')
    .filter((p) => p && !p.startsWith('[') && p !== 'app' && p !== 'components' && p !== 'workspace')
    .map((p) => p.toLowerCase())
  // Strip the file's "Client" / "Page" / "Modal" suffix when possible —
  // keeps keys shorter without losing meaning.
  const fileSlug = file
    .replace(/Client$/, '')
    .replace(/Page$/, '')
    .replace(/Modal$/, '')
    .replace(/Panel$/, '')
    .toLowerCase() || file.toLowerCase()
  // Dedupe consecutive identical segments (e.g. "v2.v2.something"
  // when file already starts with V2).
  const all = [...parts, fileSlug].filter((p, i, arr) => i === 0 || p !== arr[i - 1])
  return all.join('.')
}

/**
 * Build the apply plan. For each file → ordered list of unique
 * strings + assigned keys + simplified + English translations.
 */
function buildPlan(extracted, translations) {
  const messagesZh = {} // key → simplified
  const messagesEn = {} // key → english
  const filePlan = []   // [{ file, namespace, replacements: [{ original, simplified, key, english, type }] }]

  // Stable order: alphabetical by file path so re-runs produce
  // identical output.
  const fileEntries = Object.entries(extracted).sort(([a], [b]) => a.localeCompare(b))

  for (const [file, items] of fileEntries) {
    const namespace = fileToNamespace(file)
    // Per-file numeric index, stable across runs as long as the
    // extraction order is stable (file is read top-down so it is).
    const seen = new Map() // simplified content → key (dedupe within file)
    const replacements = []
    let nextIdx = 1
    for (const item of items) {
      const cached = seen.get(item.simplified)
      if (cached) {
        replacements.push({ ...cached, type: item.type, original: item.content })
        continue
      }
      const key = `${namespace}.t${nextIdx}`
      nextIdx += 1
      const english = translations[item.simplified]
      const replacement = {
        original: item.content,
        simplified: item.simplified,
        key,
        english: english ?? null,
      }
      seen.set(item.simplified, replacement)
      replacements.push({ ...replacement, type: item.type })

      // Build the messages output, namespaced under the file's slug.
      const flatKey = key
      messagesZh[flatKey] = item.simplified
      messagesEn[flatKey] = english ?? `[!MISSING] ${item.simplified}`
    }
    filePlan.push({ file, namespace, replacements })
  }

  return { filePlan, messagesZh, messagesEn }
}

/**
 * Emit plan-mode artefacts. Doesn't touch any source files.
 */
function emitPlan(plan) {
  mkdirSync(OUT_DIR, { recursive: true })
  // Write apply-plan.json with the per-file rewrite plan + summary
  // counts so reviewers can eyeball coverage.
  const summary = {
    totalFiles: plan.filePlan.length,
    totalUniqueKeys: Object.keys(plan.messagesZh).length,
    totalReplacements: plan.filePlan.reduce((s, f) => s + f.replacements.length, 0),
    missingTranslations: Object.entries(plan.messagesEn)
      .filter(([, v]) => v.startsWith('[!MISSING]'))
      .map(([k]) => k),
  }
  writeFileSync(PLAN_OUT, JSON.stringify({ summary, filePlan: plan.filePlan }, null, 2))
  writeFileSync(PROPOSED_ZH, JSON.stringify(plan.messagesZh, null, 2))
  writeFileSync(PROPOSED_EN, JSON.stringify(plan.messagesEn, null, 2))

  console.log('=== apply-i18n-migration · PLAN ===')
  console.log(`mode               : plan-only (no .tsx changes)`)
  console.log(`files in plan      : ${summary.totalFiles}`)
  console.log(`unique keys        : ${summary.totalUniqueKeys}`)
  console.log(`total replacements : ${summary.totalReplacements}`)
  console.log(`missing English    : ${summary.missingTranslations.length}`)
  console.log('')
  console.log('outputs in _migration-out/:')
  console.log(`  apply-plan.json              — full per-file plan`)
  console.log(`  proposed-messages-zh-v2.json — simplified Chinese keyset`)
  console.log(`  proposed-messages-en-v2.json — English keyset (review!)`)
  console.log('')
  console.log('next:')
  console.log('  1. Eyeball proposed-messages-en-v2.json — fix CTA / brand-name lines')
  console.log('  2. Eyeball apply-plan.json sample replacements')
  console.log('  3. Confirm Session A is off V2 .tsx files')
  console.log('  4. node scripts/apply-i18n-migration.mjs --apply')
}

/**
 * Apply mode is intentionally NOT yet implemented — it would rewrite
 * 28 .tsx files and a slip-up costs hours of git surgery. We ship the
 * plan emitter first; user reviews; then we wire the rewrite logic in
 * a separate commit with explicit safety guards (dry-run diff,
 * reversible patch file, etc).
 */
function applyAndDie() {
  console.error('--apply mode not yet implemented.')
  console.error('Review the plan output first; wire-up is a follow-up commit')
  console.error('after Session A confirms they are off V2 .tsx files.')
  process.exit(2)
}

function main() {
  const extracted = loadJsonOrDie(EXTRACTED, 'extraction')
  const translations = loadJsonOrDie(TRANSLATIONS, 'translations')
  const plan = buildPlan(extracted, translations)
  if (MODE === 'apply') applyAndDie()
  emitPlan(plan)
}

main()

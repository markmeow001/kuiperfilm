#!/usr/bin/env node
/**
 * V2 hardcoded zh-Hant → zh-Hans + i18n extraction tool.
 *
 * Two modes (default = dry-run):
 *
 *   node scripts/migrate-traditional-to-simplified.mjs --dry-run   (default)
 *     Walks V2 .tsx + nav/sidebar/topbar/userMenu, finds hardcoded
 *     CJK strings (JSX text + JSX attribute string literals + alert/
 *     console / template literals containing CJK). Reports stats and
 *     writes proposed extraction to:
 *       _migration-out/extracted-zh-Hant.json    (raw,as found)
 *       _migration-out/extracted-zh-Hans.json    (OpenCC tw→cn)
 *       _migration-out/by-file-stats.json
 *
 *   node scripts/migrate-traditional-to-simplified.mjs --apply
 *     (Future — not yet implemented.) Will rewrite .tsx files to
 *     replace inline CJK with t('xxx') keys based on the proposed
 *     extraction. Manual review of dry-run JSON expected first.
 *
 * Why dry-run first:
 *   The apply step touches every V2 .tsx (~31 files, 600+ strings)
 *   and rebuilds them to use next-intl. Catastrophic if scope-creep
 *   lands wrong. Dry-run lets us eyeball the extracted set, hand-fix
 *   the inevitable false positives (logger.info with embedded zh,
 *   class names, dev-only console), and only then apply.
 *
 * Scope (per user 2026-05-03):
 *   - .tsx files in src/app/[locale]/v2/, src/components/v2/,
 *     src/components/Navbar.tsx, UserMenu, Sidebar, TopBar
 *   - Skipped: lib/prompts/novel-promotion/*.zh.txt (those are LLM
 *     inputs, user said "主要是介面就好")
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { Converter } from 'opencc-js'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, '_migration-out')

// Walk roots — kept narrow so we don't accidentally rewrite unrelated
// chrome / admin / asset-hub files in this pass.
const SCAN_ROOTS = [
  'src/app/[locale]/v2',
  'src/components/v2',
]
const SCAN_FILES = [
  'src/components/Navbar.tsx',
]

const CJK_RANGE = /[㐀-䶿一-鿿]/
const CJK_GLOBAL = /[㐀-䶿一-鿿]/g

// Convert tw → cn (we treat user's "tw → cn" intent as the Taiwan
// traditional → Mainland simplified transform; opencc-js does
// character-level conversion in this mode — sufficient for UI strings).
const tw2cn = Converter({ from: 'tw', to: 'cn' })

function listTsxFiles(root) {
  const out = []
  function walk(p) {
    let st
    try { st = statSync(p) } catch { return }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e))
    } else if (st.isFile() && (p.endsWith('.tsx') || p.endsWith('.ts'))) {
      out.push(p)
    }
  }
  walk(root)
  return out
}

/**
 * Strip block + line comments so CJK in JSDoc / inline comments
 * doesn't show up in the extracted strings list. Regex-only — we
 * don't have nested block comments in this codebase.
 */
function stripComments(src) {
  return src
    // /* ... */ block comments (non-greedy, multiline)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // // line comments — only when // is at start-of-line or follows
    // whitespace. This avoids stripping `https://` URLs.
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/**
 * Yields { type, raw, content } for every CJK-containing string-ish
 * occurrence in the source. type ∈ 'jsx-text' | 'string-literal' |
 * 'template-literal'. Used to drive the extraction map.
 */
function* findCJKStrings(src) {
  const stripped = stripComments(src)

  // 1. JSX text content. Conservative: only match content that contains
  // CJK, sits between `>` and `<`, and has no { } in it (no embedded
  // expressions). Trims leading/trailing whitespace.
  //
  // Regex doesn't fully understand JSX nesting, but for our codebase
  // the false positive rate is low because we only emit when the
  // matched content contains CJK.
  const jsxTextRe = />([^<>{}]*[㐀-䶿一-鿿][^<>{}]*)</g
  let m
  while ((m = jsxTextRe.exec(stripped))) {
    const trimmed = m[1].trim()
    if (trimmed) yield { type: 'jsx-text', raw: m[0], content: trimmed }
  }

  // 2. String literals with CJK. Both single- and double-quoted. Skip
  // import paths (we already strip comments; imports won't have CJK).
  const sLit = /(['"])((?:\\.|[^\\\1])*?[㐀-䶿一-鿿][^\1]*?)\1/gs
  while ((m = sLit.exec(stripped))) {
    yield { type: 'string-literal', raw: m[0], content: m[2] }
  }

  // 3. Template literals with CJK. Skip ones where the only CJK lives
  // inside ${} (those are computed and out of scope for static
  // extraction).
  const tplLit = /`((?:\\.|[^\\`])*?[㐀-䶿一-鿿](?:\\.|[^\\`])*?)`/gs
  while ((m = tplLit.exec(stripped))) {
    const body = m[1]
    // If the only CJK is inside a ${...} expression, skip — those
    // typically reference variables we can't migrate without an AST
    // pass.
    const exprStripped = body.replace(/\$\{[^}]*\}/g, '')
    if (CJK_RANGE.test(exprStripped)) {
      yield { type: 'template-literal', raw: m[0], content: body }
    }
  }
}

function countCJKChars(s) {
  const m = s.match(CJK_GLOBAL)
  return m ? m.length : 0
}

function main() {
  const targets = []
  for (const root of SCAN_ROOTS) {
    targets.push(...listTsxFiles(join(ROOT, root)))
  }
  for (const f of SCAN_FILES) {
    targets.push(join(ROOT, f))
  }

  const extracted = {} // path → [{ type, content }]
  const extractedHans = {}
  const stats = { totalFiles: 0, filesWithCJK: 0, totalKeys: 0, totalCjkChars: 0, byFile: [] }

  for (const path of targets) {
    stats.totalFiles += 1
    const rel = relative(ROOT, path)
    let src
    try { src = readFileSync(path, 'utf8') } catch { continue }
    if (!CJK_RANGE.test(src)) continue

    const found = []
    const seen = new Set() // dedupe within file
    for (const hit of findCJKStrings(src)) {
      const key = `${hit.type}::${hit.content}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ type: hit.type, content: hit.content })
    }
    if (found.length === 0) continue

    stats.filesWithCJK += 1
    stats.totalKeys += found.length

    extracted[rel] = found
    extractedHans[rel] = found.map((f) => ({
      type: f.type,
      content: f.content,
      simplified: tw2cn(f.content),
    }))

    const fileChars = found.reduce((acc, f) => acc + countCJKChars(f.content), 0)
    stats.totalCjkChars += fileChars
    stats.byFile.push({ file: rel, keys: found.length, chars: fileChars })
  }

  stats.byFile.sort((a, b) => b.keys - a.keys)

  // Write outputs.
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'extracted-zh-Hant.json'), JSON.stringify(extracted, null, 2))
  writeFileSync(join(OUT_DIR, 'extracted-zh-Hans.json'), JSON.stringify(extractedHans, null, 2))
  writeFileSync(join(OUT_DIR, 'by-file-stats.json'), JSON.stringify(stats, null, 2))

  // Console report — quick eyeball for the user.
  console.log('=== migrate-traditional-to-simplified · DRY RUN ===')
  console.log(`scope             : ${SCAN_ROOTS.join(', ')} + ${SCAN_FILES.length} extra`)
  console.log(`files scanned     : ${stats.totalFiles}`)
  console.log(`files with CJK    : ${stats.filesWithCJK}`)
  console.log(`unique CJK strings: ${stats.totalKeys}`)
  console.log(`total CJK chars   : ${stats.totalCjkChars}`)
  console.log('')
  console.log('top 15 files by string count:')
  for (const row of stats.byFile.slice(0, 15)) {
    console.log(`  ${row.keys.toString().padStart(4)} keys  ${row.chars.toString().padStart(5)} chars  ${row.file}`)
  }
  console.log('')
  console.log(`outputs written to: ${relative(ROOT, OUT_DIR)}/`)
  console.log(`  extracted-zh-Hant.json — original strings as found`)
  console.log(`  extracted-zh-Hans.json — same set after OpenCC tw→cn`)
  console.log(`  by-file-stats.json     — file-by-file counts`)
  console.log('')
  console.log('next: review extracted-zh-Hans.json by hand,')
  console.log('      then run with --apply to rewrite .tsx (not yet implemented).')
}

main()

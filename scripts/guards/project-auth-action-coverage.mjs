#!/usr/bin/env node
/**
 * Phase 12.5 (2026-05-22) — Project auth action coverage guard.
 *
 * `requireProjectAuth` and `requireProjectAuthLight` accept an optional
 * `{ action: 'read' | 'write' }` option. After the 8-tier cascade upgrade
 * the helpers default to `'write'` so any mutation endpoint is safe by
 * default. GET handlers MUST opt-in to `'read'` — otherwise a viewer-role
 * collaborator gets 403 on the GET, breaking the whole point of giving
 * them read access.
 *
 * This guard:
 *   - Walks every route.ts under src/app/api/
 *   - Finds GET handlers (`export const GET` / `export async function GET`)
 *   - Inside each GET handler body, finds requireProjectAuth* calls
 *   - Verifies the call passes `action: 'read'`
 *
 * Fails when a GET handler calls requireProjectAuth*(projectId) without
 * the read action — meaning the GET would default to write-enforcement
 * and reject viewer reads.
 *
 * Wire into test:guards so CI catches new endpoints that forget the rule.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const API_ROOT = path.join(ROOT, 'src/app/api')

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (entry.isFile() && entry.name === 'route.ts') files.push(full)
  }
  return files
}

/**
 * Extract function body for a GET handler from source. Returns the substring
 * between the GET handler's opening brace and the matching closing brace.
 * Returns null if no GET handler in the file.
 *
 * Tolerant of both `export const GET = apiHandler(async (...) => { ... })`
 * and `export async function GET(...) { ... }` patterns.
 */
function extractGetHandler(source) {
  // Match start of handler: either form
  const starts = [
    /export\s+const\s+GET\s*=/g,
    /export\s+async\s+function\s+GET\s*\(/g,
  ]
  let startIdx = -1
  for (const re of starts) {
    const m = re.exec(source)
    if (m) {
      startIdx = m.index
      break
    }
  }
  if (startIdx === -1) return null

  // Find the first '{' after the start of the handler signature, then
  // brace-match to the closing '}'. Naive: doesn't handle braces inside
  // strings / regexes / comments. Adequate for the guard's purpose —
  // false positives are easy to spot.
  let depth = 0
  let bodyStart = -1
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') {
      if (depth === 0) bodyStart = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && bodyStart !== -1) {
        return source.slice(bodyStart, i + 1)
      }
    }
  }
  return null
}

const violations = []
for (const file of walk(API_ROOT)) {
  const src = fs.readFileSync(file, 'utf8')
  const getBody = extractGetHandler(src)
  if (!getBody) continue

  // Find requireProjectAuth* calls in the GET body that DON'T pass action:'read'
  const callRe = /requireProjectAuth(Light)?\s*\(\s*projectId\s*([,)])/g
  let m
  while ((m = callRe.exec(getBody)) !== null) {
    const afterArg = m[2] // either `,` (more args coming) or `)` (one-arg call)
    if (afterArg === ')') {
      // No options arg at all — defaults to 'write', wrong for GET.
      violations.push({
        file: path.relative(ROOT, file),
        reason: 'GET handler calls requireProjectAuth* without { action: \'read\' } — defaults to write, will 403 viewer reads',
        callMatch: m[0],
      })
    } else {
      // Has options arg — check if action:'read' is present in the next ~120 chars
      const tail = getBody.slice(m.index, m.index + 200)
      if (!/action\s*:\s*['"]read['"]/.test(tail)) {
        violations.push({
          file: path.relative(ROOT, file),
          reason: 'GET handler passes options object but does not include action: \'read\'',
          callMatch: tail.slice(0, 80) + '...',
        })
      }
    }
  }
}

if (violations.length === 0) {
  console.log('[project-auth-action-coverage] OK — every GET handler opt-in to read action')
  process.exit(0)
}

console.error('[project-auth-action-coverage] FAILED — GET handlers missing { action: \'read\' }:')
for (const v of violations) {
  console.error(`  - ${v.file}`)
  console.error(`      ${v.reason}`)
  console.error(`      call: ${v.callMatch}`)
}
console.error('')
console.error('Fix: pass { action: \'read\' } to requireProjectAuth* in the GET handler.')
console.error('Without it, the helper defaults to action=\'write\' and any viewer-role')
console.error('collaborator gets 403 on a read endpoint — defeating the Phase 12.5')
console.error('Decision 2A (same-workspace members can read others\' projects).')
process.exit(1)

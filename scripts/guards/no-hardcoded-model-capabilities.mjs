#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const scanRoots = ['src']
const allowConstantDefinitionsIn = new Set([
  'src/lib/constants.ts',
])
const forbiddenCapabilityConstants = [
  'VIDEO_MODELS',
  'FIRST_LAST_FRAME_MODELS',
  'AUDIO_SUPPORTED_MODELS',
  'BANANA_MODELS',
  'BANANA_RESOLUTION_OPTIONS',
]

function fail(title, details = []) {
  console.error(`\n[no-hardcoded-model-capabilities] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

function toRel(fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/')
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, out)
      continue
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      out.push(fullPath)
    }
  }
  return out
}

const files = scanRoots.flatMap((scanRoot) => walk(path.join(root, scanRoot)))
const violations = []

for (const fullPath of files) {
  const relPath = toRel(fullPath)
  if (allowConstantDefinitionsIn.has(relPath)) continue

  const lines = fs.readFileSync(fullPath, 'utf8').split('\n')
  let inBlockComment = false
  for (let index = 0; index < lines.length; index += 1) {
    // Strip comments before scanning: a prose mention of these constants
    // (e.g. a docstring explaining why a file is separate from constants.ts's
    // VIDEO_MODELS) is documentation, not hardcoded usage. Only real code is
    // checked — actual imports/usages in code are still caught.
    let line = lines[index]
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end === -1) continue
      line = line.slice(end + 2)
      inBlockComment = false
    }
    line = line.replace(/\/\*.*?\*\//g, ' ')
    const blockOpen = line.indexOf('/*')
    if (blockOpen !== -1) {
      inBlockComment = true
      line = line.slice(0, blockOpen)
    }
    const lineComment = line.indexOf('//')
    if (lineComment !== -1) line = line.slice(0, lineComment)

    for (const token of forbiddenCapabilityConstants) {
      const tokenPattern = new RegExp(`\\b${token}\\b`)
      if (tokenPattern.test(line)) {
        violations.push(`${relPath}:${index + 1} forbidden hardcoded model capability token ${token}`)
      }
    }
  }
}

if (violations.length > 0) {
  fail('Found hardcoded model capability usage', violations)
}

console.log('[no-hardcoded-model-capabilities] OK')

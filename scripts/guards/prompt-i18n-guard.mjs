#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const scanRoots = ['src', 'scripts']
const allowedPromptTemplateReaders = new Set([
  'src/lib/prompt-i18n/template-store.ts',
  'scripts/guards/prompt-i18n-guard.mjs',
  'scripts/guards/prompt-semantic-regression.mjs',
  'scripts/guards/prompt-ab-regression.mjs',
  'scripts/guards/prompt-json-canary-guard.mjs',
  // Guard that scans prompt templates for Seedance red-line tokens — must read them directly.
  'scripts/guards/seedance-prompt-redline-guard.mjs',
  // V2 zh-Hant→zh-Hans i18n migration tool; only *mentions* lib/prompts in a skip comment,
  // its readFileSync targets V2 .tsx files (false positive on the readFileSync+path heuristic).
  'scripts/migrate-traditional-to-simplified.mjs',
])
const languageDirectiveAllowList = new Set([
  'scripts/guards/prompt-i18n-guard.mjs',
])
const languageDirectivePattern = /请用中文|中文输出|use Chinese|output in Chinese/i

function fail(title, details = []) {
  console.error(`\n[prompt-i18n-guard] ${title}`)
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
    out.push(fullPath)
  }
  return out
}

function listSourceFiles() {
  return scanRoots
    .flatMap((scanRoot) => walk(path.join(root, scanRoot)))
    .filter((fullPath) => sourceExtensions.has(path.extname(fullPath)))
}

function collectDirectPromptReadViolations() {
  const violations = []
  const files = listSourceFiles()
  for (const filePath of files) {
    const relPath = toRel(filePath)
    if (allowedPromptTemplateReaders.has(relPath)) continue
    const content = fs.readFileSync(filePath, 'utf8')
    const hasReadFileSync = /\breadFileSync\s*\(/.test(content)
    if (!hasReadFileSync) continue
    const hasPromptPathToken =
      content.includes('lib/prompts')
      || (
        /['"]lib['"]/.test(content)
        && /['"]prompts['"]/.test(content)
      )
    if (hasPromptPathToken) {
      violations.push(`${relPath} direct prompt file read is forbidden; use buildPrompt/getPromptTemplate`)
    }
  }
  return violations
}

function collectLanguageDirectiveViolations() {
  const violations = []

  for (const filePath of listSourceFiles()) {
    const relPath = toRel(filePath)
    if (languageDirectiveAllowList.has(relPath)) continue
    const lines = fs.readFileSync(filePath, 'utf8').split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (languageDirectivePattern.test(line)) {
        violations.push(`${relPath}:${index + 1} hardcoded language directive is forbidden`)
      }
    }
  }

  const promptFiles = walk(path.join(root, 'lib', 'prompts'))
    .filter((fullPath) => fullPath.endsWith('.en.txt'))
  for (const filePath of promptFiles) {
    const relPath = toRel(filePath)
    const lines = fs.readFileSync(filePath, 'utf8').split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (languageDirectivePattern.test(line)) {
        violations.push(`${relPath}:${index + 1} English template cannot require Chinese output`)
      }
    }
  }

  return violations
}

function collectLegacyPromptFiles() {
  return walk(path.join(root, 'lib', 'prompts'))
    .map((fullPath) => toRel(fullPath))
    .filter((relPath) => relPath.endsWith('.txt') && !relPath.endsWith('.zh.txt') && !relPath.endsWith('.en.txt'))
}

// Mirror the runtime interpolator (src/lib/prompt-i18n/build-prompt.ts):
// buildPrompt substitutes both {key} and {{key}} where key matches [A-Za-z0-9_]+.
// Anything else inside braces (JSON examples like {"name": ...}, {start,end},
// {name: "x"}) is NOT a placeholder and must be ignored — it never gets substituted.
const SINGLE_PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g
const DOUBLE_PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g

function extractPlaceholders(template) {
  const keys = new Set()
  for (const match of template.matchAll(SINGLE_PLACEHOLDER_PATTERN)) {
    if (match[1]) keys.add(match[1])
  }
  for (const match of template.matchAll(DOUBLE_PLACEHOLDER_PATTERN)) {
    if (match[1]) keys.add(match[1])
  }
  return keys
}

// Diff the {placeholder} token sets between each zh/en pair. A zh template
// that injects {target_panel_count} while its en counterpart lacks it (the
// 2026-06-03 bug) means the en-locale .replace() binds nothing — the LLM
// sees a missing rule. The catalog-coverage check only verifies BOTH files
// EXIST; this verifies they declare the SAME substitution slots.
function collectPlaceholderAsymmetries() {
  const violations = []
  const zhFiles = walk(path.join(root, 'lib', 'prompts')).filter((fullPath) =>
    fullPath.endsWith('.zh.txt'),
  )
  for (const zhPath of zhFiles) {
    const enPath = zhPath.replace(/\.zh\.txt$/, '.en.txt')
    // Missing-pair is enforced by verifyPromptCatalogCoverage; skip here to
    // avoid double-reporting. Only diff when both exist.
    if (!fs.existsSync(enPath)) continue
    const zhKeys = extractPlaceholders(fs.readFileSync(zhPath, 'utf8'))
    const enKeys = extractPlaceholders(fs.readFileSync(enPath, 'utf8'))
    const zhOnly = [...zhKeys].filter((key) => !enKeys.has(key)).sort()
    const enOnly = [...enKeys].filter((key) => !zhKeys.has(key)).sort()
    if (zhOnly.length > 0 || enOnly.length > 0) {
      const stem = toRel(zhPath).replace(/\.zh\.txt$/, '')
      const parts = []
      if (zhOnly.length > 0) parts.push(`zh-only: ${zhOnly.join(', ')}`)
      if (enOnly.length > 0) parts.push(`en-only: ${enOnly.join(', ')}`)
      violations.push(`${stem}: ${parts.join(' | ')}`)
    }
  }
  return violations
}

function verifyPromptCatalogCoverage() {
  const catalogPath = path.join(root, 'src', 'lib', 'prompt-i18n', 'catalog.ts')
  if (!fs.existsSync(catalogPath)) {
    fail('Missing prompt catalog file', ['src/lib/prompt-i18n/catalog.ts'])
  }

  const catalogText = fs.readFileSync(catalogPath, 'utf8')
  const stems = Array.from(catalogText.matchAll(/pathStem:\s*'([^']+)'/g)).map((match) => match[1])
  if (stems.length === 0) {
    fail('No prompt pathStem found in catalog.ts')
  }

  const missing = []
  for (const stem of stems) {
    const zhPath = path.join(root, 'lib', 'prompts', `${stem}.zh.txt`)
    const enPath = path.join(root, 'lib', 'prompts', `${stem}.en.txt`)
    if (!fs.existsSync(zhPath)) {
      missing.push(`missing zh template: lib/prompts/${stem}.zh.txt`)
    }
    if (!fs.existsSync(enPath)) {
      missing.push(`missing en template: lib/prompts/${stem}.en.txt`)
    }
  }

  if (missing.length > 0) {
    fail('Prompt template coverage check failed', missing)
  }
}

const legacyPromptFiles = collectLegacyPromptFiles()
if (legacyPromptFiles.length > 0) {
  fail('Legacy prompt files found (.txt without locale suffix)', legacyPromptFiles)
}

verifyPromptCatalogCoverage()

const placeholderAsymmetries = collectPlaceholderAsymmetries()
if (placeholderAsymmetries.length > 0) {
  fail('Prompt placeholder sets differ between zh/en templates', placeholderAsymmetries)
}

const promptReadViolations = collectDirectPromptReadViolations()
if (promptReadViolations.length > 0) {
  fail('Found direct prompt template reads', promptReadViolations)
}

const languageViolations = collectLanguageDirectiveViolations()
if (languageViolations.length > 0) {
  fail('Found hardcoded language directives', languageViolations)
}

console.log('[prompt-i18n-guard] OK')

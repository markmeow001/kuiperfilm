/**
 * BobAPI key character-level forensics.
 *
 * BobAPI is calling our key "Invalid token" but supplier swears it's
 * valid. Common cause: invisible characters slipped in during paste
 * (zero-width space, BOM, full-width dash, line separator, NBSP).
 *
 * Dumps:
 *  - length + hex of first/last 8 bytes
 *  - any char outside [a-zA-Z0-9-_] flagged loudly
 *  - leading/trailing whitespace
 *  - reconstruction guide so user can verify char-by-char against
 *    what supplier sent in their IM message
 *
 * Run inside the prod container:
 *   docker exec kuiper-app npx tsx scripts/taijiai-key-forensics.ts
 */

import { getProviderConfig } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'

function inspectChar(ch: string, position: string): string {
  const code = ch.charCodeAt(0)
  const hex = code.toString(16).padStart(4, '0').toUpperCase()
  const safe = /^[a-zA-Z0-9\-_]$/.test(ch)
  const flag = safe ? ' ' : '!'
  const name = safe ? ch : describeChar(code)
  return `  [${position}] U+${hex} ${flag} ${name}`
}

function describeChar(code: number): string {
  if (code === 0x20) return '(SPACE)'
  if (code === 0x09) return '(TAB)'
  if (code === 0x0A) return '(LF — newline)'
  if (code === 0x0D) return '(CR — carriage return)'
  if (code === 0xA0) return '(NBSP — non-breaking space)'
  if (code === 0xFEFF) return '(BOM — byte order mark)'
  if (code === 0x200B) return '(ZWSP — zero-width space)'
  if (code === 0x200C) return '(ZWNJ)'
  if (code === 0x200D) return '(ZWJ)'
  if (code === 0x2028) return '(LINE SEPARATOR)'
  if (code === 0x2029) return '(PARAGRAPH SEPARATOR)'
  if (code === 0x2010 || code === 0x2011 || code === 0x2012 || code === 0x2013 || code === 0x2014) return '(NON-ASCII DASH — should be hyphen-minus U+002D)'
  if (code === 0xFF0D) return '(FULL-WIDTH HYPHEN-MINUS — wrong, should be ASCII)'
  if (code === 0x2018 || code === 0x2019) return '(SMART SINGLE QUOTE)'
  if (code === 0x201C || code === 0x201D) return '(SMART DOUBLE QUOTE)'
  if (code < 0x20) return `(CTRL char code ${code})`
  if (code >= 0x7F && code <= 0x9F) return `(CTRL char code ${code})`
  return `(${String.fromCharCode(code)} — unusual)`
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    console.error('[FAIL] No admin user.')
    process.exit(2)
  }
  console.log(`[forensics] admin: ${admin.name} (${admin.id})\n`)

  const { apiKey } = await getProviderConfig(admin.id, 'taijiai')

  console.log('─'.repeat(70))
  console.log('KEY OVERVIEW')
  console.log('─'.repeat(70))
  console.log(`  length:          ${apiKey.length}`)
  console.log(`  starts with sk-: ${apiKey.startsWith('sk-')}`)
  console.log(`  first 10 chars:  ${JSON.stringify(apiKey.slice(0, 10))}`)
  console.log(`  last 10 chars:   ${JSON.stringify(apiKey.slice(-10))}`)
  console.log()

  console.log('─'.repeat(70))
  console.log('WHITESPACE CHECK')
  console.log('─'.repeat(70))
  const trimmed = apiKey.trim()
  console.log(`  has leading whitespace:  ${apiKey !== apiKey.trimStart()}`)
  console.log(`  has trailing whitespace: ${apiKey !== apiKey.trimEnd()}`)
  if (apiKey.length !== trimmed.length) {
    console.log(`  trimmed length:          ${trimmed.length} (orig ${apiKey.length})`)
  }
  console.log()

  console.log('─'.repeat(70))
  console.log('CHARACTER-BY-CHARACTER (full)')
  console.log('─'.repeat(70))
  for (let i = 0; i < apiKey.length; i++) {
    console.log(inspectChar(apiKey[i], `${i.toString().padStart(2, ' ')}`))
  }
  console.log()

  console.log('─'.repeat(70))
  console.log('SUSPICIOUS CHARS SUMMARY')
  console.log('─'.repeat(70))
  let suspicious = 0
  for (let i = 0; i < apiKey.length; i++) {
    const ch = apiKey[i]
    if (!/^[a-zA-Z0-9\-_]$/.test(ch)) {
      console.log(`  position ${i}: U+${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()} — ${describeChar(ch.charCodeAt(0))}`)
      suspicious++
    }
  }
  if (suspicious === 0) {
    console.log('  ✓ All chars are valid sk- token charset [a-zA-Z0-9_-]')
    console.log('  → key looks clean; problem is genuinely on BobAPI side (token disabled / wrong group / IP blocked)')
  } else {
    console.log(`  ✗ ${suspicious} suspicious char(s) found above`)
    console.log('  → likely paste corruption; re-copy from a plain-text source (NOT WeChat / 飛書 / 釘釘 message)')
  }
  console.log()

  console.log('─'.repeat(70))
  console.log('FIRST 16 BYTES HEX DUMP')
  console.log('─'.repeat(70))
  const buf = Buffer.from(apiKey.slice(0, 16), 'utf8')
  console.log(`  ${[...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
  console.log()

  console.log('─'.repeat(70))
  console.log('LAST 16 BYTES HEX DUMP')
  console.log('─'.repeat(70))
  const tail = Buffer.from(apiKey.slice(-16), 'utf8')
  console.log(`  ${[...tail].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
}

main()
  .catch((err) => {
    console.error('\n[CRASH]', err)
    process.exit(99)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

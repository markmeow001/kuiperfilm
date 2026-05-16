/**
 * Regression: resolveErrorDisplay must NEVER return a message that
 * contains raw Prisma / SQL internals to the UI.
 *
 * 2026-05-16 /qa-only (F-QA-1) found that the storyboard step rendered:
 *
 *   "上次分析失敗:Invalid `prisma.novelPromotionVoiceLine.create()`
 *    invocation: Foreign key constraint violated on the fields:
 *    (`matchedPanelId`)"
 *
 * The UI was reading `task.errorMessage` (raw) instead of routing
 * through resolveErrorDisplay → getUserMessageByCode. This test
 * verifies the resolver maps a few known Prisma-shaped strings to a
 * code in the unified set and produces a user-facing message that is
 * scrubbed of ORM/DB internals.
 */
import { describe, expect, it } from 'vitest'
import { resolveErrorDisplay } from '@/lib/errors/display'

const PRISMA_LEAK_PATTERNS = [/prisma\./i, /matchedPanelId/, /foreign key constraint/i, /\$queryRaw/i]

function assertNoPrismaLeak(message: string) {
  for (const pattern of PRISMA_LEAK_PATTERNS) {
    expect(message, `message leaked Prisma pattern ${pattern}: ${message}`).not.toMatch(pattern)
  }
}

describe('resolveErrorDisplay — Prisma leak prevention (F-QA-1)', () => {
  it('scrubs Foreign key constraint Prisma error string', () => {
    const display = resolveErrorDisplay({
      code: null,
      message:
        'Invalid `prisma.novelPromotionVoiceLine.create()` invocation: Foreign key constraint violated on the fields: (`matchedPanelId`)',
    })

    expect(display, 'resolveErrorDisplay must not return null when message is present').not.toBeNull()
    assertNoPrismaLeak(display!.message)
  })

  it('scrubs unique constraint Prisma error string', () => {
    const display = resolveErrorDisplay({
      code: null,
      message:
        'Invalid `prisma.user.create()` invocation: Unique constraint failed on the fields: (`email`)',
    })

    expect(display).not.toBeNull()
    assertNoPrismaLeak(display!.message)
  })

  it('scrubs $queryRaw error leak', () => {
    const display = resolveErrorDisplay({
      code: null,
      message: 'PrismaClientUnknownRequestError: $queryRaw failed: ...',
    })

    expect(display).not.toBeNull()
    assertNoPrismaLeak(display!.message)
  })

  it('returns null when both code and message are empty (no false positive banners)', () => {
    expect(resolveErrorDisplay({ code: null, message: null })).toBeNull()
    expect(resolveErrorDisplay({ code: '', message: '' })).toBeNull()
  })

  it('preserves friendly mapping for known business codes (e.g. INSUFFICIENT_BALANCE)', () => {
    const display = resolveErrorDisplay({
      code: 'INSUFFICIENT_BALANCE',
      message: 'Insufficient balance',
    })
    expect(display?.code).toBe('INSUFFICIENT_BALANCE')
    expect(display?.message).toMatch(/余额|余額|balance/i)
  })

  it('preserves friendly mapping for SENSITIVE_CONTENT inferred from message', () => {
    const display = resolveErrorDisplay({
      code: null,
      message: 'Prompt blocked by safety filter: sensitive content',
    })
    expect(display?.code).toBe('SENSITIVE_CONTENT')
    expect(display?.message).toMatch(/敏感/)
  })
})

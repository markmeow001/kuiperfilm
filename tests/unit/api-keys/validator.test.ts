/**
 * Bearer-token validator tests — Phase 5 (2026-05-25).
 *
 * Covers the unified failure shape across every auth-failure mode +
 * the happy path. Prisma is mocked so we don't depend on a live DB.
 *
 * Why these matter: every public-API request hits this validator
 * first. A regression that, say, accepts revoked keys or leaks
 * workspace data via a wrong shape is a real outage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { validateApiKey } from '@/lib/api-keys/validator'
import { generateApiKey } from '@/lib/api-keys/generator'

afterEach(() => {
  prismaMock.apiKey.findUnique.mockReset()
  prismaMock.apiKey.update.mockReset()
})

function dbRow(opts: {
  generated: ReturnType<typeof generateApiKey>
  revokedAt?: Date | null
  expiresAt?: Date | null
  scopes?: string
  reqPerMinute?: number
}) {
  return {
    id: 'apikey-id-1',
    keyHash: opts.generated.keyHash,
    scopes: opts.scopes ?? JSON.stringify(['read', 'scripts.write']),
    reqPerMinute: opts.reqPerMinute ?? 60,
    monthlyCredit: null,
    revokedAt: opts.revokedAt ?? null,
    expiresAt: opts.expiresAt ?? null,
    workspaceId: 'ws-1',
    createdById: 'user-1',
    keyLast4: opts.generated.keyLast4,
  }
}

describe('validateApiKey', () => {
  it('returns MISSING_AUTH_HEADER when no header provided', async () => {
    const result = await validateApiKey(null)
    expect(result).toEqual({ ok: false, code: 'MISSING_AUTH_HEADER', status: 401 })
    expect(prismaMock.apiKey.findUnique).not.toHaveBeenCalled()
  })

  it('returns MISSING_AUTH_HEADER for empty string', async () => {
    const result = await validateApiKey('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('MISSING_AUTH_HEADER')
  })

  it('returns INVALID_KEY_FORMAT for non-kfk garbage', async () => {
    const result = await validateApiKey('Bearer not-a-kuiper-key')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_KEY_FORMAT')
    expect(prismaMock.apiKey.findUnique).not.toHaveBeenCalled()
  })

  it('returns KEY_NOT_FOUND when DB has no matching prefix', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValueOnce(null)
    const k = generateApiKey()
    const result = await validateApiKey(`Bearer ${k.fullKey}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('KEY_NOT_FOUND')
  })

  it('returns KEY_NOT_FOUND (not a distinct code) on hash mismatch', async () => {
    // Same prefix, different secret — should look identical from the
    // outside so attackers can't enumerate valid prefixes by timing.
    const stored = generateApiKey()
    const presented = generateApiKey()
    prismaMock.apiKey.findUnique.mockResolvedValueOnce(dbRow({ generated: stored }))
    const result = await validateApiKey(`Bearer ${presented.fullKey}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('KEY_NOT_FOUND')
  })

  it('returns KEY_REVOKED when revokedAt is set', async () => {
    const k = generateApiKey()
    prismaMock.apiKey.findUnique.mockResolvedValueOnce(
      dbRow({ generated: k, revokedAt: new Date('2020-01-01') }),
    )
    const result = await validateApiKey(`Bearer ${k.fullKey}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('KEY_REVOKED')
  })

  it('returns KEY_EXPIRED when expiresAt is in the past', async () => {
    const k = generateApiKey()
    prismaMock.apiKey.findUnique.mockResolvedValueOnce(
      dbRow({ generated: k, expiresAt: new Date(Date.now() - 1000) }),
    )
    const result = await validateApiKey(`Bearer ${k.fullKey}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('KEY_EXPIRED')
  })

  it('returns ok with resolved context on the happy path', async () => {
    const k = generateApiKey()
    prismaMock.apiKey.findUnique.mockResolvedValueOnce(dbRow({ generated: k }))
    const result = await validateApiKey(`Bearer ${k.fullKey}`)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.workspaceId).toBe('ws-1')
      expect(result.scopes).toEqual(['read', 'scripts.write'])
      expect(result.reqPerMinute).toBe(60)
      expect(result.apiKeyId).toBe('apikey-id-1')
    }
  })

  it('accepts a bare kfk_… key without the Bearer prefix', async () => {
    const k = generateApiKey()
    prismaMock.apiKey.findUnique.mockResolvedValueOnce(dbRow({ generated: k }))
    const result = await validateApiKey(k.fullKey)
    expect(result.ok).toBe(true)
  })

  it('treats malformed scope JSON as zero scopes (logged, not crashing)', async () => {
    const k = generateApiKey()
    prismaMock.apiKey.findUnique.mockResolvedValueOnce(
      dbRow({ generated: k, scopes: 'not-json{{' }),
    )
    const result = await validateApiKey(`Bearer ${k.fullKey}`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.scopes).toEqual([])
  })
})

/**
 * API key generator + parser + verifier — Phase 5 (2026-05-25).
 *
 * The format invariants are security-critical: a regression that
 * shortens the secret, switches charsets, or breaks the constant-time
 * compare opens the door to brute-force / timing attacks. These tests
 * pin the shape so a future refactor can't silently regress.
 */
import { describe, expect, it } from 'vitest'
import {
  generateApiKey,
  parseKeyPrefix,
  verifyApiKey,
} from '@/lib/api-keys/generator'

describe('generateApiKey', () => {
  it('produces the documented kfk_<prefix-8>_<secret-32> format', () => {
    const k = generateApiKey()
    // Brand prefix + 8-char body + underscore + 32-char secret = 45.
    expect(k.fullKey).toHaveLength(45)
    expect(k.fullKey).toMatch(/^kfk_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/)
    expect(k.keyPrefix).toMatch(/^kfk_[A-Za-z0-9]{8}$/)
    expect(k.keyLast4).toHaveLength(4)
    expect(k.fullKey.endsWith(k.keyLast4)).toBe(true)
  })

  it('produces SHA-256 hex hash (64 lowercase hex chars)', () => {
    const k = generateApiKey()
    expect(k.keyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique keys across many invocations', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      seen.add(generateApiKey().fullKey)
    }
    expect(seen.size).toBe(200)
  })
})

describe('parseKeyPrefix', () => {
  it('extracts the prefix segment from a well-formed key', () => {
    const k = generateApiKey()
    expect(parseKeyPrefix(k.fullKey)).toBe(k.keyPrefix)
  })

  it('returns null for missing kfk_ brand', () => {
    expect(parseKeyPrefix('pfk_abcdefgh_xyz')).toBeNull()
    expect(parseKeyPrefix('xxxxxxxx')).toBeNull()
    expect(parseKeyPrefix('')).toBeNull()
  })

  it('returns null when prefix segment is not exactly 8 chars', () => {
    expect(parseKeyPrefix('kfk_abc_xxx')).toBeNull()
    expect(parseKeyPrefix('kfk_abcdefghi_xxx')).toBeNull()
  })

  it('returns null when prefix contains non-base62 chars', () => {
    expect(parseKeyPrefix('kfk_abc-defg_xxx')).toBeNull()
    expect(parseKeyPrefix('kfk_abc!defg_xxx')).toBeNull()
  })
})

describe('verifyApiKey', () => {
  it('returns true for a key that matches its stored hash', () => {
    const k = generateApiKey()
    expect(verifyApiKey(k.fullKey, k.keyHash)).toBe(true)
  })

  it('returns false for a key that does not match', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(verifyApiKey(a.fullKey, b.keyHash)).toBe(false)
  })

  it('returns false for a hash of wrong length (defensive)', () => {
    const k = generateApiKey()
    expect(verifyApiKey(k.fullKey, 'tooshort')).toBe(false)
    expect(verifyApiKey(k.fullKey, k.keyHash.slice(0, 32))).toBe(false)
  })

  it('returns false for a key that differs by a single character', () => {
    const k = generateApiKey()
    // Flip the last character to something guaranteed-different.
    const lastChar = k.fullKey.slice(-1)
    const swapped = lastChar === 'A' ? 'B' : 'A'
    const tampered = k.fullKey.slice(0, -1) + swapped
    expect(verifyApiKey(tampered, k.keyHash)).toBe(false)
  })
})

/**
 * Scope enforcement tests — Phase 5 (2026-05-25).
 *
 * Permission decisions ride on these helpers, so we pin both the
 * happy paths and the failure shapes (which surface to API consumers
 * as their 403 response body).
 */
import { describe, expect, it } from 'vitest'
import {
  requireScope,
  requireAnyScope,
} from '@/lib/api-keys/scope-check'
import type { ValidatedApiKey } from '@/lib/api-keys/validator'

function makeKey(scopes: ValidatedApiKey['scopes']): ValidatedApiKey {
  return {
    ok: true,
    apiKeyId: 'test-key-id',
    workspaceId: 'ws-1',
    scopes,
    reqPerMinute: 60,
    monthlyCredit: null,
    createdById: 'user-1',
    keyLast4: 'aaaa',
  }
}

describe('requireScope', () => {
  it('returns ok when the key grants the required scope', () => {
    const result = requireScope(makeKey(['read', 'scripts.write']), 'read')
    expect(result).toEqual({ ok: true })
  })

  it('returns INSUFFICIENT_SCOPE with required + granted echoed back', () => {
    const result = requireScope(makeKey(['read']), 'scripts.write')
    expect(result).toEqual({
      ok: false,
      code: 'INSUFFICIENT_SCOPE',
      status: 403,
      required: 'scripts.write',
      granted: ['read'],
    })
  })

  it('does not infer read from any .write scope (least privilege)', () => {
    // Even though scripts.write logically implies reading the scripts
    // you wrote, we deliberately do NOT cross-grant — keeps the
    // permission matrix dead simple to audit.
    const result = requireScope(makeKey(['scripts.write']), 'read')
    expect(result.ok).toBe(false)
  })
})

describe('requireAnyScope', () => {
  it('returns ok if any of the listed scopes is granted', () => {
    const result = requireAnyScope(makeKey(['storyboards.write']), [
      'read',
      'storyboards.write',
    ])
    expect(result).toEqual({ ok: true })
  })

  it('returns INSUFFICIENT_SCOPE reporting required[0] as canonical', () => {
    const result = requireAnyScope(makeKey([]), ['read', 'scripts.write'])
    expect(result).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_SCOPE',
      status: 403,
      required: 'read',
    })
  })
})

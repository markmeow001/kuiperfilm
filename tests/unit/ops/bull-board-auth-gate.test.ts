/**
 * F4 regression: Bull-Board startup must fail-closed.
 *
 * Bull-Board exposes full queue state plus job-promotion / drain /
 * fail controls, so reaching it unauth = privilege escalation. The
 * gate refuses to start in any of these cases:
 *
 *   - only one of BULL_BOARD_USER / BULL_BOARD_PASSWORD set
 *   - NODE_ENV=production with no auth
 *   - non-loopback host bind with no auth
 *
 * Dev convenience is preserved: NODE_ENV !== 'production' + loopback
 * host + no auth → permitted.
 */
import { describe, expect, it } from 'vitest'
import { evaluateBullBoardAuthGate } from '@/lib/ops/bull-board-auth-gate'

describe('evaluateBullBoardAuthGate', () => {
  it('permits dev loopback without auth', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'development',
      host: '127.0.0.1',
      authUser: undefined,
      authPassword: undefined,
    })
    expect(decision).toEqual({ ok: true, authConfigured: false })
  })

  it('permits dev localhost without auth', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'development',
      host: 'localhost',
      authUser: undefined,
      authPassword: undefined,
    })
    expect(decision).toEqual({ ok: true, authConfigured: false })
  })

  it('refuses production with no auth (the prod fail-open bug)', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'production',
      host: '127.0.0.1',
      authUser: undefined,
      authPassword: undefined,
    })
    expect(decision.ok).toBe(false)
    expect(decision).toMatchObject({
      reason: 'prod-or-non-loopback-without-auth',
    })
  })

  it('refuses production with empty-string auth (env var fallback fail-open)', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'production',
      host: '0.0.0.0',
      authUser: '',
      authPassword: '',
    })
    expect(decision.ok).toBe(false)
    expect(decision).toMatchObject({
      reason: 'prod-or-non-loopback-without-auth',
    })
  })

  it('refuses non-loopback bind with no auth (even in dev)', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'development',
      host: '0.0.0.0',
      authUser: undefined,
      authPassword: undefined,
    })
    expect(decision.ok).toBe(false)
    expect(decision).toMatchObject({
      reason: 'prod-or-non-loopback-without-auth',
    })
  })

  it('refuses partial creds — user only', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'production',
      host: '0.0.0.0',
      authUser: 'ops',
      authPassword: undefined,
    })
    expect(decision.ok).toBe(false)
    expect(decision).toMatchObject({ reason: 'partial-credentials' })
  })

  it('refuses partial creds — password only', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'production',
      host: '0.0.0.0',
      authUser: undefined,
      authPassword: 'hunter2',
    })
    expect(decision.ok).toBe(false)
    expect(decision).toMatchObject({ reason: 'partial-credentials' })
  })

  it('permits production with both creds set', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'production',
      host: '0.0.0.0',
      authUser: 'ops',
      authPassword: 'a-very-long-random-string',
    })
    expect(decision).toEqual({ ok: true, authConfigured: true })
  })

  it('permits ::1 IPv6 loopback in dev without auth', () => {
    const decision = evaluateBullBoardAuthGate({
      nodeEnv: 'development',
      host: '::1',
      authUser: undefined,
      authPassword: undefined,
    })
    expect(decision).toEqual({ ok: true, authConfigured: false })
  })
})

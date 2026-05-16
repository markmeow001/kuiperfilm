/**
 * Regression: /api/cos/image must require authentication.
 *
 * 2026-05-15 /cso audit (F1) flagged this as HIGH IDOR. The route used to
 * be fully anonymous: anyone with a COS key (leaked via Caddy access logs,
 * shared URLs, screenshots, browser history) could hit
 *   /api/cos/image?key=<key>
 * and get a 24h signed URL for the underlying file, bypassing every
 * per-route auth guard the rest of the app installs.
 *
 * This test pins the auth gate. Full ownership validation (user A
 * shouldn't sign user B's keys even when both are logged in) is tracked
 * as a follow-up in memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

vi.mock('@/lib/cos', () => ({
  getSignedUrl: vi.fn(() => 'https://example.com/signed'),
  toFetchableUrl: (u: string) => u,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/api/cos/image auth gate', () => {
  it('returns 401 when no session (no signed URL leak)', async () => {
    mockUnauthenticated()
    const { GET } = await import('@/app/api/cos/image/route')
    const res = await callRoute(GET, {
      path: '/api/cos/image?key=images/secret.jpg',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(401)
    // Critical: must not redirect to a signed URL when unauthenticated.
    // 307 / 302 / 308 here means the bug regressed.
    expect([301, 302, 303, 307, 308]).not.toContain(res.status)
  })

  it('passes auth gate for an authenticated user', async () => {
    mockAuthenticated('user-A')
    const { GET } = await import('@/app/api/cos/image/route')
    const res = await callRoute(GET, {
      path: '/api/cos/image?key=images/test.jpg',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    // Should now reach the signing step. Whatever the response code, it
    // must NOT be 401 (the gate passed).
    expect(res.status).not.toBe(401)
  })

  it('returns 400 when authenticated but key is missing', async () => {
    mockAuthenticated('user-A')
    const { GET } = await import('@/app/api/cos/image/route')
    const res = await callRoute(GET, {
      path: '/api/cos/image',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(400)
  })
})

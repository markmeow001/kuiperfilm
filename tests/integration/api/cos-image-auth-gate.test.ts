/**
 * Regression: /api/cos/image is fail-closed.
 *
 * 2026-05-15 /cso F1 audit found this route was fully anonymous and
 * signed URLs for any COS key. The first patch (commit efdb4fd) added
 * requireUserAuth so anonymous requests get 401.
 *
 * 2026-05-16 F1 residual: even with auth, a logged-in user A could
 * sign a URL for user B's key if A knew the key string. Rather than
 * implement a key-prefix → projectId → owner check for an unused
 * endpoint (codebase has zero callers; the active path is
 * /api/cos/sign), we fail-closed: 403 to every authenticated request
 * and log the access attempt so ops can decide whether to delete the
 * endpoint outright after 30 days.
 *
 * This test pins both the auth gate AND the fail-closed behavior.
 * If anyone re-enables the redirect path here without doing proper
 * ownership validation, this test fires.
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

describe('/api/cos/image gating', () => {
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

  it('returns 403 when authenticated (F1 residual fail-closed)', async () => {
    mockAuthenticated('user-A')
    const { GET } = await import('@/app/api/cos/image/route')
    const res = await callRoute(GET, {
      path: '/api/cos/image?key=images/panel-candidate-abc-12345.jpg',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('FORBIDDEN')
    // Must NOT redirect — that was the cross-tenant IDOR path.
    expect([301, 302, 303, 307, 308]).not.toContain(res.status)
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

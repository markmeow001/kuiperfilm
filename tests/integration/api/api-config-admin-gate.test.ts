/**
 * Regression: /api/user/api-config GET must be admin-only.
 *
 * 2026-05-02 audit found that the GET handler was using requireUserAuth
 * (any logged-in user passes), which leaked admin's decrypted Tencent
 * VOD / OpenRouter / Fal keys to non-admin team members via the
 * admin-fallback path. Anyone could open DevTools → Console and run
 *   fetch('/api/user/api-config').then(r=>r.json())
 * to see the keys in plaintext.
 *
 * The frontend (profile/page.tsx) already gates the ApiConfigTab
 * behind isAdmin; this test asserts the API enforces the same
 * boundary so the F12 path is also closed.
 *
 * PUT was already admin-gated; we just check it stays that way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockRole,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>(async () => null),
  },
  user: {
    findFirst: vi.fn(async () => null),
  },
}))

const billingMock = vi.hoisted(() => ({
  getBillingMode: vi.fn(async () => 'OFF'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing/mode', () => billingMock)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  prismaMock.userPreference.findUnique.mockResolvedValue(null)
  prismaMock.user.findFirst.mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/user/api-config admin gate', () => {
  it('returns 403 for member role (no API key leak via F12)', async () => {
    mockRole('member')

    const { GET } = await import('@/app/api/user/api-config/route')
    const res = await callRoute(GET, {
      path: '/api/user/api-config',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(403)
    // Critical: prisma must NOT have been queried — the gate should
    // short-circuit before any decrypt/admin-fallback work runs.
    expect(prismaMock.userPreference.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it('returns 403 for editor role (only admin should see provider keys)', async () => {
    mockRole('editor')

    const { GET } = await import('@/app/api/user/api-config/route')
    const res = await callRoute(GET, {
      path: '/api/user/api-config',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(403)
  })

  it('passes the auth gate for admin role', async () => {
    mockRole('admin')

    const { GET } = await import('@/app/api/user/api-config/route')
    const res = await callRoute(GET, {
      path: '/api/user/api-config',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    // Admin auth passes — handler runs (may still 200 with empty data
    // since prisma is mocked to return null). Whatever we get back,
    // it must NOT be 403.
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('shows Atlas Seed Audio character pricing instead of an unavailable placeholder', async () => {
    mockRole('admin')
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: JSON.stringify([
        {
          modelId: 'bytedance/seed-audio-1.0',
          modelKey: 'atlascloud::bytedance/seed-audio-1.0',
          name: 'Seed Audio 1.0 (AtlasCloud)',
          type: 'audio',
          provider: 'atlascloud',
          enabled: true,
        },
      ]),
      customProviders: null,
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      lipSyncModel: null,
      capabilityDefaults: null,
    })

    const { GET } = await import('@/app/api/user/api-config/route')
    const res = await callRoute(GET, {
      path: '/api/user/api-config',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      models: Array<{ modelKey: string; priceLabel?: string }>
      pricingDisplay: Record<string, { label: string }>
    }
    const model = body.models.find((entry) => entry.modelKey === 'atlascloud::bytedance/seed-audio-1.0')
    expect(model?.priceLabel).toBe('$0.015 / 1K chars')
    expect(body.pricingDisplay['audio::atlascloud::bytedance/seed-audio-1.0']?.label)
      .toBe('$0.015 / 1K chars')
  })
})

/**
 * Regression: /api/user-preference must never return apiKey strings to the
 * client.
 *
 * 2026-05-15 audit found that GET handler returned the raw UserPreference
 * row, which includes:
 *   - llmApiKey / falApiKey / googleAiKey / arkApiKey / qwenApiKey
 *     (legacy single-provider columns)
 *   - customProviders (JSON string) — each entry can carry an `apiKey`
 *     field with encrypted ciphertext
 *
 * Even encrypted ciphertext shouldn't reach the client — it pairs with the
 * server-side API_ENCRYPTION_KEY and leaked ciphertexts widen the attack
 * surface across key rotations. The route now strips apiKey from
 * customProviders and nulls the *ApiKey columns before returning.
 *
 * Companion to `api-config-admin-gate.test.ts` which closed the same
 * F12-leak class on a different endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const SAMPLE_ENCRYPTED_KEY = 'iv:tag:ciphertext'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    upsert: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/user-preference secrets sanitization', () => {
  it('strips apiKey from customProviders before returning', async () => {
    prismaMock.userPreference.upsert.mockResolvedValue({
      id: 'p1',
      userId: 'user-A',
      llmApiKey: null,
      falApiKey: null,
      googleAiKey: null,
      arkApiKey: null,
      qwenApiKey: null,
      customProviders: JSON.stringify([
        {
          id: 'tencent-vod',
          name: '騰訊雲 VOD AIGC',
          baseUrl: 'https://vod.tencentcloudapi.com',
          apiKey: SAMPLE_ENCRYPTED_KEY,
        },
        {
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: SAMPLE_ENCRYPTED_KEY,
        },
      ]),
    })

    const { GET } = await import('@/app/api/user-preference/route')
    const res = await callRoute(GET, {
      path: '/api/user-preference',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    const raw = JSON.stringify(body)

    // No occurrence of the encrypted key string anywhere in the response.
    expect(raw).not.toContain(SAMPLE_ENCRYPTED_KEY)

    // customProviders entries keep id/name/baseUrl but lose apiKey.
    const providers = JSON.parse(body.preference.customProviders)
    expect(providers).toHaveLength(2)
    for (const p of providers) {
      expect(p.id).toBeTruthy()
      expect(p).not.toHaveProperty('apiKey')
    }
  })

  it('nulls *ApiKey columns even if DB has values', async () => {
    prismaMock.userPreference.upsert.mockResolvedValue({
      id: 'p1',
      userId: 'user-A',
      llmApiKey: SAMPLE_ENCRYPTED_KEY,
      falApiKey: SAMPLE_ENCRYPTED_KEY,
      googleAiKey: SAMPLE_ENCRYPTED_KEY,
      arkApiKey: SAMPLE_ENCRYPTED_KEY,
      qwenApiKey: SAMPLE_ENCRYPTED_KEY,
      customProviders: null,
    })

    const { GET } = await import('@/app/api/user-preference/route')
    const res = await callRoute(GET, {
      path: '/api/user-preference',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preference.llmApiKey).toBeNull()
    expect(body.preference.falApiKey).toBeNull()
    expect(body.preference.googleAiKey).toBeNull()
    expect(body.preference.arkApiKey).toBeNull()
    expect(body.preference.qwenApiKey).toBeNull()
    // Also assert the ciphertext doesn't appear anywhere in the response.
    expect(JSON.stringify(body)).not.toContain(SAMPLE_ENCRYPTED_KEY)
  })

  it('drops customProviders entirely if JSON is malformed (fail closed)', async () => {
    prismaMock.userPreference.upsert.mockResolvedValue({
      id: 'p1',
      userId: 'user-A',
      llmApiKey: null,
      falApiKey: null,
      googleAiKey: null,
      arkApiKey: null,
      qwenApiKey: null,
      customProviders: '{not-valid-json',
    })

    const { GET } = await import('@/app/api/user-preference/route')
    const res = await callRoute(GET, {
      path: '/api/user-preference',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preference.customProviders).toBeNull()
  })
})

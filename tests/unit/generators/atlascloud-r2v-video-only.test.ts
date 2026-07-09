/**
 * AtlasCloud Seedance 2.0 R2V — reference-video-only submission.
 *
 * 2026-07-09 bug: the Playground "參考影片生成" flow lets a user bind ONLY a
 * reference video (動作參考 / motion reference) with zero reference images.
 * The generator hard-required ≥1 reference_image and threw
 *   "AtlasCloud …reference-to-video 需要至少 1 張 reference_images…"
 * before ever calling AtlasCloud. That thrown message matches no
 * normalizeAnyError pattern, so the client scrubbed it into the opaque
 * "系统内部错误，请稍后重试" the user saw.
 *
 * Ground truth: the AtlasCloud r2v OpenAPI schema
 *   static.atlascloud.ai/model/schema/bytedance-seedance-2.0-reference-to-video.json
 * lists ONLY `model` as required. reference_images is optional; a
 * reference_videos-only call is valid. So the guard was wrong.
 *
 * These tests lock the corrected contract:
 *   - video-only r2v submits successfully (no reference_images key, has
 *     reference_videos)
 *   - a call with neither images nor videos still fails fast with a clear
 *     message (audio-only is not a valid visual reference).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const apiConfigMock = vi.hoisted(() => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'atlas-key' })),
}))

vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

import { AtlasCloudSeedanceVideoGenerator } from '@/lib/generators/video/atlascloud'

function stubFetchCapturing(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pred_r2v_1', status: 'created' }),
      text: async () => '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies }
}

describe('AtlasCloud R2V — reference-video-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'atlas-key' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits successfully with ONLY reference_videos (0 reference images)', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '', // Playground passes '' when no reference images uploaded
      prompt: '飄浮碎塊緩緩上升，鏡頭運動流暢',
      options: {
        modelId: 'seedance-2.0-r2v',
        duration: 10,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceVideos: ['https://r2.example.com/video/playground-ref/u/x.mp4?sig=fake'],
      },
    })

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('ATLASCLOUD:VIDEO:pred_r2v_1')

    const body = bodies.at(0)
    if (!body) throw new Error('fetch should have been called with a body')
    expect(body.model).toBe('bytedance/seedance-2.0/reference-to-video')
    expect(body.reference_videos).toEqual([
      'https://r2.example.com/video/playground-ref/u/x.mp4?sig=fake',
    ])
    // No images were provided — reference_images must be omitted, not an
    // empty array (the schema treats [] and absent differently).
    expect(body.reference_images).toBeUndefined()
  })

  it('fails fast with a clear message when NO visual reference (no images, no videos)', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p',
      options: {
        modelId: 'seedance-2.0-r2v',
        // audio-only is not a valid r2v visual reference per the schema
        referenceAudios: ['https://r2.example.com/voice/a.mp3?sig=fake'],
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/reference_images|reference_videos/)
  })
})

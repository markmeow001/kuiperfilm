/**
 * AtlasCloud Seedance 2.5 — schema contract tests.
 *
 * Ground truth (verified 2026-08-07):
 *   static.atlascloud.ai/model/schema/bytedance-seedance-2.5-{text,image,reference}-to-video.json
 *
 * 2.5 vs 2.0 differences the generator must honor:
 *   - new `output_format` ("mp4" | "mov")
 *   - duration enum: -1 (auto) or 4..30 integer seconds
 *   - i2v ratio enum is exactly ["adaptive"] — generator always sends adaptive
 *   - r2v reference caps grow to 30 images / 10 videos / 10 audios
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
      json: async () => ({ id: 'pred_sd25_1', status: 'created' }),
      text: async () => '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies }
}

describe('AtlasCloud Seedance 2.5', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'atlas-key' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('t2v submits v2-family body with output_format / watermark / return_last_frame', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '海邊日出，鏡頭緩慢推進',
      options: {
        modelId: 'seedance-2.5-t2v',
        duration: 30,
        aspectRatio: '21:9',
        resolution: '720p',
        outputFormat: 'mov',
        watermark: true,
        returnLastFrame: true,
      },
    })
    expect(result.success).toBe(true)
    expect(bodies[0]).toMatchObject({
      model: 'bytedance/seedance-2.5/text-to-video',
      duration: 30,
      resolution: '720p',
      ratio: '21:9',
      output_format: 'mov',
      watermark: true,
      return_last_frame: true,
    })
    expect(bodies[0]).not.toHaveProperty('camera_fixed')
    expect(bodies[0]).not.toHaveProperty('seed')
  })

  it('accepts duration -1 (auto) and omits output_format when not set', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '城市夜景',
      options: { modelId: 'seedance-2.5-t2v', duration: -1, aspectRatio: 'adaptive' },
    })
    expect(result.success).toBe(true)
    expect(bodies[0].duration).toBe(-1)
    expect(bodies[0].ratio).toBe('adaptive')
    expect(bodies[0]).not.toHaveProperty('output_format')
  })

  it.each([3, 31, 5.5])('rejects out-of-enum duration %s', async (duration) => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'x',
      options: { modelId: 'seedance-2.5-t2v', duration, aspectRatio: '16:9' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/duration 需為 -1 \(auto\) 或 4-30/)
  })

  it('rejects a ratio outside the 2.5 enum for t2v', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'x',
      options: { modelId: 'seedance-2.5-t2v', duration: 5, aspectRatio: '4:5' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/比例僅支援/)
  })

  it('rejects an invalid output_format', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'x',
      options: { modelId: 'seedance-2.5-t2v', duration: 5, aspectRatio: '16:9', outputFormat: 'webm' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/output_format 僅支援 mp4 \/ mov/)
  })

  it('i2v always sends ratio=adaptive (schema enum) regardless of the UI pick', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://cos.example.com/first-frame.png',
      prompt: '畫面動起來',
      options: {
        modelId: 'seedance-2.5-i2v',
        duration: 8,
        aspectRatio: '16:9',
        lastFrameImageUrl: 'https://cos.example.com/last-frame.png',
      },
    })
    expect(result.success).toBe(true)
    expect(bodies[0]).toMatchObject({
      model: 'bytedance/seedance-2.5/image-to-video',
      ratio: 'adaptive',
      image: 'https://cos.example.com/first-frame.png',
      last_image: 'https://cos.example.com/last-frame.png',
    })
  })

  it('r2v accepts up to 30 reference images (2.5 cap) and rejects 31', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const thirty = Array.from({ length: 30 }, (_v, i) => `https://cos.example.com/ref-${i}.png`)
    const ok = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'image 1 的角色走進場景',
      options: { modelId: 'seedance-2.5-r2v', duration: 10, aspectRatio: '9:16', referenceImages: thirty },
    })
    expect(ok.success).toBe(true)
    expect((bodies[0].reference_images as string[]).length).toBe(30)

    const over = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'x',
      options: {
        modelId: 'seedance-2.5-r2v',
        duration: 10,
        aspectRatio: '9:16',
        referenceImages: [...thirty, 'https://cos.example.com/ref-30.png'],
      },
    })
    expect(over.success).toBe(false)
    expect(over.error).toMatch(/reference_images 最多 30 張/)
  })

  it('keeps the 2.0 r2v caps at 9 images (regression guard)', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const ten = Array.from({ length: 10 }, (_v, i) => `https://cos.example.com/ref-${i}.png`)
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'x',
      options: { modelId: 'seedance-2.0-r2v', duration: 10, aspectRatio: '9:16', referenceImages: ten },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/reference_images 最多 9 張/)
  })
})

/**
 * AtlasCloud Kling Video O3 (std/pro) reference-to-video (2026-07-10).
 *
 * New model family on the shared AtlasCloud generator. Kling O3's input
 * schema is DISJOINT from Seedance 2.0 — it binds named subjects via
 * `elements` (≤6, each: element_name + reference_type='image_refer' +
 * frontal_image + refer_images ≤4), takes plain `images` (≤7), uses
 * `aspect_ratio` (not `ratio`), `sound` (not `generate_audio`), and has
 * NO resolution / watermark / return_last_frame / seed / camera_fixed.
 *
 * Locked contracts:
 *  - catalog ids map to the PAID slugs (no "-test" suffix — the schema
 *    CDN default carries "-test" which is AtlasCloud's sandbox, verified
 *    against the model detail page 2026-07-10)
 *  - Kling branch never leaks Seedance body fields
 *  - element assembly: frontal_image = first image, refer_images = all
 *    (schema requires BOTH fields for image_refer)
 *  - schema-true guards only (elements ≤6, element images 1–4,
 *    images ≤7, duration 3–15, prompt required)
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
      json: async () => ({ id: 'pred_kling_1', status: 'created' }),
      text: async () => '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies }
}

const ELEMENTS = [
  { name: 'Vera', imageUrls: ['https://r2.example.com/vera-front.png', 'https://r2.example.com/vera-side.png'] },
  { name: '古宅', imageUrls: ['https://r2.example.com/mansion.png'] },
]

describe('AtlasCloud Kling O3 R2V', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'atlas-key' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['kling-o3-std-r2v', 'kwaivgi/kling-video-o3-std/reference-to-video'],
    ['kling-o3-pro-r2v', 'kwaivgi/kling-video-o3-pro/reference-to-video'],
  ])('%s maps to paid slug %s (no -test suffix)', async (modelId, slug) => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '<<<element_1>>> 走進 <<<element_2>>>',
      options: { modelId, klingElements: ELEMENTS },
    })

    expect(result.success).toBe(true)
    expect(result.externalId).toBe('ATLASCLOUD:VIDEO:pred_kling_1')
    const body = bodies.at(0)
    if (!body) throw new Error('fetch not called')
    expect(body.model).toBe(slug)
    expect(String(body.model)).not.toMatch(/-test$/)
  })

  it('assembles elements: frontal_image = first image, refer_images = all', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()

    await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p <<<element_1>>>',
      options: { modelId: 'kling-o3-pro-r2v', klingElements: ELEMENTS },
    })

    const body = bodies.at(0)
    if (!body) throw new Error('fetch not called')
    expect(body.elements).toEqual([
      {
        element_name: 'Vera',
        reference_type: 'image_refer',
        frontal_image: 'https://r2.example.com/vera-front.png',
        refer_images: ['https://r2.example.com/vera-front.png', 'https://r2.example.com/vera-side.png'],
      },
      {
        element_name: '古宅',
        reference_type: 'image_refer',
        frontal_image: 'https://r2.example.com/mansion.png',
        refer_images: ['https://r2.example.com/mansion.png'],
      },
    ])
  })

  it('never leaks Seedance body fields', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()

    await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p',
      options: {
        modelId: 'kling-o3-std-r2v',
        klingElements: ELEMENTS,
        duration: 10,
        aspectRatio: '9:16',
        resolution: '720p', // playground always sends this — Kling must drop it
      },
    })

    const body = bodies.at(0)
    if (!body) throw new Error('fetch not called')
    expect(body.aspect_ratio).toBe('9:16')
    expect(body.duration).toBe(10)
    expect(body.sound).toBe(false)
    for (const leaked of [
      'ratio', 'generate_audio', 'resolution', 'watermark',
      'return_last_frame', 'reference_images', 'reference_videos',
      'camera_fixed', 'seed', 'image', 'last_image',
    ]) {
      expect(body[leaked], `field ${leaked} must not be sent to Kling O3`).toBeUndefined()
    }
  })

  it('passes plain reference images as `images` (and imageUrl fallback works)', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()

    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://r2.example.com/lead.png',
      prompt: 'p',
      options: {
        modelId: 'kling-o3-pro-r2v',
        referenceImages: ['https://r2.example.com/a.png', 'https://r2.example.com/b.png'],
      },
    })

    const body = bodies.at(0)
    if (!body) throw new Error('fetch not called')
    expect(body.images).toEqual(['https://r2.example.com/a.png', 'https://r2.example.com/b.png'])
    expect(body.elements).toBeUndefined()
  })

  it('sound option forwards as `sound: true`', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p',
      options: { modelId: 'kling-o3-std-r2v', klingElements: ELEMENTS, generateAudio: true },
    })
    expect(bodies.at(0)?.sound).toBe(true)
  })

  it.each([
    ['7 elements', { klingElements: Array.from({ length: 7 }, (_, i) => ({ name: `E${i}`, imageUrls: ['https://x/1.png'] })) }, /elements 最多 6/],
    ['element with 0 images', { klingElements: [{ name: 'Vera', imageUrls: [] }] }, /1-4 張/],
    ['element with 5 images', { klingElements: [{ name: 'Vera', imageUrls: ['a', 'b', 'c', 'd', 'e'].map((s) => `https://x/${s}.png`) }] }, /1-4 張/],
    ['duration 16', { klingElements: ELEMENTS, duration: 16 }, /duration/i],
    ['duration 2', { klingElements: ELEMENTS, duration: 2 }, /duration/i],
  ])('schema-true guard: %s fails fast', async (_label, extraOptions, pattern) => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p',
      options: { modelId: 'kling-o3-pro-r2v', ...extraOptions },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(pattern)
  })

  it('requires a prompt', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '',
      options: { modelId: 'kling-o3-std-r2v', klingElements: ELEMENTS },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/prompt/)
  })
})

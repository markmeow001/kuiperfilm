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

  it('wires a reference video into the `video` field (with keep_original_sound default)', async () => {
    // 2026-07-10 review HIGH-1: reference videos were silently dropped for
    // Kling O3 (the UI collects one, the schema HAS a `video` field, but the
    // body builder never read it). Silent drops violate CLAUDE.md §3 — and
    // the schema supports it, so wire it through instead of rejecting.
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()

    await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p',
      options: {
        modelId: 'kling-o3-pro-r2v',
        klingElements: ELEMENTS,
        referenceVideos: ['https://r2.example.com/video/motion.mp4?sig=fake'],
      },
    })

    const body = bodies.at(0)
    if (!body) throw new Error('fetch not called')
    expect(body.video).toBe('https://r2.example.com/video/motion.mp4?sig=fake')
  })

  it('with a reference video, plain images cap drops to 4 (schema rule)', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p',
      options: {
        modelId: 'kling-o3-std-r2v',
        referenceVideos: ['https://x/v.mp4'],
        referenceImages: ['a', 'b', 'c', 'd', 'e'].map((s) => `https://x/${s}.png`),
      },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/4 張/)
  })

  it('rejects aspect ratios outside the Kling enum (16:9 / 9:16 / 1:1)', async () => {
    // 2026-07-10 review HIGH-2: the shared UI offers 4:3/3:4/4:5 which the
    // Kling schema enum does not accept — fail fast with a clear message
    // instead of a raw provider 400.
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'p',
      options: { modelId: 'kling-o3-pro-r2v', klingElements: ELEMENTS, aspectRatio: '4:3' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/16:9|9:16|1:1/)
  })

  it('unknown non-empty modelId throws instead of silently falling back to v1.5-pro', async () => {
    // Pre-existing hazard surfaced by the chain-trace review: a typo'd
    // modelId used to silently generate on seedance-v1.5-pro and bill for
    // it. Explicit failure per CLAUDE.md 不隱式回退. (Absent modelId keeps
    // the legacy default for old callers.)
    stubFetchCapturing()
    const generator = new AtlasCloudSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://x/lead.png',
      prompt: 'p',
      options: { modelId: 'kling-o3-typo-r2v' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/未知.*modelId|unknown/i)
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

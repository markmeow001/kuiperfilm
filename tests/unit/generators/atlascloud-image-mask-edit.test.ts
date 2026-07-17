/**
 * AtlasCloud gpt-image-1 局部重绘 (mask inpainting, 2026-07-17).
 *
 * gpt-image-1 is the ONLY AtlasCloud image model whose /edit schema declares
 * `mask_image` ("fully transparent areas indicate where image should be
 * edited") — verified against the schema CDN; gpt-image-2/edit and the
 * nano-banana family have no mask field.
 *
 * Locked contracts:
 *  - gpt-image-1 resolves to openai/gpt-image-1/{text-to-image,edit}
 *  - the edit body uses `image` (NOT gpt-image-2's `images`) + `mask_image`
 *  - a mask on a non-mask model rejects explicitly (不静默吞错 — the gateway
 *    would silently drop the field and repaint the whole picture)
 *  - a mask without a source plate rejects explicitly
 *  - gpt-image-1's 3-value size enum maps from our aspectRatio convention
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

import {
  AtlasCloudImageGenerator,
  aspectRatioToGptImage1Size,
  resolveAtlasCloudImageModel,
} from '@/lib/generators/image/atlascloud'

function stubFetchCapturing(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pred_mask_1', status: 'created' }),
      text: async () => '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies }
}

const PLATE = 'https://cos.example.com/images/plate.png?sign=abc'
const MASK = 'https://cos.example.com/images/mask.png?sign=def'

describe('AtlasCloud gpt-image-1 mask edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'atlas-key' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves gpt-image-1 to its verified slugs', () => {
    expect(resolveAtlasCloudImageModel('gpt-image-1', false)).toBe('openai/gpt-image-1/text-to-image')
    expect(resolveAtlasCloudImageModel('gpt-image-1', true)).toBe('openai/gpt-image-1/edit')
  })

  it('maps aspect ratios into the 3-value gpt-image-1 size enum', () => {
    expect(aspectRatioToGptImage1Size('16:9')).toBe('1536x1024')
    expect(aspectRatioToGptImage1Size('9:16')).toBe('1024x1536')
    expect(aspectRatioToGptImage1Size('1:1')).toBe('1024x1024')
    expect(aspectRatioToGptImage1Size(undefined)).toBe('1024x1024')
  })

  it('mask + plate -> /edit body with `image` array + `mask_image`', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    const result = await generator.generate({
      userId: 'u1',
      prompt: '把背景换成雨夜霓虹街道',
      referenceImages: [PLATE],
      options: { modelId: 'gpt-image-1', aspectRatio: '9:16', maskImage: MASK },
    })
    expect(result.success).toBe(true)
    expect(result.externalId).toBe('ATLASCLOUD:IMAGE:pred_mask_1')
    expect(bodies).toHaveLength(1)
    const body = bodies[0]
    expect(body.model).toBe('openai/gpt-image-1/edit')
    // gpt-image-1/edit declares `image` — sending gpt-image-2's `images`
    // would be silently ignored by the gateway.
    expect(body.image).toEqual([PLATE])
    expect(body.images).toBeUndefined()
    expect(body.mask_image).toBe(MASK)
    expect(body.size).toBe('1024x1536')
  })

  it('mask on a model without mask_image in its schema -> explicit reject', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    const result = await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [PLATE],
      options: { modelId: 'nano-banana-pro', maskImage: MASK },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('不支持局部重绘')
  })

  it('mask without a source plate -> explicit reject', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    const result = await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [],
      options: { modelId: 'gpt-image-1', maskImage: MASK },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('需要底图')
  })

  it('plain img2img on gpt-image-1 (no mask) still uses `image` and omits mask_image', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [PLATE],
      options: { modelId: 'gpt-image-1', aspectRatio: '1:1' },
    })
    expect(bodies[0].image).toEqual([PLATE])
    expect(bodies[0].mask_image).toBeUndefined()
  })
})

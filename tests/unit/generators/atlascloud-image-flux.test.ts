/**
 * AtlasCloud FLUX 系列 (Black Forest Labs, 2026-07-27).
 *
 * Slugs verified against the schema CDN (static.atlascloud.ai/model/schema/*):
 *  - flux-2-pro / flux-2-flex / flux-2-dev → black-forest-labs/flux-2-<v>/text-to-image
 *    与 .../edit (star-separated free-form `size`, edit consumes `images: string[]`)
 *  - flux-kontext-pro / flux-kontext-max  → t2i = .../text-to-image (aspect_ratio
 *    9-value enum), edit = BARE slug (black-forest-labs/flux-kontext-<v>) whose
 *    schema declares a SINGLE `image: string` — not an array
 *  - flux-1.1-pro / flux-1.1-pro-ultra    → bare slug, t2i only (5-value
 *    aspect_ratio enum, no edit variant)
 *
 * Locked contracts:
 *  - kontext edit takes exactly ONE reference; >1 rejects explicitly
 *    (不静默丢参考图)
 *  - flux-1.1 with references rejects explicitly (无 img2img 变体, 不隐式回退)
 *  - flux-2 body uses star-separated size mapped from our aspectRatio convention
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
  resolveAtlasCloudImageModel,
  normaliseFluxKontextRatio,
  normaliseFlux11Ratio,
} from '@/lib/generators/image/atlascloud'

function stubFetchCapturing(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pred_flux_1', status: 'created' }),
      text: async () => '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies }
}

const REF_A = 'https://cos.example.com/images/ref-a.png?sign=abc'
const REF_B = 'https://cos.example.com/images/ref-b.png?sign=def'

describe('AtlasCloud FLUX slug resolution', () => {
  it('resolves flux-2 family to /text-to-image and /edit slugs', () => {
    expect(resolveAtlasCloudImageModel('flux-2-pro', false)).toBe('black-forest-labs/flux-2-pro/text-to-image')
    expect(resolveAtlasCloudImageModel('flux-2-pro', true)).toBe('black-forest-labs/flux-2-pro/edit')
    expect(resolveAtlasCloudImageModel('flux-2-flex', false)).toBe('black-forest-labs/flux-2-flex/text-to-image')
    expect(resolveAtlasCloudImageModel('flux-2-flex', true)).toBe('black-forest-labs/flux-2-flex/edit')
    expect(resolveAtlasCloudImageModel('flux-2-dev', false)).toBe('black-forest-labs/flux-2-dev/text-to-image')
    expect(resolveAtlasCloudImageModel('flux-2-dev', true)).toBe('black-forest-labs/flux-2-dev/edit')
  })

  it('resolves kontext: t2i suffixed, edit is the BARE slug', () => {
    expect(resolveAtlasCloudImageModel('flux-kontext-pro', false)).toBe('black-forest-labs/flux-kontext-pro/text-to-image')
    expect(resolveAtlasCloudImageModel('flux-kontext-pro', true)).toBe('black-forest-labs/flux-kontext-pro')
    expect(resolveAtlasCloudImageModel('flux-kontext-max', false)).toBe('black-forest-labs/flux-kontext-max/text-to-image')
    expect(resolveAtlasCloudImageModel('flux-kontext-max', true)).toBe('black-forest-labs/flux-kontext-max')
  })

  it('resolves flux-1.1 to bare t2i-only slugs', () => {
    expect(resolveAtlasCloudImageModel('flux-1.1-pro', false)).toBe('black-forest-labs/flux-1.1-pro')
    expect(resolveAtlasCloudImageModel('flux-1.1-pro-ultra', false)).toBe('black-forest-labs/flux-1.1-pro-ultra')
  })
})

describe('FLUX ratio normalisers', () => {
  it('kontext accepts its 9-value enum and maps 2:1 → 21:9', () => {
    expect(normaliseFluxKontextRatio('16:9')).toBe('16:9')
    expect(normaliseFluxKontextRatio('9:21')).toBe('9:21')
    expect(normaliseFluxKontextRatio('2:1')).toBe('21:9')
    expect(normaliseFluxKontextRatio('5:7')).toBeUndefined()
    expect(normaliseFluxKontextRatio(undefined)).toBeUndefined()
  })

  it('flux-1.1 accepts its 5-value enum and maps wider/taller aliases inward', () => {
    expect(normaliseFlux11Ratio('1:1')).toBe('1:1')
    expect(normaliseFlux11Ratio('16:9')).toBe('16:9')
    expect(normaliseFlux11Ratio('3:2')).toBe('4:3')
    expect(normaliseFlux11Ratio('2:3')).toBe('3:4')
    expect(normaliseFlux11Ratio('21:9')).toBe('16:9')
    expect(normaliseFlux11Ratio('2:1')).toBe('16:9')
    expect(normaliseFlux11Ratio('9:21')).toBe('9:16')
    expect(normaliseFlux11Ratio('1:2')).toBe('9:16')
    expect(normaliseFlux11Ratio('5:7')).toBeUndefined()
  })
})

describe('AtlasCloud FLUX request bodies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'atlas-key' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flux-2 t2i: star-separated size from aspectRatio', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    const result = await generator.generate({
      userId: 'u1',
      prompt: '雨夜霓虹街道',
      referenceImages: [],
      options: { modelId: 'flux-2-pro', aspectRatio: '16:9' },
    })
    expect(result.success).toBe(true)
    expect(result.externalId).toBe('ATLASCLOUD:IMAGE:pred_flux_1')
    expect(bodies[0].model).toBe('black-forest-labs/flux-2-pro/text-to-image')
    expect(bodies[0].size).toBe('2048*1152')
    expect(bodies[0].images).toBeUndefined()
  })

  it('flux-2 edit: references pass through `images` array', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [REF_A, REF_B],
      options: { modelId: 'flux-2-flex', aspectRatio: '1:1' },
    })
    expect(bodies[0].model).toBe('black-forest-labs/flux-2-flex/edit')
    expect(bodies[0].images).toEqual([REF_A, REF_B])
    expect(bodies[0].image).toBeUndefined()
  })

  it('kontext t2i: aspect_ratio from the 9-value enum, no size field', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [],
      options: { modelId: 'flux-kontext-pro', aspectRatio: '2:1' },
    })
    expect(bodies[0].model).toBe('black-forest-labs/flux-kontext-pro/text-to-image')
    expect(bodies[0].aspect_ratio).toBe('21:9')
    expect(bodies[0].size).toBeUndefined()
  })

  it('kontext edit: single ref goes through `image` as a STRING, no aspect_ratio', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    await generator.generate({
      userId: 'u1',
      prompt: 'To ghibli style',
      referenceImages: [REF_A],
      options: { modelId: 'flux-kontext-max', aspectRatio: '16:9' },
    })
    expect(bodies[0].model).toBe('black-forest-labs/flux-kontext-max')
    expect(bodies[0].image).toBe(REF_A)
    expect(bodies[0].images).toBeUndefined()
    // The bare kontext edit schema declares no aspect_ratio — over-sending
    // risks a gateway 400.
    expect(bodies[0].aspect_ratio).toBeUndefined()
  })

  it('kontext edit with >1 references rejects explicitly (不静默丢图)', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    const result = await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [REF_A, REF_B],
      options: { modelId: 'flux-kontext-pro' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('1 张参考图')
  })

  it('flux-1.1 t2i: aspect_ratio mapped into its 5-value enum', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [],
      options: { modelId: 'flux-1.1-pro-ultra', aspectRatio: '3:2' },
    })
    expect(bodies[0].model).toBe('black-forest-labs/flux-1.1-pro-ultra')
    expect(bodies[0].aspect_ratio).toBe('4:3')
    expect(bodies[0].size).toBeUndefined()
  })

  it('flux-1.1 with references rejects explicitly (无 img2img 变体)', async () => {
    stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    const result = await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [REF_A],
      options: { modelId: 'flux-1.1-pro' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('不支持参考图')
  })
})

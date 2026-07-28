/**
 * AtlasCloud Seedream 5.0 Lite (ByteDance, 2026-07-27).
 *
 * Schema CDN ground truth (bytedance-seedream-v5.0-lite[-edit].json):
 *  - t2i  slug = bytedance/seedream-v5.0-lite（BARE，无后缀）
 *  - edit slug = bytedance/seedream-v5.0-lite/edit（images: string[]，官方最多 14 张）
 *  - `size` 是 16 值固定枚举（星号分隔），分 2K/3-4K 两档 —— 不是自由填值，
 *    发枚举外的值会被 gateway 400。aspectRatio+resolution → 最近枚举值。
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
  seedreamV5SizeFor,
} from '@/lib/generators/image/atlascloud'

function stubFetchCapturing(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pred_sd5_1', status: 'created' }),
      text: async () => '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies }
}

const REF_A = 'https://cos.example.com/images/ref-a.png?sign=abc'
const REF_B = 'https://cos.example.com/images/ref-b.png?sign=def'

describe('AtlasCloud Seedream 5.0 Lite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'atlas-key' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves t2i to the BARE slug and edit to /edit', () => {
    expect(resolveAtlasCloudImageModel('seedream-v5.0-lite', false)).toBe('bytedance/seedream-v5.0-lite')
    expect(resolveAtlasCloudImageModel('seedream-v5.0-lite', true)).toBe('bytedance/seedream-v5.0-lite/edit')
  })

  it('maps aspectRatio+resolution into the 16-value size enum', () => {
    // 2K tier
    expect(seedreamV5SizeFor('1:1', '2k')).toBe('2048*2048')
    expect(seedreamV5SizeFor('16:9', '2k')).toBe('2848*1600')
    expect(seedreamV5SizeFor('9:16', '2k')).toBe('1600*2848')
    expect(seedreamV5SizeFor('4:3', '2k')).toBe('2304*1728')
    expect(seedreamV5SizeFor('3:2', '2k')).toBe('2496*1664')
    expect(seedreamV5SizeFor('21:9', '2k')).toBe('3136*1344')
    // 2:1（720全景习惯值）收敛到最宽的 21:9 档
    expect(seedreamV5SizeFor('2:1', '2k')).toBe('3136*1344')
    // 4K tier
    expect(seedreamV5SizeFor('1:1', '4k')).toBe('3072*3072')
    expect(seedreamV5SizeFor('16:9', '4k')).toBe('4096*2304')
    expect(seedreamV5SizeFor('9:16', '4k')).toBe('2304*4096')
    expect(seedreamV5SizeFor('2:3', '4k')).toBe('2496*3744')
    expect(seedreamV5SizeFor('21:9', '4k')).toBe('4704*2016')
    // defaults: unknown ratio → 1:1; unknown/missing resolution → 2K tier
    expect(seedreamV5SizeFor('5:7', '2k')).toBe('2048*2048')
    expect(seedreamV5SizeFor('16:9', undefined)).toBe('2848*1600')
    expect(seedreamV5SizeFor(undefined, undefined)).toBe('2048*2048')
  })

  it('t2i body: enum size + no images field', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    const result = await generator.generate({
      userId: 'u1',
      prompt: '雨夜霓虹街道海报，标题「星尘」',
      referenceImages: [],
      options: { modelId: 'seedream-v5.0-lite', aspectRatio: '16:9', resolution: '4k' },
    })
    expect(result.success).toBe(true)
    expect(result.externalId).toBe('ATLASCLOUD:IMAGE:pred_sd5_1')
    expect(bodies[0].model).toBe('bytedance/seedream-v5.0-lite')
    expect(bodies[0].size).toBe('4096*2304')
    expect(bodies[0].images).toBeUndefined()
  })

  it('edit body: multi-refs pass through `images` array', async () => {
    const { bodies } = stubFetchCapturing()
    const generator = new AtlasCloudImageGenerator()
    await generator.generate({
      userId: 'u1',
      prompt: 'x',
      referenceImages: [REF_A, REF_B],
      options: { modelId: 'seedream-v5.0-lite', aspectRatio: '1:1' },
    })
    expect(bodies[0].model).toBe('bytedance/seedream-v5.0-lite/edit')
    expect(bodies[0].images).toEqual([REF_A, REF_B])
    expect(bodies[0].size).toBe('2048*2048')
  })
})

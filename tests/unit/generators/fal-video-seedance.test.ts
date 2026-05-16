import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiConfigMock = vi.hoisted(() => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'fal-key' })),
}))

const asyncSubmitMock = vi.hoisted(() => ({
  submitFalTask: vi.fn(async (..._args: unknown[]) => 'req_seedance_1'),
}))

vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/async-submit', () => asyncSubmitMock)

import { FalVideoGenerator } from '@/lib/generators/fal'

const SEEDANCE_ENDPOINTS = [
  'bytedance/seedance-2.0/image-to-video',
  'bytedance/seedance-2.0/fast/image-to-video',
] as const

describe('FalVideoGenerator Seedance 2.0', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'fal-key' })
    asyncSubmitMock.submitFalTask.mockResolvedValue('req_seedance_1')
  })

  it.each(SEEDANCE_ENDPOINTS)('submits %s with image_url + clamped duration + aspect_ratio + generate_audio default', async (modelId) => {
    const generator = new FalVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'cinematic close-up',
      options: {
        modelId,
        duration: 8,
        aspectRatio: '16:9',
        resolution: '720p',
      },
    })

    expect(result.success).toBe(true)
    expect(result.endpoint).toBe(modelId)
    expect(result.externalId).toBe(`FAL:VIDEO:${modelId}:req_seedance_1`)

    const call = asyncSubmitMock.submitFalTask.mock.calls.at(0)
    if (!call) throw new Error('submitFalTask should be called')
    const [endpoint, payload, key] = call as [string, Record<string, unknown>, string]
    expect(endpoint).toBe(modelId)
    expect(key).toBe('fal-key')

    expect(payload.image_url).toBe('https://example.com/first.png')
    expect(payload.prompt).toBe('cinematic close-up')
    expect(payload.duration).toBe(8)
    expect(payload.aspect_ratio).toBe('16:9')
    expect(payload.resolution).toBe('720p')
    expect(payload.generate_audio).toBe(false)
    expect(payload.start_image_url).toBeUndefined()
    expect(payload.end_image_url).toBeUndefined()
  })

  it('forwards lastFrameImageUrl as end_image_url', async () => {
    const generator = new FalVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'p',
      options: {
        modelId: 'bytedance/seedance-2.0/image-to-video',
        lastFrameImageUrl: 'https://example.com/last.png',
      },
    })
    const payload = asyncSubmitMock.submitFalTask.mock.calls.at(0)?.[1] as Record<string, unknown>
    expect(payload.end_image_url).toBe('https://example.com/last.png')
  })

  it('clamps duration to [4, 15]', async () => {
    const generator = new FalVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'p',
      options: {
        modelId: 'bytedance/seedance-2.0/image-to-video',
        duration: 999,
      },
    })
    const payload = asyncSubmitMock.submitFalTask.mock.calls.at(0)?.[1] as Record<string, unknown>
    expect(payload.duration).toBe(15)
  })

  it('drops invalid aspect_ratio / resolution silently (fal default kicks in)', async () => {
    const generator = new FalVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'p',
      options: {
        modelId: 'bytedance/seedance-2.0/image-to-video',
        aspectRatio: 'banana',
        resolution: '8K',
      },
    })
    const payload = asyncSubmitMock.submitFalTask.mock.calls.at(0)?.[1] as Record<string, unknown>
    expect(payload.aspect_ratio).toBeUndefined()
    expect(payload.resolution).toBeUndefined()
  })

  it('passes generateAudio=true when explicitly requested', async () => {
    const generator = new FalVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'p',
      options: {
        modelId: 'bytedance/seedance-2.0/image-to-video',
        generateAudio: true,
      },
    })
    const payload = asyncSubmitMock.submitFalTask.mock.calls.at(0)?.[1] as Record<string, unknown>
    expect(payload.generate_audio).toBe(true)
  })

  it('passes seed when provided', async () => {
    const generator = new FalVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'p',
      options: {
        modelId: 'bytedance/seedance-2.0/image-to-video',
        seed: 42,
      },
    })
    const payload = asyncSubmitMock.submitFalTask.mock.calls.at(0)?.[1] as Record<string, unknown>
    expect(payload.seed).toBe(42)
  })
})

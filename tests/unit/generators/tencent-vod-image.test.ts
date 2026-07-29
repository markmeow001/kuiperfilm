import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiConfigMock = vi.hoisted(() => ({
  getProviderConfig: vi.fn(async () => ({
    apiKey: JSON.stringify({
      secretId: 'AKID-test',
      secretKey: 'sk-test',
      subAppId: 1500044236,
      region: 'ap-guangzhou',
    }),
  })),
}))

const createAigcImageTaskMock = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => ({ TaskId: 'task-image-001' })),
)

const vodClientMock = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    CreateAigcImageTask: createAigcImageTaskMock,
  })),
)

vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('tencentcloud-sdk-nodejs-vod', () => ({
  vod: { v20180717: { Client: vodClientMock } },
}))

import { TencentVODImageGenerator } from '@/lib/generators/image/tencent-vod'

describe('TencentVODImageGenerator aspect-ratio handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAigcImageTaskMock.mockResolvedValue({ TaskId: 'task-image-001' })
  })

  it('sends a supported ratio through OutputConfig for GG models', async () => {
    const generator = new TencentVODImageGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'cinematic casting portrait',
      options: { modelId: 'GEM-3.1', aspectRatio: '9:16' },
    })

    expect(result.success).toBe(true)
    const req = createAigcImageTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req.ModelName).toBe('GG')
    expect(req.ModelVersion).toBe('3.1')
    expect(req.OutputConfig).toEqual(expect.objectContaining({ AspectRatio: '9:16' }))
  })

  it('puts SI ratio guidance in the prompt instead of an unsupported OutputConfig field', async () => {
    const generator = new TencentVODImageGenerator()
    await generator.generate({
      userId: 'user-1',
      prompt: 'full-body costume test',
      options: { modelId: 'SI-5.0-lite', aspectRatio: '3:4' },
    })

    const req = createAigcImageTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req.OutputConfig).not.toHaveProperty('AspectRatio')
    expect(req.Prompt).toContain('strict 3:4 aspect ratio')
  })

  it('omits auto ratio for models whose API has no aspect-ratio field', async () => {
    const generator = new TencentVODImageGenerator()
    await generator.generate({
      userId: 'user-1',
      prompt: 'neutral casting portrait',
      options: { modelId: 'Qwen-0925', aspectRatio: 'auto' },
    })

    const req = createAigcImageTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req.OutputConfig).not.toHaveProperty('AspectRatio')
    expect(req.Prompt).toBe('neutral casting portrait')
  })
})

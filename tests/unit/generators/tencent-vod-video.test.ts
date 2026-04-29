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

const createAigcVideoTaskMock = vi.hoisted(() =>
  vi.fn(async () => ({ TaskId: 'task-test-001' })),
)

const vodClientMock = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    CreateAigcVideoTask: createAigcVideoTaskMock,
  })),
)

vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('tencentcloud-sdk-nodejs-vod', () => ({
  vod: { v20180717: { Client: vodClientMock } },
}))

import { TencentVODVideoGenerator } from '@/lib/generators/video/tencent-vod'

describe('TencentVODVideoGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAigcVideoTaskMock.mockResolvedValue({ TaskId: 'task-test-001' })
  })

  it('returns externalId formatted as TENCENTVOD:VIDEO:<taskId>', async () => {
    const generator = new TencentVODVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'a cinematic shot',
      options: {
        modelId: 'Kling-3.0',
        duration: 5,
      },
    })

    expect(result.success).toBe(true)
    expect(result.async).toBe(true)
    expect(result.externalId).toBe('TENCENTVOD:VIDEO:task-test-001')
  })

  it('parses ModelName / ModelVersion from "Kling-3.0-Omni" preserving suffix', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'test',
      options: { modelId: 'Kling-3.0-Omni' },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req?.ModelName).toBe('Kling')
    expect(req?.ModelVersion).toBe('3.0-Omni')
  })

  it('passes SubjectInfos through to CreateAigcVideoTask for Kling subject mode', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'a girl walking',
      options: {
        modelId: 'Kling-3.0',
        subjectInfos: [
          { id: '929510000000593344', name: '主角小明' },
        ],
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req?.SubjectInfos).toEqual([
      { Id: '929510000000593344', Name: '主角小明' },
    ])
  })

  it('passes Vidu SubjectInfos with image refs and voice id', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      prompt: '[@小明] 在森林裡跑',
      options: {
        modelId: 'Vidu-q2',
        subjectInfos: [
          {
            name: '小明',
            voiceId: 'male-qn-qingse',
            imageUrls: ['https://example.com/ref-1.png', 'https://example.com/ref-2.png'],
          },
        ],
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req?.SubjectInfos).toEqual([
      {
        Name: '小明',
        VoiceId: 'male-qn-qingse',
        ImageUrls: ['https://example.com/ref-1.png', 'https://example.com/ref-2.png'],
      },
    ])
  })

  it('omits SubjectInfos field entirely when option not provided', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'plain',
      options: { modelId: 'Kling-3.0' },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req).not.toHaveProperty('SubjectInfos')
  })

  it('skips empty subject entries (no fields set)', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'plain',
      options: {
        modelId: 'Kling-3.0',
        subjectInfos: [{}, { id: 'real' }],
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req?.SubjectInfos).toEqual([{ Id: 'real' }])
  })
})

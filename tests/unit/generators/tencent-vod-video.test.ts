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

  // —— ExtInfo / Kling 智能分镜 ——

  it('serialises klingMultiShot into ExtInfo JSON string for Kling 3.0', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      prompt: '兩人在咖啡店對話，然後走出店外',
      options: {
        modelId: 'Kling-3.0',
        klingMultiShot: { multi_shot: 'intelligence' },
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(typeof req?.ExtInfo).toBe('string')
    expect(JSON.parse(req?.ExtInfo as string)).toEqual({ multi_shot: 'intelligence' })
  })

  it('forwards short_type and multi_prompt alongside multi_shot', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      prompt: 'short drama opening scene',
      options: {
        modelId: 'Kling-3.0-Omni',
        klingMultiShot: {
          multi_shot: 'intelligence',
          short_type: 'drama',
          multi_prompt: 'scene 1: meet | scene 2: argue',
        },
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(JSON.parse(req?.ExtInfo as string)).toEqual({
      multi_shot: 'intelligence',
      short_type: 'drama',
      multi_prompt: 'scene 1: meet | scene 2: argue',
    })
  })

  it('merges generic extInfo with klingMultiShot — extInfo wins on key conflict', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      prompt: 'mixed payload',
      options: {
        modelId: 'Kling-3.0',
        klingMultiShot: { multi_shot: 'intelligence', short_type: 'drama' },
        extInfo: { short_type: 'comedy', custom_flag: true },
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(JSON.parse(req?.ExtInfo as string)).toEqual({
      multi_shot: 'intelligence',
      short_type: 'comedy', // overridden
      custom_flag: true,
    })
  })

  it('omits ExtInfo when neither klingMultiShot nor extInfo provided', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'plain',
      options: { modelId: 'Kling-3.0' },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req).not.toHaveProperty('ExtInfo')
  })

  it('omits ExtInfo when klingMultiShot is an empty object', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'plain',
      options: {
        modelId: 'Kling-3.0',
        klingMultiShot: {},
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    expect(req).not.toHaveProperty('ExtInfo')
  })

  // —— OutputConfig 進階欄位 ——

  it('passes all advanced OutputConfig flags when set', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'production-grade run',
      options: {
        modelId: 'Vidu-q3',
        duration: 5,
        resolution: '1080P',
        frameInterpolate: 'Enabled',
        offPeak: 'Enabled',
        logoAdd: 'Disabled',
        inputComplianceCheck: 'Enabled',
        outputComplianceCheck: 'Enabled',
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    const out = req?.OutputConfig as Record<string, unknown>
    expect(out.FrameInterpolate).toBe('Enabled')
    expect(out.OffPeak).toBe('Enabled')
    expect(out.LogoAdd).toBe('Disabled')
    expect(out.InputComplianceCheck).toBe('Enabled')
    expect(out.OutputComplianceCheck).toBe('Enabled')
    // existing fields still present
    expect(out.StorageMode).toBe('Temporary')
    expect(out.Duration).toBe(5)
    expect(out.Resolution).toBe('1080P')
  })

  it('omits unsupplied advanced OutputConfig flags', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'baseline run',
      options: { modelId: 'Kling-3.0' },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    const out = req?.OutputConfig as Record<string, unknown>
    expect(out).not.toHaveProperty('FrameInterpolate')
    expect(out).not.toHaveProperty('OffPeak')
    expect(out).not.toHaveProperty('LogoAdd')
    expect(out).not.toHaveProperty('InputComplianceCheck')
    expect(out).not.toHaveProperty('OutputComplianceCheck')
  })

  it('forwards only the explicitly-set advanced flags', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      prompt: 'partial flags',
      options: {
        modelId: 'Kling-3.0',
        outputComplianceCheck: 'Enabled',
      },
    })

    const req = createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>
    const out = req?.OutputConfig as Record<string, unknown>
    expect(out.OutputComplianceCheck).toBe('Enabled')
    expect(out).not.toHaveProperty('InputComplianceCheck')
    expect(out).not.toHaveProperty('OffPeak')
  })

  // —— StorageMode (Temporary / Permanent) ——

  it('defaults StorageMode to Temporary when not specified', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'baseline',
      options: { modelId: 'Kling-3.0' },
    })

    const out = (createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>)
      .OutputConfig as Record<string, unknown>
    expect(out.StorageMode).toBe('Temporary')
  })

  it('uses Permanent StorageMode when storageMode option is set', async () => {
    const generator = new TencentVODVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/start.png',
      prompt: 'pipeline-stage-1',
      options: {
        modelId: 'Kling-3.0',
        storageMode: 'Permanent',
      },
    })

    const out = (createAigcVideoTaskMock.mock.calls.at(0)?.[0] as Record<string, unknown>)
      .OutputConfig as Record<string, unknown>
    expect(out.StorageMode).toBe('Permanent')
  })
})

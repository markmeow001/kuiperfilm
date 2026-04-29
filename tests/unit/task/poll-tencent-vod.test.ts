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

const describeTaskDetailMock = vi.hoisted(() => vi.fn())

const vodClientMock = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    DescribeTaskDetail: describeTaskDetailMock,
  })),
)

vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('tencentcloud-sdk-nodejs-vod', () => ({
  vod: { v20180717: { Client: vodClientMock } },
}))

import { pollAsyncTask } from '@/lib/async-poll'

describe('pollAsyncTask — TENCENTVOD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns videoUrl + providerFileId when video task finishes with FileId', async () => {
    describeTaskDetailMock.mockResolvedValue({
      AigcVideoTask: {
        TaskId: 'task-1',
        Status: 'FINISH',
        ErrCode: 0,
        Output: {
          FileInfos: [
            {
              FileUrl: 'https://1500044236.vod-qcloud.com/abc/output.mp4',
              FileId: '5145403720640671256',
            },
          ],
        },
      },
    })

    const result = await pollAsyncTask('TENCENTVOD:VIDEO:task-1', 'user-1')
    expect(result.status).toBe('completed')
    expect(result.videoUrl).toBe('https://1500044236.vod-qcloud.com/abc/output.mp4')
    expect(result.resultUrl).toBe('https://1500044236.vod-qcloud.com/abc/output.mp4')
    expect(result.providerFileId).toBe('5145403720640671256')
  })

  it('omits providerFileId when response has FileUrl but no FileId (Temporary mode)', async () => {
    describeTaskDetailMock.mockResolvedValue({
      AigcVideoTask: {
        TaskId: 'task-2',
        Status: 'FINISH',
        ErrCode: 0,
        Output: {
          FileInfos: [
            { FileUrl: 'https://temp.example.com/out.mp4' },
          ],
        },
      },
    })

    const result = await pollAsyncTask('TENCENTVOD:VIDEO:task-2', 'user-1')
    expect(result.status).toBe('completed')
    expect(result.videoUrl).toBe('https://temp.example.com/out.mp4')
    expect(result.providerFileId).toBeUndefined()
  })

  it('returns imageUrl + providerFileId for image task', async () => {
    describeTaskDetailMock.mockResolvedValue({
      AigcImageTask: {
        TaskId: 'task-3',
        Status: 'FINISH',
        ErrCode: 0,
        Output: {
          FileInfos: [
            {
              FileUrl: 'https://1500044236.vod-qcloud.com/img/result.png',
              FileId: '5145403720640671999',
            },
          ],
        },
      },
    })

    const result = await pollAsyncTask('TENCENTVOD:IMAGE:task-3', 'user-1')
    expect(result.status).toBe('completed')
    expect(result.imageUrl).toBe('https://1500044236.vod-qcloud.com/img/result.png')
    expect(result.providerFileId).toBe('5145403720640671999')
  })

  it('passes through pending status without inspecting Output', async () => {
    describeTaskDetailMock.mockResolvedValue({
      AigcVideoTask: { TaskId: 'task-4', Status: 'PROCESSING' },
    })

    const result = await pollAsyncTask('TENCENTVOD:VIDEO:task-4', 'user-1')
    expect(result.status).toBe('pending')
    expect(result.providerFileId).toBeUndefined()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getManualSubjectCreateInvalidationKeys,
  runManualLocationCreateWithUpload,
  runManualPropCreateWithUpload,
} from '@/app/[locale]/v2/workspace/[projectId]/subjects/manual-subject-create-flow'
import { queryKeys } from '@/lib/query/keys'

describe('manual location/prop create-with-upload flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('建立場景/道具後 -> 僅回傳 aggregate、實體類型與當集綁定的精確 keys', () => {
    expect(getManualSubjectCreateInvalidationKeys('location', 'project-1', 'episode-1')).toEqual([
      queryKeys.projectAssets.all('project-1'),
      queryKeys.projectAssets.locations('project-1'),
      [...queryKeys.tasks.all('project-1'), 'episode-location-bindings', 'episode-1'],
    ])
    expect(getManualSubjectCreateInvalidationKeys('prop', 'project-1', 'episode-1')).toEqual([
      queryKeys.projectAssets.all('project-1'),
      queryKeys.projectAssets.props('project-1'),
      [...queryKeys.tasks.all('project-1'), 'episode-prop-bindings', 'episode-1'],
    ])
    expect(getManualSubjectCreateInvalidationKeys('prop', 'project-1', null)).toEqual([
      queryKeys.projectAssets.all('project-1'),
      queryKeys.projectAssets.props('project-1'),
    ])
  })

  it('場景 upload 首次失敗再重試 -> create POST 僅一次且沿用 location target', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      location: { id: 'location-1' },
    }), { status: 200 }))
    const onCreated = vi.fn().mockResolvedValue(undefined)
    const upload = vi.fn()
      .mockRejectedValueOnce(new Error('upload unavailable'))
      .mockResolvedValueOnce(undefined)
    const params = {
      name: '屋頂',
      description: '',
      summary: '雨夜',
      file: new File(['image'], 'roof.png', { type: 'image/png' }),
    }

    const first = await runManualLocationCreateWithUpload({
      projectId: 'project-1',
      episodeId: 'episode-1',
      createRequestId: '11111111-1111-4111-8111-111111111111',
      params,
      existingTarget: null,
      request,
      onCreated,
      upload,
    })

    expect(first).toEqual({
      status: 'upload-failed',
      target: { createdId: 'location-1', targetId: 'location-1' },
      error: expect.objectContaining({ message: 'upload unavailable' }),
    })
    expect(request).toHaveBeenCalledWith('/api/novel-promotion/project-1/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: '屋頂',
        description: undefined,
        summary: '雨夜',
        episodeId: 'episode-1',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        skipImageGeneration: true,
      }),
    })
    expect(onCreated).toHaveBeenCalledWith({ createdId: 'location-1', targetId: 'location-1' })

    const second = await runManualLocationCreateWithUpload({
      projectId: 'project-1',
      episodeId: 'episode-1',
      createRequestId: '11111111-1111-4111-8111-111111111111',
      params,
      existingTarget: first.target,
      request,
      onCreated,
      upload,
    })

    expect(second).toEqual({
      status: 'completed',
      target: { createdId: 'location-1', targetId: 'location-1' },
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenNthCalledWith(2, {
      file: params.file,
      locationId: 'location-1',
      imageIndex: 0,
      labelText: '屋頂',
    })
  })

  it('道具 upload 首次失敗再重試 -> create POST 僅一次且沿用 prop target', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      prop: { id: 'prop-1' },
    }), { status: 200 }))
    const onCreated = vi.fn().mockResolvedValue(undefined)
    const upload = vi.fn()
      .mockRejectedValueOnce(new Error('upload unavailable'))
      .mockResolvedValueOnce(undefined)
    const params = {
      name: '銀色懷錶',
      description: '傳家物',
      file: new File(['image'], 'watch.png', { type: 'image/png' }),
    }

    const first = await runManualPropCreateWithUpload({
      projectId: 'project-1',
      episodeId: 'episode-1',
      createRequestId: '22222222-2222-4222-8222-222222222222',
      params,
      existingTarget: null,
      request,
      onCreated,
      upload,
    })
    expect(first.status).toBe('upload-failed')
    if (first.status !== 'upload-failed') throw new Error('expected upload failure')

    const second = await runManualPropCreateWithUpload({
      projectId: 'project-1',
      episodeId: 'episode-1',
      createRequestId: '22222222-2222-4222-8222-222222222222',
      params,
      existingTarget: first.target,
      request,
      onCreated,
      upload,
    })

    expect(second).toEqual({
      status: 'completed',
      target: { createdId: 'prop-1', targetId: 'prop-1' },
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenNthCalledWith(2, {
      file: params.file,
      propId: 'prop-1',
      labelText: '銀色懷錶',
    })
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      name: '銀色懷錶',
      summary: '傳家物',
      episodeId: 'episode-1',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('場景 create response 遺失後重試 -> 同一 key replay，文字模式才允許背景生圖', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('network response lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        location: { id: 'location-replayed' },
      }), { status: 200 }))
    const onCreated = vi.fn().mockResolvedValue(undefined)
    const upload = vi.fn().mockResolvedValue(undefined)
    const createRequestId = '33333333-3333-4333-8333-333333333333'
    const params = {
      name: '雨夜停車場',
      description: '閃爍日光燈與潮濕地面',
      summary: null,
      file: null,
    }

    await expect(runManualLocationCreateWithUpload({
      projectId: 'project-1',
      episodeId: 'episode-1',
      createRequestId,
      params,
      existingTarget: null,
      request,
      onCreated,
      upload,
    })).rejects.toThrow('network response lost')

    const replay = await runManualLocationCreateWithUpload({
      projectId: 'project-1',
      episodeId: 'episode-1',
      createRequestId,
      params,
      existingTarget: null,
      request,
      onCreated,
      upload,
    })

    expect(replay).toEqual({
      status: 'completed',
      target: { createdId: 'location-replayed', targetId: 'location-replayed' },
    })
    expect(request).toHaveBeenCalledTimes(2)
    for (const [, init] of request.mock.calls) {
      expect(JSON.parse(String(init?.body))).toEqual({
        name: '雨夜停車場',
        description: '閃爍日光燈與潮濕地面',
        episodeId: 'episode-1',
        idempotencyKey: createRequestId,
      })
    }
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(upload).not.toHaveBeenCalled()
  })
})

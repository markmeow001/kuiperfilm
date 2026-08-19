import { describe, expect, it, vi } from 'vitest'
import { runResumableCreateWithUpload } from '@/app/[locale]/v2/workspace/[projectId]/subjects/subject-create-upload-flow'

describe('subject create-with-upload recovery', () => {
  it('建立成功但上傳失敗 -> 回傳同一 createdId/targetId 供續傳', async () => {
    const target = { createdId: 'character-1', targetId: 'appearance-1' }
    const createTarget = vi.fn().mockResolvedValue(target)
    const onCreated = vi.fn().mockResolvedValue(undefined)
    const uploadTarget = vi.fn().mockRejectedValue(new Error('COS unavailable'))

    const result = await runResumableCreateWithUpload({
      existingTarget: null,
      createTarget,
      onCreated,
      uploadTarget,
    })

    expect(result).toEqual({
      status: 'upload-failed',
      target,
      error: expect.objectContaining({ message: 'COS unavailable' }),
    })
    expect(createTarget).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(target)
    expect(uploadTarget).toHaveBeenCalledWith(target)
  })

  it('已有 recovery target 重試 -> 僅上傳同一 entity，不再次 create', async () => {
    const target = { createdId: 'location-1', targetId: 'location-1' }
    const createTarget = vi.fn()
    const onCreated = vi.fn()
    const uploadTarget = vi.fn().mockResolvedValue(undefined)

    const result = await runResumableCreateWithUpload({
      existingTarget: target,
      createTarget,
      onCreated,
      uploadTarget,
    })

    expect(result).toEqual({ status: 'completed', target })
    expect(createTarget).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(uploadTarget).toHaveBeenCalledWith(target)
  })

  it('建立失敗 -> 原地拋錯且不執行 invalidation 或 upload', async () => {
    const createTarget = vi.fn().mockRejectedValue(new Error('create rejected'))
    const onCreated = vi.fn()
    const uploadTarget = vi.fn()

    await expect(runResumableCreateWithUpload({
      existingTarget: null,
      createTarget,
      onCreated,
      uploadTarget,
    })).rejects.toThrow('create rejected')

    expect(onCreated).not.toHaveBeenCalled()
    expect(uploadTarget).not.toHaveBeenCalled()
  })
})

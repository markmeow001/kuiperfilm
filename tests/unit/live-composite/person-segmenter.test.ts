import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MPMask } from '@mediapipe/tasks-vision'
import { preloadPersonSegmenter, releasePersonSegmenters, selectPersonConfidenceMask } from '@/app/[locale]/live-composite/lib/person-segmenter'

const mocks = vi.hoisted(() => ({
  createFromOptions: vi.fn(),
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  ImageSegmenter: { createFromOptions: mocks.createFromOptions },
}))

describe('person segmenter release', () => {
  beforeEach(() => {
    mocks.createFromOptions.mockReset()
  })

  afterEach(async () => {
    await releasePersonSegmenters()
  })

  it('釋放 segmenter -> 關閉實例並清空快取（再次取得會重建）', async () => {
    const close = vi.fn()
    mocks.createFromOptions.mockImplementation(async () => ({ close }))

    await preloadPersonSegmenter('landscape')
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(1)

    await releasePersonSegmenters()
    expect(close).toHaveBeenCalledTimes(1)

    // 快取已清空：再次取得會建立新的實例，而不是回收已關閉的實例。
    await preloadPersonSegmenter('landscape')
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(2)
  })

  it('close() 拋錯 -> 釋放流程不失敗且快取仍被清空', async () => {
    const close = vi.fn(() => {
      throw new Error('segmenter already torn down')
    })
    mocks.createFromOptions.mockImplementation(async () => ({ close }))

    await preloadPersonSegmenter('square')
    await expect(releasePersonSegmenters()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(1)

    await preloadPersonSegmenter('square')
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(2)
  })

  it('建立 segmenter 失敗 -> 釋放流程不會拋出未處理錯誤', async () => {
    mocks.createFromOptions.mockRejectedValue(new Error('wasm load failed'))

    await expect(preloadPersonSegmenter('landscape')).rejects.toThrow('wasm load failed')
    await expect(releasePersonSegmenters()).resolves.toBeUndefined()
  })

  it('Selfie Segmenter 單一信心遮罩 -> 將第 0 張視為人物前景', () => {
    const foreground = { width: 2, height: 1 } as MPMask
    expect(selectPersonConfidenceMask([foreground])).toBe(foreground)
  })

  it('模型沒有信心遮罩 -> 回報明確錯誤', () => {
    expect(() => selectPersonConfidenceMask(undefined)).toThrow('沒有回傳人物信心遮罩')
    expect(() => selectPersonConfidenceMask([])).toThrow('沒有回傳人物信心遮罩')
  })
})

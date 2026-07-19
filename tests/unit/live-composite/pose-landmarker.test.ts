import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectMultiPoseLandmarks, releasePoseLandmarker } from '@/app/[locale]/live-composite/lib/pose-landmarker'

const mocks = vi.hoisted(() => ({
  createFromOptions: vi.fn(),
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  PoseLandmarker: { createFromOptions: mocks.createFromOptions },
}))

const fakeVideo = {} as HTMLVideoElement

describe('detectMultiPoseLandmarks（骨架範圍裁切用多人的偵測）', () => {
  beforeEach(() => {
    mocks.createFromOptions.mockReset()
  })

  afterEach(() => {
    releasePoseLandmarker()
  })

  it('建立偵測器時 numPoses=2 -> 能同時偵測兩位主角', async () => {
    mocks.createFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    })

    await detectMultiPoseLandmarks(fakeVideo)

    expect(mocks.createFromOptions).toHaveBeenCalledTimes(1)
    expect(mocks.createFromOptions.mock.calls[0][1]).toMatchObject({ numPoses: 2, runningMode: 'VIDEO' })
  })

  it('回傳每個骨架的 {x, y} 正規化座標（丟棄其餘欄位）', async () => {
    mocks.createFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => ({
        landmarks: [
          [{ x: 0.1, y: 0.2, z: 0.9, visibility: 0.8 }],
          [{ x: 0.7, y: 0.6, z: -0.4, visibility: 0.5 }],
        ],
      })),
      close: vi.fn(),
    })

    await expect(detectMultiPoseLandmarks(fakeVideo)).resolves.toEqual([
      [{ x: 0.1, y: 0.2 }],
      [{ x: 0.7, y: 0.6 }],
    ])
  })

  it('偵測不到任何骨架 -> 回傳空陣列（不拋錯，交由 UI 顯示未裁切）', async () => {
    mocks.createFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    })

    await expect(detectMultiPoseLandmarks(fakeVideo)).resolves.toEqual([])
  })

  it('釋放後再次偵測 -> 重新建立實例（快取已清空且舊實例已關閉）', async () => {
    const close = vi.fn()
    mocks.createFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close,
    })

    await detectMultiPoseLandmarks(fakeVideo)
    releasePoseLandmarker()
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))

    await detectMultiPoseLandmarks(fakeVideo)
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(2)
  })

  it('建立實例失敗 -> 拋錯且下次重試會重新建立', async () => {
    mocks.createFromOptions.mockRejectedValueOnce(new Error('wasm load failed'))
    await expect(detectMultiPoseLandmarks(fakeVideo)).rejects.toThrow('wasm load failed')

    mocks.createFromOptions.mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
      close: vi.fn(),
    })
    await expect(detectMultiPoseLandmarks(fakeVideo)).resolves.toEqual([])
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(2)
  })
})

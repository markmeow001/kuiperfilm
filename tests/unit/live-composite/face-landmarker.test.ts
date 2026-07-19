import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyzeFaceFrame,
  computeFaceCropBox,
  createFaceLandmarker,
  FACE_CROP_DEFAULT_PADDING,
  releaseFaceLandmarker,
} from '@/app/[locale]/live-composite/lib/face-landmarker'

const mocks = vi.hoisted(() => ({
  createFromOptions: vi.fn(),
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceLandmarker: { createFromOptions: mocks.createFromOptions },
}))

const video = {} as HTMLVideoElement

function landmarkerReturning(result: unknown) {
  return { detectForVideo: vi.fn(() => result), close: vi.fn() }
}

describe('face landmarker wiring', () => {
  beforeEach(() => {
    mocks.createFromOptions.mockReset()
  })

  afterEach(() => {
    releaseFaceLandmarker()
  })

  it('建立 landmarker -> VIDEO 模式、單臉、開啟 blendshapes，並快取實例', async () => {
    const instance = landmarkerReturning({ faceLandmarks: [], faceBlendshapes: [] })
    mocks.createFromOptions.mockImplementation(async () => instance)

    await createFaceLandmarker()
    await createFaceLandmarker()
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(1)
    expect(mocks.createFromOptions.mock.calls[0][1]).toMatchObject({
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      baseOptions: { modelAssetPath: '/models/live-composite/face-landmarker.task' },
    })
  })

  it('釋放 landmarker -> 關閉實例並清空快取（再次取得會重建）', async () => {
    const instance = landmarkerReturning({ faceLandmarks: [], faceBlendshapes: [] })
    mocks.createFromOptions.mockImplementation(async () => instance)

    await createFaceLandmarker()
    releaseFaceLandmarker()
    await vi.waitFor(() => expect(instance.close).toHaveBeenCalledTimes(1))

    await createFaceLandmarker()
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(2)
  })

  it('建立失敗 -> 快取清空，重試會重新建立而不是回收失敗的 promise', async () => {
    mocks.createFromOptions.mockRejectedValueOnce(new Error('wasm load failed'))
    await expect(createFaceLandmarker()).rejects.toThrow('wasm load failed')

    const instance = landmarkerReturning({ faceLandmarks: [], faceBlendshapes: [] })
    mocks.createFromOptions.mockImplementation(async () => instance)
    await expect(createFaceLandmarker()).resolves.toBe(instance)
  })

  it('偵測到臉 -> 回傳 landmarks、blendshape 對照表與裁切框', async () => {
    const landmarks = [
      { x: 0.4, y: 0.4, z: 0 },
      { x: 0.6, y: 0.6, z: 0 },
    ]
    mocks.createFromOptions.mockImplementation(async () => landmarkerReturning({
      faceLandmarks: [landmarks],
      faceBlendshapes: [{ categories: [
        { categoryName: 'jawOpen', score: 0.8123 },
        { categoryName: 'cheekPuff', score: 0.1 },
      ] }],
    }))

    const analysis = await analyzeFaceFrame(video, 1.5)
    expect(analysis).not.toBeNull()
    expect(analysis?.landmarks).toBe(landmarks)
    expect(analysis?.blendshapes).toEqual({ jawOpen: 0.8123, cheekPuff: 0.1 })
    expect(analysis?.faceBox).toEqual(computeFaceCropBox(landmarks))
  })

  it('沒有臉 -> 回傳 null（漏檢是資料，不是錯誤）', async () => {
    mocks.createFromOptions.mockImplementation(async () => landmarkerReturning({
      faceLandmarks: [],
      faceBlendshapes: [],
    }))
    await expect(analyzeFaceFrame(video, 2)).resolves.toBeNull()
  })

  it('有臉但缺 blendshapes -> 顯式失敗（模型契約破損不可靜默降級）', async () => {
    mocks.createFromOptions.mockImplementation(async () => landmarkerReturning({
      faceLandmarks: [[{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }]],
      faceBlendshapes: [],
    }))
    await expect(analyzeFaceFrame(video, 2)).rejects.toThrow('沒有回傳表情資料')
  })
})

describe('computeFaceCropBox（純函式）', () => {
  const centeredFace = [
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.6 },
  ]

  it('預設 padding 0.35 -> 每邊外擴 35%，中心保持在特徵點框中點', () => {
    const box = computeFaceCropBox(centeredFace)
    // raw 0.2 × (1 + 0.35*2) = 0.34, square keeps max side
    expect(box.w).toBeCloseTo(0.34, 10)
    expect(box.h).toBeCloseTo(0.34, 10)
    expect(box.x + box.w / 2).toBeCloseTo(0.5, 10)
    expect(box.y + box.h / 2).toBeCloseTo(0.5, 10)
    expect(FACE_CROP_DEFAULT_PADDING).toBe(0.35)
  })

  it('square 取長邊；3:4 保持 3:4 且仍涵蓋外擴後的臉框', () => {
    const wideFace = [
      { x: 0.2, y: 0.45 },
      { x: 0.8, y: 0.55 },
    ]
    const square = computeFaceCropBox(wideFace, 0)
    expect(square.w).toBeCloseTo(0.6, 10)
    expect(square.h).toBeCloseTo(0.6, 10)

    const portrait = computeFaceCropBox(wideFace, 0, '3:4')
    expect(portrait.w / portrait.h).toBeCloseTo(3 / 4, 10)
    expect(portrait.h).toBeGreaterThanOrEqual(0.6 * (4 / 3) - 1e-9)
  })

  it('貼近畫面邊緣 -> 平移進 0-1 邊界而不縮小', () => {
    const cornerFace = [
      { x: 0.02, y: 0.02 },
      { x: 0.22, y: 0.22 },
    ]
    const box = computeFaceCropBox(cornerFace)
    expect(box.x).toBe(0)
    expect(box.y).toBe(0)
    expect(box.w).toBeCloseTo(0.34, 10)
  })

  it('外擴超過整個畫面 -> 尺寸截到 1 並落在邊界內', () => {
    const hugeFace = [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.95 },
    ]
    const box = computeFaceCropBox(hugeFace, 0.35)
    expect(box).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('無效輸入 -> 明確錯誤', () => {
    expect(() => computeFaceCropBox([])).toThrow('沒有臉部特徵點')
    expect(() => computeFaceCropBox(centeredFace, -0.1)).toThrow('介於 0 到 1')
    expect(() => computeFaceCropBox(centeredFace, 1.5)).toThrow('介於 0 到 1')
    expect(() => computeFaceCropBox([{ x: Number.NaN, y: 0.5 }, { x: 0.6, y: 0.6 }])).toThrow('座標無效')
    expect(() => computeFaceCropBox([{ x: 0.5, y: 0.5 }])).toThrow('範圍無效')
  })
})

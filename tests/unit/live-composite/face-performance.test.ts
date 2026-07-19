import { describe, expect, it, vi } from 'vitest'
import type { FaceBox, FaceFrameAnalysis } from '@/app/[locale]/live-composite/lib/face-landmarker'
import {
  computeExpressionPeak,
  computeFaceTrackStability,
  detectFaceProblemTimecodes,
  extractFacePerformance,
  FACE_EXPRESSION_BLENDSHAPE_KEYS,
  FACE_PROBLEM_JUMP_THRESHOLD,
  FacePerformanceCancelledError,
  summarizeBlendshapes,
  type FacePerformanceTrack,
} from '@/app/[locale]/live-composite/lib/face-performance'

function box(x: number, y: number, size = 0.3): FaceBox {
  return { x, y, w: size, h: size }
}

function analysis(faceBox: FaceBox, blendshapes: Record<string, number> = { jawOpen: 0.5 }): FaceFrameAnalysis {
  return { landmarks: [], blendshapes, faceBox }
}

function track(samples: FacePerformanceTrack['samples']): FacePerformanceTrack {
  return { samples }
}

describe('summarizeBlendshapes', () => {
  it('只保留表情相關欄位並四捨五入到 3 位小數', () => {
    const summary = summarizeBlendshapes({
      jawOpen: 0.81236,
      mouthSmileLeft: 0.4004,
      cheekPuff: 0.9, // not expression-relevant → dropped
      noseSneerLeft: 0.7,
      browInnerUp: 0.12345,
    })
    expect(summary).toEqual({ jawOpen: 0.812, mouthSmileLeft: 0.4, browInnerUp: 0.123 })
  })

  it('欄位清單固定且不超過契約上限 20', () => {
    expect(FACE_EXPRESSION_BLENDSHAPE_KEYS.length).toBeLessThanOrEqual(20)
    expect(FACE_EXPRESSION_BLENDSHAPE_KEYS).toContain('jawOpen')
    expect(FACE_EXPRESSION_BLENDSHAPE_KEYS).toContain('mouthSmileLeft')
    expect(FACE_EXPRESSION_BLENDSHAPE_KEYS).toContain('eyeLookOutRight')
  })

  it('非有限數值 -> 明確錯誤', () => {
    expect(() => summarizeBlendshapes({ jawOpen: Number.NaN })).toThrow('表情數值無效')
  })
})

describe('extractFacePerformance', () => {
  it('逐時間點取樣：偵測到 -> 摘要；沒偵測到 -> null 樣本（漏檢是資料）', async () => {
    const source = {
      analyzeFaceAt: vi.fn(async (time: number) =>
        time === 1 ? null : analysis(box(0.3, 0.3), { jawOpen: 0.77777, cheekPuff: 1 })),
    }
    const onProgress = vi.fn()

    const result = await extractFacePerformance(source, [0, 1, 2], { onProgress })

    expect(result.samples).toEqual([
      { time: 0, faceBox: box(0.3, 0.3), blendshapeSummary: { jawOpen: 0.778 } },
      { time: 1, faceBox: null, blendshapeSummary: null },
      { time: 2, faceBox: box(0.3, 0.3), blendshapeSummary: { jawOpen: 0.778 } },
    ])
    expect(source.analyzeFaceAt.mock.calls.map(([time]) => time)).toEqual([0, 1, 2])
    expect(onProgress.mock.calls).toEqual([[1, 3, 0], [2, 3, 1], [3, 3, 2]])
  })

  it('shouldContinue 回傳 false -> 丟出取消錯誤且不再分析後續影格', async () => {
    let completed = 0
    const source = {
      analyzeFaceAt: vi.fn(async () => {
        completed += 1
        return analysis(box(0.3, 0.3))
      }),
    }
    await expect(extractFacePerformance(source, [0, 0.5, 1], {
      shouldContinue: () => completed < 1,
    })).rejects.toBeInstanceOf(FacePerformanceCancelledError)
    expect(source.analyzeFaceAt).toHaveBeenCalledTimes(1)
  })

  it('無效輸入 -> 明確錯誤', async () => {
    const source = { analyzeFaceAt: vi.fn() }
    await expect(extractFacePerformance(source, [])).rejects.toThrow('沒有可分析的時間點')
    await expect(extractFacePerformance(source, [-1])).rejects.toThrow('分析時間點無效')
    expect(source.analyzeFaceAt).not.toHaveBeenCalled()
  })
})

describe('computeFaceTrackStability', () => {
  it('計算相鄰偵測樣本的中心位移，漏檢樣本不參與', () => {
    const stability = computeFaceTrackStability(track([
      { time: 0, faceBox: box(0.1, 0.1), blendshapeSummary: {} },
      { time: 0.5, faceBox: null, blendshapeSummary: null },
      { time: 1, faceBox: box(0.4, 0.5), blendshapeSummary: {} },
    ]), 1)

    expect(stability.drifts).toHaveLength(1)
    expect(stability.drifts[0]).toMatchObject({ fromTime: 0, toTime: 1 })
    expect(stability.drifts[0].drift).toBeCloseTo(Math.hypot(0.3, 0.4), 10)
  })

  it('移動平均產生穩定化裁切路徑（視窗置中、鎖在 0-1 邊界內）', () => {
    const stability = computeFaceTrackStability(track([
      { time: 0, faceBox: box(0, 0.2), blendshapeSummary: {} },
      { time: 0.5, faceBox: box(0.2, 0.2), blendshapeSummary: {} },
      { time: 1, faceBox: box(0.4, 0.2), blendshapeSummary: {} },
    ]), 3)

    expect(stability.stabilizedPath.map((point) => point.time)).toEqual([0, 0.5, 1])
    // Middle point averages all three boxes → center x = 0.35, box x = 0.2.
    expect(stability.stabilizedPath[1].box.x).toBeCloseTo(0.2, 10)
    // Edge point only averages its partial window and stays inside bounds.
    expect(stability.stabilizedPath[0].box.x).toBeCloseTo(0.1, 10)
    for (const point of stability.stabilizedPath) {
      expect(point.box.x).toBeGreaterThanOrEqual(0)
      expect(point.box.x + point.box.w).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('視窗必須是正整數', () => {
    expect(() => computeFaceTrackStability(track([]), 0)).toThrow('穩定化視窗')
    expect(() => computeFaceTrackStability(track([]), 2.5)).toThrow('穩定化視窗')
  })
})

describe('detectFaceProblemTimecodes', () => {
  it('漏檢時間 + 超過門檻的跳動時間，排序去重', () => {
    const problems = detectFaceProblemTimecodes(track([
      { time: 0, faceBox: box(0.1, 0.1), blendshapeSummary: {} },
      { time: 0.5, faceBox: box(0.11, 0.1), blendshapeSummary: {} }, // tiny move → fine
      { time: 1, faceBox: null, blendshapeSummary: null }, // missing
      { time: 1.5, faceBox: box(0.6, 0.6), blendshapeSummary: {} }, // jump vs 0.5s sample
    ]))
    expect(problems).toEqual([1, 1.5])
  })

  it('自訂門檻與預設門檻', () => {
    const samples = track([
      { time: 0, faceBox: box(0.1, 0.1), blendshapeSummary: {} },
      { time: 0.5, faceBox: box(0.2, 0.1), blendshapeSummary: {} }, // drift 0.1
    ])
    expect(FACE_PROBLEM_JUMP_THRESHOLD).toBe(0.18)
    expect(detectFaceProblemTimecodes(samples)).toEqual([])
    expect(detectFaceProblemTimecodes(samples, 0.05)).toEqual([0.5])
    expect(() => detectFaceProblemTimecodes(samples, 0)).toThrow('門檻必須大於 0')
  })
})

describe('computeExpressionPeak', () => {
  it('回傳指定欄位平均值最高的時間點；全漏檢 -> null', () => {
    const samples = track([
      { time: 0, faceBox: box(0.1, 0.1), blendshapeSummary: { mouthSmileLeft: 0.2, mouthSmileRight: 0.4 } },
      { time: 1, faceBox: box(0.1, 0.1), blendshapeSummary: { mouthSmileLeft: 0.8, mouthSmileRight: 0.6 } },
      { time: 2, faceBox: null, blendshapeSummary: null },
    ])
    expect(computeExpressionPeak(samples, ['mouthSmileLeft', 'mouthSmileRight'])).toEqual({ time: 1, value: 0.7 })
    expect(computeExpressionPeak(track([{ time: 0, faceBox: null, blendshapeSummary: null }]), ['jawOpen'])).toBeNull()
    expect(() => computeExpressionPeak(samples, [])).toThrow('沒有指定表情欄位')
  })
})

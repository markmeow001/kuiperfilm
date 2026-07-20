import { describe, expect, it } from 'vitest'
import {
  buildRvmScanPlan,
  chooseDownsampleRatio,
  DEFAULT_RVM_SCAN_FPS,
  nextRecurrentFeeds,
} from '@/app/[locale]/live-composite/lib/rvm-scan'
import { buildMaskAnalysisTimes } from '@/app/[locale]/live-composite/lib/mask-analysis'

describe('chooseDownsampleRatio', () => {
  it('1080p 級（含直式）→ 0.25', () => {
    expect(chooseDownsampleRatio(1920, 1080)).toBe(0.25)
    expect(chooseDownsampleRatio(1080, 1920)).toBe(0.25)
    expect(chooseDownsampleRatio(3840, 2160)).toBe(0.25)
  })

  it('720p 級（含直式）→ 0.375', () => {
    expect(chooseDownsampleRatio(1280, 720)).toBe(0.375)
    expect(chooseDownsampleRatio(720, 1280)).toBe(0.375)
  })

  it('低於 720p → 0.5', () => {
    expect(chooseDownsampleRatio(640, 360)).toBe(0.5)
    expect(chooseDownsampleRatio(854, 480)).toBe(0.5)
  })

  it('邊界：短邊 1079 → 0.375、短邊 719 → 0.5、短邊剛好 1080/720 升級', () => {
    expect(chooseDownsampleRatio(1918, 1079)).toBe(0.375)
    expect(chooseDownsampleRatio(1278, 719)).toBe(0.5)
    expect(chooseDownsampleRatio(99999, 1080)).toBe(0.25)
    expect(chooseDownsampleRatio(99999, 720)).toBe(0.375)
  })

  it('無效尺寸 → 明確丟錯', () => {
    expect(() => chooseDownsampleRatio(0, 1080)).toThrow('影片尺寸無效')
    expect(() => chooseDownsampleRatio(1920, -1)).toThrow('影片尺寸無效')
    expect(() => chooseDownsampleRatio(Number.NaN, 720)).toThrow('影片尺寸無效')
  })
})

describe('buildRvmScanPlan', () => {
  it('1 秒 @30fps、取樣 [0, 0.5, 1] → 31 個影格，取樣落在最近影格且各一次', () => {
    const plan = buildRvmScanPlan(1, 30, [0, 0.5, 1])
    expect(plan).toHaveLength(31)
    expect(plan[0].commitTimes).toEqual([0])
    expect(plan[15].time).toBeCloseTo(0.5, 6)
    expect(plan[15].commitTimes).toEqual([0.5])
    expect(plan[30].time).toBeCloseTo(1, 6)
    expect(plan[30].commitTimes).toEqual([1])
    const committed = plan.flatMap((step) => step.commitTimes)
    expect(committed).toEqual([0, 0.5, 1])
  })

  it('11.2 秒 @30fps → 337 個影格（0 到 11.2 含首尾），逐幀單調遞增', () => {
    const commitTimes = buildMaskAnalysisTimes(11.2, 1)
    const plan = buildRvmScanPlan(11.2, DEFAULT_RVM_SCAN_FPS, commitTimes)
    expect(plan).toHaveLength(337)
    expect(plan[0].time).toBe(0)
    expect(plan[plan.length - 1].time).toBeCloseTo(11.2, 6)
    for (let index = 1; index < plan.length; index += 1) {
      expect(plan[index].time).toBeGreaterThan(plan[index - 1].time)
    }
    // 每個既有取樣時間都恰好 commit 一次，且維持時間序。
    expect(plan.flatMap((step) => step.commitTimes)).toEqual(commitTimes)
  })

  it('取樣時間不在影格網格上 → 指派給最近影格', () => {
    const plan = buildRvmScanPlan(1, 30, [0.49])
    // 0.49 距 frame 15（0.5）比 frame 14（0.4667）近。
    expect(plan[15].commitTimes).toEqual([0.49])
    expect(plan[14].commitTimes).toEqual([])
  })

  it('等距時取較早影格', () => {
    const plan = buildRvmScanPlan(1, 10, [0.05])
    expect(plan[0].commitTimes).toEqual([0.05])
    expect(plan[1].commitTimes).toEqual([])
  })

  it('影片長度不是影格步長整數倍 → 補上最後一格（時間 = duration）', () => {
    const plan = buildRvmScanPlan(0.95, 30, [0, 0.95])
    expect(plan[plan.length - 1].time).toBe(0.95)
    expect(plan[plan.length - 1].commitTimes).toEqual([0.95])
  })

  it('無效輸入 → 明確丟錯', () => {
    expect(() => buildRvmScanPlan(0, 30, [0])).toThrow('影片長度無效')
    expect(() => buildRvmScanPlan(1, 0, [0])).toThrow('掃描影格率必須大於 0')
    expect(() => buildRvmScanPlan(1, 30, [])).toThrow('至少需要一個取樣時間')
    expect(() => buildRvmScanPlan(1, 30, [1.5])).toThrow('超出影片範圍')
  })
})

describe('nextRecurrentFeeds', () => {
  it('r1o..r4o 映射為下一幀的 r1i..r4i（同一物件參照）', () => {
    const r1o = { id: 1 }
    const r2o = { id: 2 }
    const r3o = { id: 3 }
    const r4o = { id: 4 }
    const next = nextRecurrentFeeds({ r1o, r2o, r3o, r4o, pha: { id: 5 }, fgr: { id: 6 } })
    expect(next.r1i).toBe(r1o)
    expect(next.r2i).toBe(r2o)
    expect(next.r3i).toBe(r3o)
    expect(next.r4i).toBe(r4o)
  })

  it('缺少任何循環狀態輸出 → 明確丟錯（不得沿用舊狀態）', () => {
    expect(() => nextRecurrentFeeds({ r1o: {}, r2o: {}, r4o: {} })).toThrow('r3o')
  })
})

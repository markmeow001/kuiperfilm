import { describe, expect, it } from 'vitest'
import {
  DepthRebuildSegmentPlanError,
  MAX_DUAL_GUIDE_SEGMENT_SECONDS,
  buildDepthRebuildSegmentPlan,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-segment-plan'

describe('depth rebuild RGB + Depth segment plan', () => {
  it('4 秒原片 -> 單段完整保留，雙影片參考合計 8 秒', () => {
    expect(buildDepthRebuildSegmentPlan(4)).toEqual([
      {
        sourceStart: 0,
        sourceEnd: 4,
        outputDuration: 4,
        referenceTotalSeconds: 8,
      },
    ])
  })

  it('7.5 秒原片 -> 單段剛好用滿 15 秒參考影片配額', () => {
    expect(MAX_DUAL_GUIDE_SEGMENT_SECONDS).toBe(7.5)
    expect(buildDepthRebuildSegmentPlan(7.5)).toEqual([
      {
        sourceStart: 0,
        sourceEnd: 7.5,
        outputDuration: 7.5,
        referenceTotalSeconds: 15,
      },
    ])
  })

  it('11 秒原片 -> 平均拆為 5.5 + 5.5，邊界連續且不裁短', () => {
    const segments = buildDepthRebuildSegmentPlan(11)

    expect(segments).toEqual([
      {
        sourceStart: 0,
        sourceEnd: 5.5,
        outputDuration: 5.5,
        referenceTotalSeconds: 11,
      },
      {
        sourceStart: 5.5,
        sourceEnd: 11,
        outputDuration: 5.5,
        referenceTotalSeconds: 11,
      },
    ])
    expect(segments.reduce((total, segment) => total + segment.outputDuration, 0)).toBe(11)
  })

  it('11.2 秒原片 -> 平均拆為 5.6 + 5.6，完整終點保持 11.2 秒', () => {
    const segments = buildDepthRebuildSegmentPlan(11.2)

    expect(segments).toEqual([
      {
        sourceStart: 0,
        sourceEnd: 5.6,
        outputDuration: 5.6,
        referenceTotalSeconds: 11.2,
      },
      {
        sourceStart: 5.6,
        sourceEnd: 11.2,
        outputDuration: 5.6,
        referenceTotalSeconds: 11.2,
      },
    ])
    expect(segments.at(-1)?.sourceEnd).toBe(11.2)
  })

  it('15 秒原片 -> 使用最少合法段數拆為兩段 7.5 秒', () => {
    const segments = buildDepthRebuildSegmentPlan(15)

    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.outputDuration)).toEqual([7.5, 7.5])
    expect(segments.map((segment) => segment.referenceTotalSeconds)).toEqual([15, 15])
    expect(segments[0]?.sourceStart).toBe(0)
    expect(segments[1]?.sourceEnd).toBe(15)
  })

  it('7.6 秒原片 -> 無法拆成兩段各至少 4 秒時顯式失敗，不隱式裁短', () => {
    expect(() => buildDepthRebuildSegmentPlan(7.6)).toThrow(DepthRebuildSegmentPlanError)
    expect(() => buildDepthRebuildSegmentPlan(7.6)).toThrow('無法在不裁短的前提下建立合法雙引導分段')
  })

  it.each([3.9, 15.1, Number.NaN, Number.POSITIVE_INFINITY])(
    '原片秒數 %s 超出契約 -> 顯式失敗',
    (sourceDurationSeconds) => {
      expect(() => buildDepthRebuildSegmentPlan(sourceDurationSeconds)).toThrow(
        DepthRebuildSegmentPlanError,
      )
    },
  )

  it('14.9 秒原片 -> 所有段落合法、首尾連續且總輸出不短於原片', () => {
    const segments = buildDepthRebuildSegmentPlan(14.9)

    expect(segments).toHaveLength(2)
    expect(segments[0]?.sourceStart).toBe(0)
    expect(segments[0]?.sourceEnd).toBe(segments[1]?.sourceStart)
    expect(segments.at(-1)?.sourceEnd).toBe(14.9)
    expect(segments.every((segment) => segment.outputDuration >= 4)).toBe(true)
    expect(segments.every((segment) => segment.referenceTotalSeconds <= 15)).toBe(true)
    expect(segments.reduce((total, segment) => total + segment.outputDuration, 0)).toBe(14.9)
  })
})

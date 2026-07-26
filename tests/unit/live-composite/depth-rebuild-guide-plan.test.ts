import { describe, expect, it } from 'vitest'
import {
  DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS,
  DepthRebuildGuidePlanError,
  buildDepthRebuildGuidePlan,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-guide-plan'

describe('depth rebuild adaptive guide plan', () => {
  it('4 秒原片 -> 完整 Depth 與完整 RGB 單筆生成，輸出 4 秒', () => {
    const plan = buildDepthRebuildGuidePlan(4)

    expect(plan.strategy).toBe('full-depth-full-rgb')
    expect(plan.outputDurationSeconds).toBe(4)
    expect(plan.fullDepth).toEqual({
      kind: 'depth',
      selection: 'full-source',
      sourceStartSeconds: 0,
      sourceEndSeconds: 4,
      durationSeconds: 4,
      isFullSource: true,
    })
    expect(plan.secondary).toEqual({
      kind: 'rgb',
      selection: 'full-source',
      sourceStartSeconds: 0,
      sourceEndSeconds: 4,
      durationSeconds: 4,
      isFullSource: true,
      criticalCenterSeconds: null,
    })
    expect(plan.totalReferenceSeconds).toBe(8)
  })

  it('7.2 秒原片 -> 完整雙引導合計 14.4 秒，輸出向上取整為 8 秒', () => {
    const plan = buildDepthRebuildGuidePlan(7.2)

    expect(plan.strategy).toBe('full-depth-full-rgb')
    expect(plan.outputDurationSeconds).toBe(8)
    expect(plan.secondary?.durationSeconds).toBe(7.2)
    expect(plan.totalReferenceSeconds).toBe(14.4)
    expect(plan.budget.remainingSoftBudgetSeconds).toBe(0.1)
  })

  it('7.3 秒原片 -> 完整 Depth 加 7.2 秒關鍵 RGB，不平均拆成兩筆任務', () => {
    const plan = buildDepthRebuildGuidePlan(7.3)

    expect(plan.strategy).toBe('full-depth-critical-rgb')
    expect(plan.outputDurationSeconds).toBe(8)
    expect(plan.fullDepth.durationSeconds).toBe(7.3)
    expect(plan.secondary).toEqual({
      kind: 'rgb',
      selection: 'critical-window',
      sourceStartSeconds: 0.05,
      sourceEndSeconds: 7.25,
      durationSeconds: 7.2,
      isFullSource: false,
      criticalCenterSeconds: 3.65,
    })
    expect(plan.totalReferenceSeconds).toBe(14.5)
  })

  it('11.2 秒原片且指定轉頭中心 -> 保留完整 Depth 並建立置中的 3.3 秒 RGB 片段', () => {
    const plan = buildDepthRebuildGuidePlan(11.2, { criticalCenterSeconds: 8 })

    expect(plan.strategy).toBe('full-depth-critical-rgb')
    expect(plan.outputDurationSeconds).toBe(12)
    expect(plan.secondary).toEqual({
      kind: 'rgb',
      selection: 'critical-window',
      sourceStartSeconds: 6.35,
      sourceEndSeconds: 9.65,
      durationSeconds: 3.3,
      isFullSource: false,
      criticalCenterSeconds: 8,
    })
    expect(plan.totalReferenceSeconds).toBe(14.5)
    expect(plan.displayFacts).toEqual({
      sourceSeconds: 11.2,
      outputSeconds: 12,
      referenceVideoCount: 2,
      fullDepthSeconds: 11.2,
      secondaryRgbSeconds: 3.3,
      totalReferenceSeconds: 14.5,
      softBudgetSeconds: 14.5,
      hardLimitSeconds: 15,
    })
  })

  it('關鍵中心靠近片頭 -> RGB 片段夾在原片範圍且維持完整長度', () => {
    const plan = buildDepthRebuildGuidePlan(11.2, { criticalCenterSeconds: 0.4 })

    expect(plan.secondary?.sourceStartSeconds).toBe(0)
    expect(plan.secondary?.sourceEndSeconds).toBe(3.3)
    expect(plan.secondary?.durationSeconds).toBe(3.3)
  })

  it('12.5 秒原片 -> 剩餘 2 秒仍建立最短合法關鍵 RGB', () => {
    const plan = buildDepthRebuildGuidePlan(12.5)

    expect(plan.strategy).toBe('full-depth-critical-rgb')
    expect(plan.outputDurationSeconds).toBe(13)
    expect(plan.secondary?.durationSeconds).toBe(2)
    expect(plan.totalReferenceSeconds).toBe(14.5)
  })

  it('12.6 秒原片 -> 安全額度不足 2 秒時只送完整 Depth', () => {
    const plan = buildDepthRebuildGuidePlan(12.6)

    expect(plan.strategy).toBe('full-depth-only')
    expect(plan.outputDurationSeconds).toBe(13)
    expect(plan.fullDepth.durationSeconds).toBe(12.6)
    expect(plan.secondary).toBeNull()
    expect(plan.totalReferenceSeconds).toBe(12.6)
    expect(plan.budget.withinSoftBudget).toBe(true)
  })

  it('15 秒原片 -> 單支完整 Depth 可使用供應商 15 秒硬上限', () => {
    const plan = buildDepthRebuildGuidePlan(15)

    expect(plan.strategy).toBe('full-depth-only')
    expect(plan.outputDurationSeconds).toBe(15)
    expect(plan.fullDepth.durationSeconds).toBe(15)
    expect(plan.secondary).toBeNull()
    expect(plan.totalReferenceSeconds).toBe(15)
    expect(plan.budget).toEqual({
      softBudgetSeconds: DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS,
      hardLimitSeconds: 15,
      minimumSecondarySeconds: 2,
      remainingSoftBudgetSeconds: 0,
      withinSoftBudget: false,
      withinHardLimit: true,
    })
  })

  it.each([3.9, 15.1, Number.NaN, Number.POSITIVE_INFINITY])(
    '原片秒數 %s 無效 -> 顯式失敗且不建立 fallback 計畫',
    (sourceDurationSeconds) => {
      expect(() => buildDepthRebuildGuidePlan(sourceDurationSeconds)).toThrow(
        DepthRebuildGuidePlanError,
      )
    },
  )

  it.each([-0.1, 11.3, Number.NaN, Number.NEGATIVE_INFINITY])(
    '11.2 秒原片的關鍵中心 %s 無效 -> 顯式失敗',
    (criticalCenterSeconds) => {
      expect(() => buildDepthRebuildGuidePlan(11.2, { criticalCenterSeconds })).toThrow(
        DepthRebuildGuidePlanError,
      )
    },
  )
})

import { describe, expect, it } from 'vitest'
import {
  applyMaskToEnd,
  applyMaskToStart,
  createMaskKeyframeFromCurrent,
  interpolateMaskRasters,
  mergeAiMaskKeyframes,
  resolveMaskFrame,
  resolveMaskKeyframe,
  upsertMaskKeyframe,
} from '@/app/[locale]/live-composite/lib/mask-keyframes'
import type { MaskKeyframe, MaskStroke } from '@/app/[locale]/live-composite/live-composite-types'

const stroke = (id: string): MaskStroke => ({
  id,
  tool: 'keep',
  size: 0.05,
  points: [{ x: 0.5, y: 0.5 }],
})

const keyframe = (id: string, time: number, strokes: MaskStroke[]): MaskKeyframe => ({ id, time, strokes })

describe('live composite mask keyframes', () => {
  it('播放時間位於兩個關鍵影格之間 -> 沿用前一個遮罩', () => {
    const first = keyframe('a', 0, [stroke('first')])
    const second = keyframe('b', 5, [stroke('second')])
    expect(resolveMaskKeyframe([second, first], 3)?.id).toBe('a')
    expect(resolveMaskKeyframe([second, first], 5.1)?.strokes[0]?.id).toBe('second')
  })

  it('AI 遮罩位於兩個取樣點之間 -> 依位置形變且保留前一格手動畫筆', () => {
    const first: MaskKeyframe = {
      ...keyframe('a', 0, [stroke('manual')]),
      baseMask: { width: 5, height: 1, alpha: new Uint8ClampedArray([200, 0, 0, 0, 0]) },
    }
    const second: MaskKeyframe = {
      ...keyframe('b', 2, [stroke('future')]),
      baseMask: { width: 5, height: 1, alpha: new Uint8ClampedArray([0, 0, 0, 0, 200]) },
    }

    const frame = resolveMaskFrame([first, second], 1)

    expect(frame?.strokes[0]?.id).toBe('manual')
    expect(Array.from(frame?.baseMask?.alpha ?? [])).toEqual([0, 0, 200, 0, 0])
  })

  it('AI 遮罩尺寸改變 -> 在中間影格同步縮放輪廓', () => {
    const first: MaskKeyframe = {
      ...keyframe('a', 0, []),
      baseMask: { width: 5, height: 1, alpha: new Uint8ClampedArray([0, 0, 255, 0, 0]) },
    }
    const second: MaskKeyframe = {
      ...keyframe('b', 2, []),
      baseMask: { width: 5, height: 1, alpha: new Uint8ClampedArray([0, 255, 255, 255, 0]) },
    }

    const alpha = Array.from(resolveMaskFrame([first, second], 1)?.baseMask?.alpha ?? [])
    expect(alpha[2]).toBe(255)
    expect(alpha.filter((value) => value > 0).length).toBeGreaterThan(1)
    expect(alpha[0]).toBe(0)
    expect(alpha[4]).toBe(0)
  })

  it('其中一張 AI 遮罩為空 -> 平滑淡入而不是產生錯誤邊界', () => {
    const empty = { width: 2, height: 1, alpha: new Uint8ClampedArray([0, 0]) }
    const visible = { width: 2, height: 1, alpha: new Uint8ClampedArray([200, 100]) }

    expect(Array.from(interpolateMaskRasters(empty, visible, 0.5).alpha)).toEqual([100, 50])
  })

  it('相鄰 AI 遮罩尺寸不一致 -> 明確沿用前一張而不產生變形資料', () => {
    const first: MaskKeyframe = { ...keyframe('a', 0, []), baseMask: { width: 1, height: 1, alpha: new Uint8ClampedArray([40]) } }
    const second: MaskKeyframe = { ...keyframe('b', 1, []), baseMask: { width: 2, height: 1, alpha: new Uint8ClampedArray([100, 200]) } }

    expect(resolveMaskFrame([first, second], 0.5)?.baseMask).toBe(first.baseMask)
  })

  it('播放時間早於第一個關鍵影格 -> 顯示空遮罩而非偷用未來影格', () => {
    expect(resolveMaskKeyframe([keyframe('future', 3, [stroke('future')])], 1)).toBeNull()
  })

  it('目前時間沒有關鍵影格 -> 複製當前可見遮罩建立新影格', () => {
    const source = keyframe('a', 0, [stroke('person')])
    const result = createMaskKeyframeFromCurrent([source], 2.345, () => 'new')
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ id: 'new', time: 2.35, strokes: source.strokes })
  })

  it('同一時間再次畫筆 -> 更新既有關鍵影格而非新增重複影格', () => {
    const result = upsertMaskKeyframe(
      [keyframe('a', 1, [stroke('old')])],
      1.01,
      [stroke('new')],
      () => 'unused',
    )
    expect(result).toEqual([keyframe('a', 1, [stroke('new')])])
  })

  it('套用到片頭 -> 移除較早差異並保留目前時間之後的影格', () => {
    const currentMask = [stroke('current')]
    const result = applyMaskToStart(
      [keyframe('a', 0, [stroke('old')]), keyframe('b', 2, [stroke('middle')]), keyframe('c', 5, [stroke('later')])],
      3,
      currentMask,
      () => 'start',
    )
    expect(result.map((item) => [item.time, item.strokes[0]?.id])).toEqual([[0, 'current'], [5, 'later']])
  })

  it('套用到片尾 -> 移除後續差異並從目前時間持續到結尾', () => {
    const currentMask = [stroke('current')]
    const result = applyMaskToEnd(
      [keyframe('a', 0, [stroke('old')]), keyframe('b', 5, [stroke('later')])],
      3,
      currentMask,
      () => 'current-frame',
    )
    expect(result.map((item) => [item.time, item.strokes[0]?.id])).toEqual([[0, 'old'], [3, 'current']])
  })

  it('AI 掃描多個時間點 -> 寫入基礎遮罩並保留同時間的手動修補', () => {
    const manual = stroke('manual-fix')
    const aiMask = { width: 2, height: 1, alpha: new Uint8ClampedArray([0, 255]) }
    const result = mergeAiMaskKeyframes(
      [keyframe('start', 0, [manual])],
      [{ time: 0, mask: aiMask }, { time: 1, mask: aiMask }],
      () => 'ai-keyframe',
    )

    expect(result).toHaveLength(2)
    expect(result[0]?.baseMask).toBe(aiMask)
    expect(result[0]?.strokes).toEqual([manual])
    expect(result[1]).toMatchObject({ id: 'ai-keyframe', time: 1, strokes: [], baseMask: aiMask })
  })

  it('從 AI 遮罩時間複製關鍵影格 -> 新影格沿用 AI 基礎遮罩', () => {
    const aiMask = { width: 1, height: 1, alpha: new Uint8ClampedArray([255]) }
    const source: MaskKeyframe = { ...keyframe('start', 0, []), baseMask: aiMask }
    const result = createMaskKeyframeFromCurrent([source], 1, () => 'copy')
    expect(result[1]?.baseMask).toBe(aiMask)
  })
})

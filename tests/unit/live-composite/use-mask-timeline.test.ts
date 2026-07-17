// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMaskTimeline } from '@/app/[locale]/live-composite/useMaskTimeline'
import type { MaskRaster, MaskStroke } from '@/app/[locale]/live-composite/live-composite-types'

const makeStroke = (id: string): MaskStroke => ({
  id,
  tool: 'keep',
  size: 0.06,
  points: [{ x: 0.5, y: 0.5 }],
})

const makeRaster = (): MaskRaster => ({
  width: 2,
  height: 2,
  alpha: new Uint8ClampedArray(4),
})

describe('useMaskTimeline', () => {
  it('AI 掃描期間的手動筆刷編輯 -> 套用 AI 遮罩後仍然保留', () => {
    const { result } = renderHook(() => useMaskTimeline(0))
    // 模擬長時間掃描：掃描開始時取得 applyAiMasks 的（可能過期的）參照。
    const applyAiMasksAtScanStart = result.current.applyAiMasks

    // 掃描進行中，使用者手動畫了一筆。
    act(() => result.current.commitStroke(makeStroke('manual-during-scan')))
    expect(result.current.keyframes[0].strokes.map((stroke) => stroke.id)).toEqual(['manual-during-scan'])

    // 掃描完成，用掃描開始時捕捉到的參照套用結果。
    act(() => applyAiMasksAtScanStart([{ time: 1, mask: makeRaster() }]))

    const startKeyframe = result.current.keyframes.find((keyframe) => keyframe.time === 0)
    expect(startKeyframe?.strokes.map((stroke) => stroke.id)).toContain('manual-during-scan')
    const aiKeyframe = result.current.keyframes.find((keyframe) => keyframe.time === 1)
    expect(aiKeyframe?.baseMask).toBeDefined()
  })

  it('套用 AI 遮罩後復原 -> 依序回到手動編輯狀態與初始狀態，並可重做', () => {
    const { result } = renderHook(() => useMaskTimeline(0))
    act(() => result.current.commitStroke(makeStroke('manual')))
    act(() => result.current.applyAiMasks([{ time: 1, mask: makeRaster() }]))
    expect(result.current.keyframes).toHaveLength(2)

    act(() => result.current.undo())
    expect(result.current.keyframes).toHaveLength(1)
    expect(result.current.keyframes[0].strokes.map((stroke) => stroke.id)).toEqual(['manual'])
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.undo())
    expect(result.current.keyframes[0].strokes).toEqual([])
    expect(result.current.canUndo).toBe(false)

    act(() => result.current.redo())
    expect(result.current.keyframes[0].strokes.map((stroke) => stroke.id)).toEqual(['manual'])
    expect(result.current.canRedo).toBe(true)
  })

  it('新的編輯 -> 清空重做堆疊', () => {
    const { result } = renderHook(() => useMaskTimeline(0))
    act(() => result.current.commitStroke(makeStroke('first')))
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.commitStroke(makeStroke('second')))
    expect(result.current.canRedo).toBe(false)
    expect(result.current.keyframes[0].strokes.map((stroke) => stroke.id)).toEqual(['second'])
  })
})

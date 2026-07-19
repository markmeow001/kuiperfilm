import { describe, expect, it } from 'vitest'
import {
  POSE_ROI_PADDING,
  clipMaskToRoi,
  computePoseUnionRoi,
  describePoseRoiOutcome,
} from '@/app/[locale]/live-composite/lib/person-roi'

describe('computePoseUnionRoi', () => {
  it('單一骨架 -> 外接框加上預設外擴', () => {
    const roi = computePoseUnionRoi([[
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.7 },
      { x: 0.5, y: 0.5 },
    ]])
    expect(roi).toEqual({
      x: 0.4 - POSE_ROI_PADDING,
      y: 0.3 - POSE_ROI_PADDING,
      w: 0.2 + POSE_ROI_PADDING * 2,
      h: 0.4 + POSE_ROI_PADDING * 2,
    })
  })

  it('兩個骨架 -> 取聯集外接框（涵蓋兩人，中間區域也包含）', () => {
    const roi = computePoseUnionRoi([
      [{ x: 0.1, y: 0.4 }, { x: 0.2, y: 0.9 }],
      [{ x: 0.8, y: 0.35 }, { x: 0.9, y: 0.85 }],
    ], 0)
    expect(roi).toEqual({ x: 0.1, y: 0.35, w: 0.8, h: 0.55 })
  })

  it('自訂外擴值 -> 每側各外擴指定量', () => {
    const roi = computePoseUnionRoi([[{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }]], 0.05)
    expect(roi?.x).toBeCloseTo(0.45)
    expect(roi?.y).toBeCloseTo(0.45)
    expect(roi?.w).toBeCloseTo(0.2)
    expect(roi?.h).toBeCloseTo(0.2)
  })

  it('外擴超出畫面 -> 夾在 0-1 範圍內', () => {
    const roi = computePoseUnionRoi([[{ x: 0.05, y: 0.02 }, { x: 0.98, y: 0.95 }]])
    expect(roi).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('沒有骨架（空輸入）-> 回傳 null（不裁切）', () => {
    expect(computePoseUnionRoi([])).toBeNull()
    expect(computePoseUnionRoi([[]])).toBeNull()
  })

  it('全部關鍵點無效（NaN）-> 回傳 null 而不是 NaN 框', () => {
    expect(computePoseUnionRoi([[{ x: Number.NaN, y: Number.NaN }]])).toBeNull()
  })

  it('骨架完全在畫面外 -> 夾住後面積為零，視同無骨架回傳 null', () => {
    expect(computePoseUnionRoi([[{ x: 1.5, y: 0.5 }, { x: 1.8, y: 0.9 }]], 0)).toBeNull()
  })

  it('外擴值為負 -> 明確拋錯', () => {
    expect(() => computePoseUnionRoi([[{ x: 0.5, y: 0.5 }]], -0.1)).toThrow('骨架範圍外擴值')
  })
})

describe('clipMaskToRoi', () => {
  const width = 4
  const height = 4
  const fullMask = () => new Float32Array(width * height).fill(1)

  it('ROI 內的值保留、ROI 外歸零', () => {
    // ROI 覆蓋中間 2x2 像素（x: 0.25-0.75, y: 0.25-0.75）
    const clipped = clipMaskToRoi(fullMask(), width, height, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    const expected = [
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ]
    expect(Array.from(clipped)).toEqual(expected)
  })

  it('回傳的是複本 -> 原始遮罩不被改動', () => {
    const original = fullMask()
    const clipped = clipMaskToRoi(original, width, height, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    expect(clipped).not.toBe(original)
    expect(Array.from(original)).toEqual(Array(width * height).fill(1))
  })

  it('roi=null -> 原封不動回傳同一個遮罩（無骨架 = 不裁切）', () => {
    const original = fullMask()
    expect(clipMaskToRoi(original, width, height, null)).toBe(original)
  })

  it('部分覆蓋像素 -> floor/ceil 保留邊界像素', () => {
    // x: 0.3-0.6 橫跨像素 1（0.25-0.5）與像素 2（0.5-0.75）的一部分 -> 兩者都保留
    const clipped = clipMaskToRoi(fullMask(), width, height, { x: 0.3, y: 0, w: 0.3, h: 1 })
    expect(Array.from(clipped.subarray(0, 4))).toEqual([0, 1, 1, 0])
  })

  it('也支援 Uint8ClampedArray 遮罩', () => {
    const mask = new Uint8ClampedArray(width * height).fill(255)
    const clipped = clipMaskToRoi(mask, width, height, { x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(clipped).toBeInstanceOf(Uint8ClampedArray)
    expect(clipped[0]).toBe(255)
    expect(clipped[width * height - 1]).toBe(0)
  })

  it('遮罩長度與尺寸不符 -> 明確拋錯', () => {
    expect(() => clipMaskToRoi(new Float32Array(3), width, height, { x: 0, y: 0, w: 1, h: 1 })).toThrow('遮罩資料長度不符')
  })

  it('尺寸無效 -> 明確拋錯', () => {
    expect(() => clipMaskToRoi(new Float32Array(0), 0, 0, { x: 0, y: 0, w: 1, h: 1 })).toThrow('遮罩尺寸無效')
  })
})

describe('describePoseRoiOutcome', () => {
  it('設定關閉 -> 不顯示任何裁切訊息', () => {
    expect(describePoseRoiOutcome(false, [true, false])).toBe('')
  })

  it('單一影格已裁切 -> 已套用骨架範圍裁切', () => {
    expect(describePoseRoiOutcome(true, [true])).toBe('已套用骨架範圍裁切。')
  })

  it('單一影格偵測不到骨架 -> 明確回報未裁切', () => {
    expect(describePoseRoiOutcome(true, [false])).toBe('未偵測到骨架，此影格未裁切。')
  })

  it('整段掃描 -> 回報 N / M 影格已裁切與未裁切數', () => {
    expect(describePoseRoiOutcome(true, [true, false, true])).toBe('2 / 3 影格已套用骨架範圍裁切，其餘 1 格未偵測到骨架、未裁切。')
    expect(describePoseRoiOutcome(true, [true, true])).toBe('2 / 2 影格已套用骨架範圍裁切。')
  })
})

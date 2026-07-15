import { describe, expect, it } from 'vitest'
import { focalLengthToFov, fovToFocalLength, frameCameraAtDistance } from '@/app/[locale]/canvas/director/camera-lens'

describe('camera lens conversion', () => {
  it('50mm 全画幅 -> 约 27 度垂直 FOV', () => {
    expect(focalLengthToFov(50)).toBeCloseTo(26.99, 1)
  })

  it('焦段转 FOV 再转回 -> 保留原焦段', () => {
    for (const mm of [18, 24, 35, 50, 85, 135]) {
      expect(fovToFocalLength(focalLengthToFov(mm))).toBeCloseTo(mm, 8)
    }
  })

  it('无效焦段 -> 明确抛错', () => {
    expect(() => focalLengthToFov(0)).toThrow('焦段必须是正数')
  })

  it('主体构图 -> 保留当前角度并设定精确距离', () => {
    expect(frameCameraAtDistance([3, 1, 4], [0, 1, 0], 10)).toEqual([6, 1, 8])
  })
})

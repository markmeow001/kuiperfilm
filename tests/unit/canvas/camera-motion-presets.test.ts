import { describe, expect, it } from 'vitest'
import { applyCameraMovePreset, CAMERA_MOVE_PRESETS } from '@/app/[locale]/canvas/director/camera-motion-presets'
import { makeShot } from '@/app/[locale]/canvas/director/previz-types'

const actors = {
  person: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
}

function shot() {
  return makeShot('shot-1', 0, { position: [0, 1, 5], target: [0, 1, 0], fov: 45 }, actors)
}

describe('camera motion presets', () => {
  it('预设目录 -> 固定提供六种常用运镜', () => {
    expect(CAMERA_MOVE_PRESETS.map((item) => item.label)).toEqual(['推进', '拉远', '横移', '升降', '环绕', '跟拍'])
  })

  it('推进 -> 落幅摄影机靠近主体且不移动注视点', () => {
    const result = applyCameraMovePreset(shot(), 'push-in')!
    expect(result.end.camera.position).toEqual([0, 1, 3.25])
    expect(result.end.camera.target).toEqual([0, 1, 0])
    expect(result.note).toContain('推进')
  })

  it('环绕 -> 建立曲线路径点和 45 度落幅', () => {
    const result = applyCameraMovePreset(shot(), 'orbit-right')!
    expect(result.cameraWaypoints).toHaveLength(1)
    expect(result.end.camera.position[0]).toBeCloseTo(3.5355, 3)
    expect(result.end.camera.position[2]).toBeCloseTo(3.5355, 3)
  })

  it('跟拍有锁定目标 -> 摄影机和注视点同步目标位移', () => {
    const input = shot()
    input.end.actors.person.position = [2, 0, -1]
    const result = applyCameraMovePreset(input, 'follow', 'person')!
    expect(result.end.camera.position).toEqual([2, 1, 4])
    expect(result.end.camera.target).toEqual([2, 1, -1])
  })

  it('跟拍没有有效目标 -> 明确返回 null', () => {
    expect(applyCameraMovePreset(shot(), 'follow', null)).toBeNull()
    expect(applyCameraMovePreset(shot(), 'follow', 'missing')).toBeNull()
  })
})

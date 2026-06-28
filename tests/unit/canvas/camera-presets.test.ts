import { describe, it, expect } from 'vitest'
import { CAMERA_PRESETS, computePreset, aspectRatio } from '@/app/[locale]/canvas/director/camera-presets'

describe('camera presets', () => {
  it('ships 15 presets, 当前视角 first + flagged current', () => {
    expect(CAMERA_PRESETS).toHaveLength(15)
    expect(CAMERA_PRESETS[0]).toMatchObject({ name: '当前视角', current: true })
    expect(CAMERA_PRESETS.filter((p) => p.current)).toHaveLength(1)
  })

  it('places a front shot in front of a subject facing +Z', () => {
    const front = CAMERA_PRESETS.find((p) => p.name === '正面中景')!
    const shot = computePreset(front, [0, 1, 0], 0)
    // facing +Z, front offset is +Z → camera ends up at +Z of the focus
    expect(shot.position[2]).toBeGreaterThan(0)
    expect(shot.position[0]).toBeCloseTo(0, 5)
  })

  it('rotates offsets by the subject facing (180° → behind)', () => {
    const front = CAMERA_PRESETS.find((p) => p.name === '正面中景')!
    const shot = computePreset(front, [0, 1, 0], Math.PI) // facing -Z
    // front-of-subject now points to -Z in world
    expect(shot.position[2]).toBeLessThan(0)
  })

  it('当前视角 uses the live view when provided', () => {
    const cur = CAMERA_PRESETS[0]
    const view = { position: [5, 5, 5] as [number, number, number], target: [1, 1, 1] as [number, number, number], fov: 60 }
    expect(computePreset(cur, [0, 1, 0], 0, view)).toMatchObject({ position: [5, 5, 5], target: [1, 1, 1], fov: 60, roll: 0 })
  })

  it('荷兰角 carries a non-zero roll', () => {
    const dutch = CAMERA_PRESETS.find((p) => p.name === '荷兰角')!
    expect(computePreset(dutch, [0, 1, 0], 0).roll).not.toBe(0)
  })

  it('aspectRatio maps tokens, null for auto', () => {
    expect(aspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(aspectRatio('9:16')).toBeCloseTo(9 / 16)
    expect(aspectRatio('1:1')).toBe(1)
    expect(aspectRatio('auto')).toBeNull()
    expect(aspectRatio(undefined)).toBeNull()
  })
})

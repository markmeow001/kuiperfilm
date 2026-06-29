import { describe, it, expect } from 'vitest'
import { normalizeStage, DEFAULT_STAGE } from '@/app/[locale]/canvas/director/stage-types'
import { REST_POSE } from '@/app/[locale]/canvas/director/pose-presets'

describe('normalizeStage', () => {
  it('migrates a v1 single `camera` into cameras[]', () => {
    const v1 = { mannequins: [], camera: { position: [1, 2, 3], target: [0, 1, 0], fov: 50 } }
    const out = normalizeStage(v1)
    expect(out.cameras).toHaveLength(1)
    expect(out.cameras[0]).toMatchObject({ position: [1, 2, 3], target: [0, 1, 0], fov: 50 })
    expect(out.cameras[0].id).toBeTruthy()
  })

  it('keeps existing cameras[] as-is', () => {
    const v2 = { mannequins: [], cameras: [{ id: 'c1', label: '机位1', position: [0, 1, 4], target: [0, 1, 0], fov: 45 }] }
    expect(normalizeStage(v2).cameras).toEqual(v2.cameras)
  })

  it('backfills REST_POSE for pre-rig mannequins, keeps posed ones', () => {
    const posed = { id: 'b', label: 'x', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#fff', pose: REST_POSE }
    const out = normalizeStage({
      mannequins: [{ id: 'a', label: 'x', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#fff' }, posed],
      cameras: [],
    })
    expect(out.mannequins[0].pose).toEqual(REST_POSE)
    expect(out.mannequins[1]).toBe(posed) // untouched reference
  })

  it('falls back to DEFAULT_STAGE cameras when none present', () => {
    expect(normalizeStage({ mannequins: [] }).cameras).toHaveLength(DEFAULT_STAGE.cameras.length)
  })

  it('defaults background to none + sanitizes an invalid mode', () => {
    expect(normalizeStage({ mannequins: [] }).background?.mode).toBe('none')
    expect(normalizeStage({ mannequins: [], background: { mode: 'bogus' } }).background?.mode).toBe('none')
    const bg = normalizeStage({ mannequins: [], background: { mode: 'sphere', key: 'images/x.png', radius: 40 } }).background!
    expect(bg.mode).toBe('sphere')
    expect(bg.key).toBe('images/x.png')
    expect(bg.radius).toBe(40)
  })

  it('never throws on garbage / null elements', () => {
    expect(() => normalizeStage(null)).not.toThrow()
    expect(() => normalizeStage(undefined)).not.toThrow()
    expect(() => normalizeStage('nonsense')).not.toThrow()
    expect(normalizeStage(null).mannequins).toEqual([])
    // null elements inside arrays must be dropped, not crash
    const out = normalizeStage({ mannequins: [null, { id: 'a', label: 'x', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#fff' }], cameras: [null] })
    expect(out.mannequins).toHaveLength(1)
    expect(out.cameras.length).toBeGreaterThan(0) // fell back to default
  })
})

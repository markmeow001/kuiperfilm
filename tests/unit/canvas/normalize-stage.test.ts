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

  it('keeps existing cameras[] core fields (normalized shape)', () => {
    const v2 = { mannequins: [], cameras: [{ id: 'c1', label: '机位1', position: [0, 1, 4], target: [0, 1, 0], fov: 45 }] }
    expect(normalizeStage(v2).cameras[0]).toMatchObject({ id: 'c1', label: '机位1', position: [0, 1, 4], target: [0, 1, 0], fov: 45 })
  })

  it('backfills REST_POSE for pre-rig mannequins, preserves posed ones', () => {
    const out = normalizeStage({
      mannequins: [
        { id: 'a', label: 'x', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#fff' },
        { id: 'b', label: 'x', position: [1, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#fff', pose: REST_POSE },
      ],
      cameras: [],
    })
    expect(out.mannequins[0].pose).toEqual(REST_POSE)
    expect(out.mannequins[1]).toMatchObject({ id: 'b', position: [1, 0, 0], pose: REST_POSE })
  })

  it('drops malformed mannequin/camera elements (no undefined Vec3 → no R3F crash)', () => {
    const out = normalizeStage({
      mannequins: [42, null, { id: 'ok', position: [1, 2, 3] }, { id: 'bad', position: 'nope' }],
      cameras: [{ id: 'c', position: [0, 1, 4] }, 'garbage'],
    })
    // numbers/null dropped; objects kept with coerced Vec3 fallbacks
    expect(out.mannequins.every((m) => Array.isArray(m.position) && m.position.length === 3)).toBe(true)
    expect(out.mannequins.find((m) => m.id === 'bad')?.position).toEqual([0, 0, 0]) // invalid → fallback
    expect(out.cameras.every((c) => Array.isArray(c.position) && c.position.length === 3)).toBe(true)
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

  it('carries previz shots through (v3), defaulting to [] for old saves', () => {
    expect(normalizeStage({ mannequins: [] }).shots).toEqual([])
    const kf = { camera: { position: [0, 1.6, 4], target: [0, 1, 0], fov: 45 }, actors: {} }
    const out = normalizeStage({ mannequins: [], shots: [{ id: 's1', durationSec: 4, start: kf, end: kf }, 'garbage'] })
    expect(out.shots).toHaveLength(1)
    expect(out.shots[0]).toMatchObject({ id: 's1', durationSec: 4, easing: 'easeInOut' })
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

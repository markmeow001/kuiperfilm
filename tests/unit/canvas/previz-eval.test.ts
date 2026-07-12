import { describe, it, expect } from 'vitest'
import {
  MAX_SCENE_SEC,
  SHOT_MIN_SEC,
  clampShots,
  makeShot,
  normalizeShots,
  type StageShot,
} from '@/app/[locale]/canvas/director/previz-types'
import { evalShot, locateInSequence } from '@/app/[locale]/canvas/director/previz-eval'

const keyframe = (
  camPos: [number, number, number],
  actors: StageShot['start']['actors'] = {},
  extra: Partial<StageShot['start']['camera']> = {},
) => ({
  camera: { position: camPos, target: [0, 1, 0] as [number, number, number], fov: 45, ...extra },
  actors,
})

const shot = (over: Partial<StageShot> = {}): StageShot => ({
  id: 's1',
  label: '01 测试镜头',
  durationSec: 5,
  start: keyframe([0, 1.6, 4]),
  end: keyframe([2, 1.6, 4]),
  easing: 'linear',
  ...over,
})

describe('evalShot — camera', () => {
  it('t=0 returns exactly the 起幅 camera, t=1 exactly the 落幅', () => {
    const s = shot({
      start: keyframe([0, 1.6, 4], {}, { fov: 30, roll: -10 }),
      end: keyframe([2, 3, 8], {}, { fov: 60, roll: 10 }),
    })
    const a = evalShot(s, 0)
    expect(a.camera.position).toEqual([0, 1.6, 4])
    expect(a.camera.fov).toBe(30)
    expect(a.camera.roll).toBe(-10)
    const b = evalShot(s, 1)
    expect(b.camera.position).toEqual([2, 3, 8])
    expect(b.camera.fov).toBe(60)
    expect(b.camera.roll).toBe(10)
  })

  it('linear midpoint lerps position/target/fov, missing roll defaults to 0', () => {
    const s = shot({
      start: { camera: { position: [0, 0, 0], target: [0, 1, 0], fov: 40 }, actors: {} },
      end: { camera: { position: [4, 2, 0], target: [0, 1, 4], fov: 60 }, actors: {} },
    })
    const mid = evalShot(s, 0.5)
    expect(mid.camera.position[0]).toBeCloseTo(2)
    expect(mid.camera.position[1]).toBeCloseTo(1)
    expect(mid.camera.target[2]).toBeCloseTo(2)
    expect(mid.camera.fov).toBeCloseTo(50)
    expect(mid.camera.roll).toBe(0)
  })

  it('passes through 运镜关键点 (waypoint lies on the path at its parameter region)', () => {
    // start (0,0,0) → waypoint (0,5,0) → end (10,0,0): at t=0.5 the camera must
    // be pulled well above the straight start→end line (y would be 0 without it).
    const s = shot({
      start: keyframe([0, 0, 0]),
      end: keyframe([10, 0, 0]),
      cameraWaypoints: [[0, 5, 0]],
    })
    const mid = evalShot(s, 0.5)
    expect(mid.camera.position[1]).toBeGreaterThan(2)
  })

  it('easeInOut is slower than linear near t=0 but identical at endpoints', () => {
    const lin = shot({ easing: 'linear' })
    const ease = shot({ easing: 'easeInOut' })
    expect(evalShot(ease, 0).camera.position).toEqual(evalShot(lin, 0).camera.position)
    expect(evalShot(ease, 1).camera.position).toEqual(evalShot(lin, 1).camera.position)
    // near the start the eased camera has moved LESS than linear
    expect(evalShot(ease, 0.15).camera.position[0]).toBeLessThan(evalShot(lin, 0.15).camera.position[0])
  })

  it('clamps t outside [0,1]', () => {
    const s = shot()
    expect(evalShot(s, -1).camera.position).toEqual(s.start.camera.position)
    expect(evalShot(s, 2).camera.position).toEqual(s.end.camera.position)
  })
})

describe('evalShot — actors (调度)', () => {
  it('lerps an actor from 起幅 to 落幅 placement', () => {
    const s = shot({
      start: keyframe([0, 1.6, 4], { a: { position: [0, 0, 0], rotation: [0, 0, 0] } }),
      end: keyframe([0, 1.6, 4], { a: { position: [4, 0, 0], rotation: [0, 0, 0] } }),
    })
    expect(evalShot(s, 0.5).actors.a.position[0]).toBeCloseTo(2)
  })

  it('routes an actor through its 调度线 waypoints', () => {
    const s = shot({
      start: keyframe([0, 1.6, 4], { a: { position: [0, 0, 0], rotation: [0, 0, 0] } }),
      end: keyframe([0, 1.6, 4], { a: { position: [10, 0, 0], rotation: [0, 0, 0] } }),
      movePaths: { a: [[5, 0, 6]] },
    })
    expect(evalShot(s, 0.5).actors.a.position[2]).toBeGreaterThan(2)
  })

  it('faces the actor along its path tangent (model faces +Z at rest → yaw=atan2(dx,dz))', () => {
    // straight walk toward +X → yaw ≈ +90°
    const s = shot({
      start: keyframe([0, 1.6, 4], { a: { position: [0, 0, 0], rotation: [0, 0, 0] } }),
      end: keyframe([0, 1.6, 4], { a: { position: [10, 0, 0], rotation: [0, 0, 0] } }),
    })
    expect(evalShot(s, 0.5).actors.a.rotation[1]).toBeCloseTo(Math.PI / 2, 1)
  })

  it('a stationary actor keeps its keyframed rotation (no tangent snap on zero-length path)', () => {
    const s = shot({
      start: keyframe([0, 1.6, 4], { a: { position: [1, 0, 1], rotation: [0, 0.7, 0] } }),
      end: keyframe([0, 1.6, 4], { a: { position: [1, 0, 1], rotation: [0, 0.7, 0] } }),
    })
    expect(evalShot(s, 0.5).actors.a.rotation[1]).toBeCloseTo(0.7)
    expect(evalShot(s, 0.5).actors.a.position).toEqual([1, 0, 1])
  })

  it('an actor present only in 起幅 stays at its start placement', () => {
    const s = shot({
      start: keyframe([0, 1.6, 4], { a: { position: [3, 0, 3], rotation: [0, 1, 0] } }),
      end: keyframe([0, 1.6, 4], {}),
    })
    expect(evalShot(s, 0.8).actors.a.position).toEqual([3, 0, 3])
  })
})

describe('locateInSequence', () => {
  const shots = [shot({ id: 'a', durationSec: 7.5 }), shot({ id: 'b', durationSec: 5 }), shot({ id: 'c', durationSec: 1.5 })]

  it('maps a global time into { index, t }', () => {
    expect(locateInSequence(shots, 0)).toEqual({ index: 0, t: 0 })
    const mid = locateInSequence(shots, 10)! // 7.5 + 2.5 → shot b at 2.5/5
    expect(mid.index).toBe(1)
    expect(mid.t).toBeCloseTo(0.5)
  })

  it('boundary lands on the NEXT shot start; clamps past the end', () => {
    expect(locateInSequence(shots, 7.5)).toEqual({ index: 1, t: 0 })
    const end = locateInSequence(shots, 99)!
    expect(end.index).toBe(2)
    expect(end.t).toBe(1)
  })

  it('returns null for an empty sequence', () => {
    expect(locateInSequence([], 3)).toBeNull()
  })
})

describe('clampShots — 全片 ≤15s 硬顶', () => {
  it('keeps a valid sequence untouched', () => {
    const shots = [shot({ id: 'a', durationSec: 7.5 }), shot({ id: 'b', durationSec: 7.5 })]
    expect(clampShots(shots)).toEqual(shots)
  })

  it('clamps the overflowing shot to the remaining budget and drops later ones', () => {
    const out = clampShots([
      shot({ id: 'a', durationSec: 10 }),
      shot({ id: 'b', durationSec: 10 }), // only 5 left
      shot({ id: 'c', durationSec: 3 }), // 0 left → dropped
    ])
    expect(out.map((s) => s.id)).toEqual(['a', 'b'])
    expect(out[1].durationSec).toBe(5)
  })

  it('enforces the per-shot minimum', () => {
    const out = clampShots([shot({ id: 'a', durationSec: 0.1 })])
    expect(out[0].durationSec).toBe(SHOT_MIN_SEC)
    expect(MAX_SCENE_SEC).toBe(15)
  })
})

describe('normalizeShots — 坏数据降级', () => {
  it('non-array / garbage entries → []', () => {
    expect(normalizeShots(undefined)).toEqual([])
    expect(normalizeShots('nope')).toEqual([])
    expect(normalizeShots([42, null, 'x'])).toEqual([])
  })

  it('fills defaults for a minimal valid shot and drops malformed vectors', () => {
    const out = normalizeShots([
      {
        id: 's1',
        durationSec: 3,
        start: { camera: { position: [0, 1, 4], target: [0, 1, 0], fov: 45 }, actors: { a: { position: 'bad', rotation: [0, 0, 0] } } },
        end: { camera: { position: [1, 1, 4], target: [0, 1, 0], fov: 45 }, actors: {} },
        cameraWaypoints: [[0, 2, 0], 'garbage'],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].label).toBeTruthy()
    expect(out[0].easing).toBe('easeInOut')
    expect(out[0].start.actors.a.position).toEqual([0, 0, 0]) // bad vec → fallback
    expect(out[0].cameraWaypoints).toEqual([[0, 2, 0]]) // garbage waypoint dropped
  })

  it('a shot without keyframes is dropped (unrenderable)', () => {
    expect(normalizeShots([{ id: 'x', durationSec: 3 }])).toEqual([])
  })
})

describe('makeShot', () => {
  it('snapshots the given camera + actor placements into identical start/end keyframes', () => {
    const s = makeShot('id9', 2, { position: [1, 2, 3], target: [0, 1, 0], fov: 50, roll: 5 }, {
      m1: { position: [0, 0, 1], rotation: [0, 0.5, 0] },
    })
    expect(s.id).toBe('id9')
    expect(s.label).toContain('03') // index 2 → 第 3 镜
    expect(s.start.camera).toEqual({ position: [1, 2, 3], target: [0, 1, 0], fov: 50, roll: 5 })
    expect(s.end).toEqual(s.start)
    expect(s.start.actors.m1.position).toEqual([0, 0, 1])
    // start/end must be independent copies — mutating one must not leak into the other
    s.start.actors.m1.position[0] = 99
    expect(s.end.actors.m1.position[0]).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import { WALK_STRIDE_M, walkJointAngles } from '@/app/[locale]/canvas/director/walk-cycle'
import { evalShot } from '@/app/[locale]/canvas/director/previz-eval'
import type { StageShot } from '@/app/[locale]/canvas/director/previz-types'

describe('walkJointAngles', () => {
  it('phase 0 → hips neutral, knees non-negative bend, slight constant elbow', () => {
    const a = walkJointAngles(0)
    expect(a.hipL).toBeCloseTo(0)
    expect(a.hipR).toBeCloseTo(0)
    expect(a.kneeL).toBeGreaterThanOrEqual(0)
    expect(a.kneeR).toBeGreaterThanOrEqual(0)
    expect(a.elbowL).toBeLessThan(0) // 摆臂常态微屈（pose 惯例：elbow.x<0 = 前屈）
  })

  it('legs anti-phase: hipL(φ) === -hipR(φ); arms counter same-side leg', () => {
    for (const phase of [0.4, 1.3, 2.9, 4.4]) {
      const a = walkJointAngles(phase)
      expect(a.hipL).toBeCloseTo(-a.hipR, 5)
      // 同侧肩与髋反向（左腿前摆时左臂后摆）
      expect(Math.sign(a.shoulderL) === 0 || Math.sign(a.shoulderL) !== Math.sign(a.hipL)).toBe(true)
    }
  })

  it('is 2π-periodic and bounded (no runaway angles)', () => {
    const a = walkJointAngles(1.1)
    const b = walkJointAngles(1.1 + Math.PI * 2)
    expect(a.hipL).toBeCloseTo(b.hipL, 5)
    for (const v of Object.values(walkJointAngles(2.2))) {
      expect(Math.abs(v)).toBeLessThan(Math.PI / 2)
    }
  })

  it('intensity 0 → everything neutral except nothing (flat zero)', () => {
    const a = walkJointAngles(1.7, 0)
    for (const v of [a.hipL, a.hipR, a.kneeL, a.kneeR, a.shoulderL, a.shoulderR]) expect(v).toBeCloseTo(0)
  })

  it('exports a sane stride length', () => {
    expect(WALK_STRIDE_M).toBeGreaterThan(0.3)
    expect(WALK_STRIDE_M).toBeLessThan(2)
  })
})

describe('evalShot — travelDist for walk phase', () => {
  const kf = (actors: StageShot['start']['actors']) => ({
    camera: { position: [0, 1.6, 4] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 45 },
    actors,
  })

  it('straight 10m path at linear t=0.5 → ~5m traveled, moving=true', () => {
    const s: StageShot = {
      id: 's',
      label: 'x',
      durationSec: 5,
      easing: 'linear',
      start: kf({ a: { position: [0, 0, 0], rotation: [0, 0, 0] } }),
      end: kf({ a: { position: [10, 0, 0], rotation: [0, 0, 0] } }),
    }
    const mid = evalShot(s, 0.5).actors.a
    expect(mid.moving).toBe(true)
    expect(mid.travelDist).toBeCloseTo(5, 1)
  })

  it('stationary actor → moving=false, travelDist 0', () => {
    const s: StageShot = {
      id: 's',
      label: 'x',
      durationSec: 5,
      easing: 'linear',
      start: kf({ a: { position: [2, 0, 2], rotation: [0, 0, 0] } }),
      end: kf({ a: { position: [2, 0, 2], rotation: [0, 0, 0] } }),
    }
    const mid = evalShot(s, 0.5).actors.a
    expect(mid.moving).toBe(false)
    expect(mid.travelDist).toBe(0)
  })
})

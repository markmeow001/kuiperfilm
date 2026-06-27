import { describe, it, expect } from 'vitest'
import { POSE_PRESETS, REST_POSE, RIG_SLIDER_GROUPS, type Joint } from '@/app/[locale]/canvas/director/pose-presets'

const ALL_JOINTS: Joint[] = ['spine', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR', 'kneeL', 'kneeR']

describe('pose presets', () => {
  it('ships 20 named presets, 站立 first', () => {
    expect(POSE_PRESETS).toHaveLength(20)
    expect(POSE_PRESETS[0].name).toBe('站立')
    expect(new Set(POSE_PRESETS.map((p) => p.name)).size).toBe(20) // unique names
  })

  it('every preset defines all 10 joints with finite 3-axis rotations + a root', () => {
    for (const { name, pose } of POSE_PRESETS) {
      expect(pose.root, name).toHaveLength(3)
      expect(pose.root.every(Number.isFinite), name).toBe(true)
      for (const joint of ALL_JOINTS) {
        const v = pose.joints[joint]
        expect(v, `${name}/${joint}`).toHaveLength(3)
        expect(v.every(Number.isFinite), `${name}/${joint}`).toBe(true)
      }
    }
  })

  it('REST_POSE is fully zeroed', () => {
    expect(REST_POSE.root).toEqual([0, 0, 0])
    for (const joint of ALL_JOINTS) expect(REST_POSE.joints[joint]).toEqual([0, 0, 0])
  })

  it('站立 preset equals rest', () => {
    expect(POSE_PRESETS[0].pose).toEqual(REST_POSE)
  })

  it('rig sliders only reference real joints/axes', () => {
    for (const g of RIG_SLIDER_GROUPS) {
      for (const row of g.rows) {
        expect(ALL_JOINTS).toContain(row.joint)
        expect([0, 1, 2]).toContain(row.axis)
      }
    }
  })
})

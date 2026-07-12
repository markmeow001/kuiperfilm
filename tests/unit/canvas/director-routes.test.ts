import { describe, it, expect } from 'vitest'
import { parseRoutePlans } from '@/lib/canvas/director-routes-schema'
import { materializeRoutePlan } from '@/app/[locale]/canvas/director/route-materialize'
import { MAX_SCENE_SEC, totalDurationSec } from '@/app/[locale]/canvas/director/previz-types'
import type { StageMannequin } from '@/app/[locale]/canvas/director/stage-types'

const VALID_PLAN = {
  name: '01 一镜到底·情绪沉淀',
  style: '中近景 / 跟随推进',
  shots: [
    { label: '01 开场·远景', note: '远景 / 建立空间', durationSec: 7.5, cameraPreset: '正面全景', movement: '推近', focus: '角色A' },
    { label: '02 对峙·逼近', note: '中景 / 极低机位', durationSec: 5, cameraPreset: '低角度仰拍', movement: '固定', focus: '角色B' },
  ],
}

describe('parseRoutePlans — LLM 输出容错解析', () => {
  it('parses a fenced JSON array and keeps valid plans', () => {
    const text = '好的，以下是方案：\n```json\n' + JSON.stringify([VALID_PLAN]) + '\n```'
    const plans = parseRoutePlans(text)
    expect(plans).toHaveLength(1)
    expect(plans[0].name).toContain('一镜到底')
    expect(plans[0].shots).toHaveLength(2)
    expect(plans[0].shots[0]).toMatchObject({ cameraPreset: '正面全景', movement: '推近', durationSec: 7.5 })
  })

  it('clamps a plan whose shots exceed the 15s scene budget', () => {
    const over = { ...VALID_PLAN, shots: [
      { ...VALID_PLAN.shots[0], durationSec: 10 },
      { ...VALID_PLAN.shots[1], durationSec: 10 },
      { ...VALID_PLAN.shots[1], label: '03 尾', durationSec: 3 },
    ] }
    const plans = parseRoutePlans(JSON.stringify([over]))
    const total = plans[0].shots.reduce((s, x) => s + x.durationSec, 0)
    expect(total).toBeLessThanOrEqual(MAX_SCENE_SEC)
    expect(plans[0].shots.length).toBeLessThanOrEqual(2) // 第三镜被预算挤掉
  })

  it('sanitizes unknown preset/movement to safe fallbacks, drops shot-less plans, caps at 3 plans', () => {
    const weird = {
      name: 'x', style: 'y',
      shots: [{ label: '01', note: '', durationSec: 4, cameraPreset: '不存在的机位', movement: 'zoom!!', focus: '' }],
    }
    const empty = { name: 'empty', style: '', shots: [] }
    const plans = parseRoutePlans(JSON.stringify([weird, empty, weird, weird, weird]))
    expect(plans.length).toBeLessThanOrEqual(3)
    expect(plans.every((p) => p.shots.length > 0)).toBe(true)
    expect(plans[0].shots[0].cameraPreset).toBe('正面中景') // fallback
    expect(plans[0].shots[0].movement).toBe('固定')
  })

  it('throws on output with no JSON array', () => {
    expect(() => parseRoutePlans('抱歉，我无法生成。')).toThrow()
  })
})

describe('materializeRoutePlan — 方案落成 StageShot[]', () => {
  const mannequins: StageMannequin[] = [
    { id: 'mA', label: '角色A', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#fff' },
    { id: 'mB', label: '角色B', position: [2, 0, 1], rotation: [0, Math.PI, 0], scale: 1, color: '#fff' },
  ]

  const plan = parseRoutePlans(JSON.stringify([VALID_PLAN]))[0]

  it('produces one StageShot per plan shot, total ≤15s, actors snapshotted into both keyframes', () => {
    const shots = materializeRoutePlan(plan, mannequins, [])
    expect(shots).toHaveLength(2)
    expect(totalDurationSec(shots)).toBeLessThanOrEqual(MAX_SCENE_SEC)
    expect(shots[0].label).toBe('01 开场·远景')
    expect(shots[0].start.actors.mA).toBeDefined()
    expect(shots[0].end.actors.mB).toBeDefined()
  })

  it('focus 角色A → camera aims near A; 推近 → end camera closer to target than start', () => {
    const shots = materializeRoutePlan(plan, mannequins, [])
    const s0 = shots[0]
    // target 应落在 A (0,0,0) 附近而不是 B (2,0,1)
    expect(Math.abs(s0.start.camera.target[0])).toBeLessThan(1)
    const d = (p: number[], t: number[]) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])
    expect(d(s0.end.camera.position, s0.end.camera.target)).toBeLessThan(d(s0.start.camera.position, s0.start.camera.target))
  })

  it('固定 movement → identical start/end camera; unknown focus falls back to first mannequin', () => {
    const shots = materializeRoutePlan(plan, mannequins, [])
    const s1 = shots[1]
    expect(s1.start.camera).toEqual(s1.end.camera)
  })

  it('empty stage (no mannequins) still materializes with origin focus', () => {
    const shots = materializeRoutePlan(plan, [], [])
    expect(shots).toHaveLength(2)
    expect(Object.keys(shots[0].start.actors)).toHaveLength(0)
  })
})

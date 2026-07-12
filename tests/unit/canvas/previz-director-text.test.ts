import { describe, it, expect } from 'vitest'
import { buildPrevizDirectorText, classifyCameraMove } from '@/app/[locale]/canvas/director/previz-director-text'
import type { StageShot } from '@/app/[locale]/canvas/director/previz-types'

const kf = (
  camPos: [number, number, number],
  target: [number, number, number] = [0, 1, 0],
  fov = 45,
  actors: StageShot['start']['actors'] = {},
) => ({ camera: { position: camPos, target, fov }, actors })

const shot = (over: Partial<StageShot>): StageShot => ({
  id: 's1',
  label: '01 开场·远景',
  durationSec: 7.5,
  start: kf([0, 1.6, 8]),
  end: kf([0, 1.6, 8]),
  easing: 'easeInOut',
  ...over,
})

describe('classifyCameraMove', () => {
  it('static camera → 固定机位', () => {
    expect(classifyCameraMove(shot({}))).toBe('固定机位')
  })

  it('moving toward the target → 推近', () => {
    expect(classifyCameraMove(shot({ start: kf([0, 1.6, 8]), end: kf([0, 1.6, 3]) }))).toBe('推近')
  })

  it('moving away from the target → 拉远', () => {
    expect(classifyCameraMove(shot({ start: kf([0, 1.6, 3]), end: kf([0, 1.6, 9]) }))).toBe('拉远')
  })

  it('vertical move dominates → 升降', () => {
    expect(classifyCameraMove(shot({ start: kf([0, 0.5, 5]), end: kf([0, 3.5, 5]) }))).toBe('升降')
  })

  it('lateral, distance kept → 横移', () => {
    expect(classifyCameraMove(shot({ start: kf([-3, 1.6, 5], [0, 1, 0]), end: kf([3, 1.6, 5], [0, 1, 0]) }))).toBe('横移')
  })

  it('static position but fov tightens → 变焦推近', () => {
    expect(classifyCameraMove(shot({ start: kf([0, 1.6, 8], [0, 1, 0], 60), end: kf([0, 1.6, 8], [0, 1, 0], 30) }))).toBe('变焦推近')
  })

  it('with waypoints → 弧线运镜', () => {
    expect(classifyCameraMove(shot({ start: kf([-3, 1.6, 5]), end: kf([3, 1.6, 5]), cameraWaypoints: [[0, 1.6, 2]] }))).toBe('弧线运镜')
  })
})

describe('buildPrevizDirectorText', () => {
  const labels = { m1: '角色A', m2: '角色B', p1: '车' }

  it('describes the whole scene: header + per-shot lines with time ranges', () => {
    const shots = [
      shot({ id: 'a', label: '01 开场·远景', durationSec: 7.5, note: '远景 / 建立空间' }),
      shot({
        id: 'b',
        label: '02 对峙·逼近',
        durationSec: 5,
        start: kf([0, 1.6, 8], [0, 1, 0], 45, { m1: { position: [0, 0, 0], rotation: [0, 0, 0] } }),
        end: kf([0, 1.6, 3], [0, 1, 0], 45, { m1: { position: [3, 0, 0], rotation: [0, 0, 0] } }),
      }),
    ]
    const text = buildPrevizDirectorText(shots, labels)
    expect(text).toContain('12.5 秒')
    expect(text).toContain('共 2 镜')
    expect(text).toContain('01 开场·远景')
    expect(text).toContain('0.0-7.5s')
    expect(text).toContain('远景 / 建立空间')
    expect(text).toContain('02 对峙·逼近')
    expect(text).toContain('7.5-12.5s')
    expect(text).toContain('推近')
    expect(text).toContain('角色A')  // moving actor called out by label
    expect(text).toContain('镜头运动与人物调度')  // instruction to follow the reference
  })

  it('single-shot scope describes only that shot', () => {
    const shots = [shot({ id: 'a', durationSec: 3 }), shot({ id: 'b', label: '02 特写', durationSec: 4 })]
    const text = buildPrevizDirectorText(shots, labels, { shotId: 'b' })
    expect(text).toContain('02 特写')
    expect(text).not.toContain('01 开场·远景')
  })

  it('unknown actor ids fall back to the id, stationary actors not listed', () => {
    const shots = [
      shot({
        id: 'a',
        start: kf([0, 1.6, 8], [0, 1, 0], 45, {
          ghost: { position: [0, 0, 0], rotation: [0, 0, 0] },
          still: { position: [1, 0, 1], rotation: [0, 0, 0] },
        }),
        end: kf([0, 1.6, 8], [0, 1, 0], 45, {
          ghost: { position: [5, 0, 0], rotation: [0, 0, 0] },
          still: { position: [1, 0, 1], rotation: [0, 0, 0] },
        }),
      }),
    ]
    const text = buildPrevizDirectorText(shots, {})
    expect(text).toContain('ghost')
    expect(text).not.toContain('still')
  })
})

import { describe, expect, it } from 'vitest'
import {
  prepareMultiShotPanels,
  resolveMultiShotPanelLimit,
} from '@/lib/novel-promotion/multi-shot-submission'
import { buildMultiShotDedupeKey } from '@/lib/novel-promotion/multi-shot-dedupe'

const panels = Array.from({ length: 10 }, (_, index) => ({ id: `panel-${index + 1}` }))

describe('Storyboard multi-shot submission guard', () => {
  it('Seedance 7-9 鏡 -> 保留完整有序 panel IDs，不截成 6 鏡', () => {
    expect(resolveMultiShotPanelLimit('seedance')).toBe(9)
    expect(prepareMultiShotPanels(panels.slice(0, 9), 'seedance')).toEqual({
      ok: true,
      panelIds: panels.slice(0, 9).map((panel) => panel.id),
      maxPanels: 9,
    })
  })

  it('Kling 超過 6 鏡 -> 明確拒絕且不回傳可送出的截斷 IDs', () => {
    expect(resolveMultiShotPanelLimit('kling')).toBe(6)
    expect(prepareMultiShotPanels(panels.slice(0, 7), 'kling')).toEqual({
      ok: false,
      count: 7,
      maxPanels: 6,
    })
  })

  it('未知 family -> fail closed 使用 6 鏡上限', () => {
    expect(resolveMultiShotPanelLimit(null)).toBe(6)
    expect(prepareMultiShotPanels(panels.slice(0, 7), null).ok).toBe(false)
  })
})

describe('Storyboard multi-shot dedupe identity', () => {
  const base = {
    storyboardId: 'storyboard-1',
    payload: {
      panelIds: ['panel-1', 'panel-2'],
      videoModel: 'fal::bytedance/seedance-2.0/reference-to-video',
      aspectRatio: '16:9',
      resolution: '720p',
      sound: true,
    },
    skillId: 'skill-1',
    videoModelSource: 'user-explicit' as const,
  }

  it('相同 resolved payload -> dedupe key 穩定', () => {
    expect(buildMultiShotDedupeKey(base)).toBe(buildMultiShotDedupeKey(base))
  })

  it.each([
    ['panel order', { panelIds: ['panel-2', 'panel-1'] }],
    ['video model', { videoModel: 'atlascloud::seedance-2.0-r2v' }],
    ['aspect ratio', { aspectRatio: '9:16' }],
    ['resolution', { resolution: '1080p' }],
    ['sound', { sound: false }],
  ])('%s 改變 -> 不可 dedupe 到舊任務', (_label, patch) => {
    const changed = buildMultiShotDedupeKey({
      ...base,
      payload: { ...base.payload, ...patch },
    })
    expect(changed).not.toBe(buildMultiShotDedupeKey(base))
  })

  it('resolved skill 改變 -> 不可 dedupe 到舊任務', () => {
    expect(buildMultiShotDedupeKey({ ...base, skillId: 'skill-2' }))
      .not.toBe(buildMultiShotDedupeKey(base))
  })
})

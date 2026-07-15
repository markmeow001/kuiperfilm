import { describe, expect, it } from 'vitest'
import {
  focalLengthToVerticalFov,
  materializeDirectorBlocking,
  parseDirectorBlockingDraft,
} from '@/lib/canvas/director-blocking-schema'
import { DEFAULT_STAGE } from '@/app/[locale]/canvas/director/stage-types'

const VALID = {
  title: '双人对峙',
  summary: '桌子形成视觉阻隔。',
  subjects: [
    { label: '角色A', bodyType: 'male', position: [-1, 0, 0], facingDeg: 90 },
    { label: '角色B', bodyType: 'female', position: [1, 0, 0], facingDeg: -90 },
  ],
  props: [{ label: '桌子', kind: 'box', position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1.2, 0.8, 0.6] }],
  camera: { label: '35mm 双人中景', position: [0, 1.6, 6], target: [0, 1, 0], focalLengthMm: 35, framing: '框住两人', rollDeg: 0 },
}

describe('director blocking schema', () => {
  it('parses fenced JSON and preserves explicit blocking data', () => {
    const draft = parseDirectorBlockingDraft(`结果：\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``)
    expect(draft.subjects).toHaveLength(2)
    expect(draft.props[0]).toMatchObject({ label: '桌子', kind: 'box' })
    expect(draft.camera).toMatchObject({ focalLengthMm: 35, framing: '框住两人' })
  })

  it('rejects invalid geometry and camera ranges explicitly', () => {
    expect(() => parseDirectorBlockingDraft('not json')).toThrow('no JSON object')
    expect(() => parseDirectorBlockingDraft(JSON.stringify({ ...VALID, subjects: [] }))).toThrow('subjects must contain')
    expect(() => parseDirectorBlockingDraft(JSON.stringify({ ...VALID, camera: { ...VALID.camera, focalLengthMm: 400 } }))).toThrow('focalLengthMm')
  })

  it('materializes editable stage entities, clears stale shots, and preserves stage presentation', () => {
    const previous = { ...DEFAULT_STAGE, aspect: '16:9' as const, background: { mode: 'none' as const, skyColor: '#123456' }, shots: [{ id: 'stale' }] as never }
    const draft = parseDirectorBlockingDraft(JSON.stringify(VALID))
    const next = materializeDirectorBlocking(draft, previous, (kind, index) => `${kind}-${index}`)
    expect(next.mannequins.map((item) => item.id)).toEqual(['subject-0', 'subject-1'])
    expect(next.mannequins[0].rotation[1]).toBeCloseTo(Math.PI / 2)
    expect(next.props[0].scale).toEqual([1.2, 0.8, 0.6])
    expect(next.cameras[0].fov).toBeCloseTo(focalLengthToVerticalFov(35))
    expect(next.shots).toEqual([])
    expect(next.aspect).toBe('16:9')
    expect(next.background?.skyColor).toBe('#123456')
  })
})

import { describe, it, expect } from 'vitest'
import { CAMERA_MOVES, cameraMovePhrase } from '@/app/[locale]/canvas/lib/camera-moves'

describe('camera moves (运镜)', () => {
  it('first is 无运镜 with empty phrase', () => {
    expect(CAMERA_MOVES[0]).toMatchObject({ key: 'none', phrase: '' })
  })
  it('every preset has unique key + label', () => {
    expect(new Set(CAMERA_MOVES.map((m) => m.key)).size).toBe(CAMERA_MOVES.length)
    expect(new Set(CAMERA_MOVES.map((m) => m.label)).size).toBe(CAMERA_MOVES.length)
  })
  it('cameraMovePhrase resolves a real phrase + empty for none/unknown', () => {
    expect(cameraMovePhrase('push')).toContain('推')
    expect(cameraMovePhrase('none')).toBe('')
    expect(cameraMovePhrase(undefined)).toBe('')
    expect(cameraMovePhrase('bogus')).toBe('')
  })
})

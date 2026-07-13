import { describe, expect, it } from 'vitest'
import { buildComposeAudioFilter, buildComposeFilter } from '@/lib/canvas/ffmpeg-compose-executor'
import { CANVAS_COMPOSE_LIMITS, canvasComposeRequestSchema } from '@/lib/canvas/compose-contract'

describe('canvas compose contract', () => {
  it('hard limits -> 10 clips, 3 minutes, 720p, two ffmpeg threads', () => {
    expect(CANVAS_COMPOSE_LIMITS).toMatchObject({ maxClips: 10, maxDurationSec: 180, width: 1280, height: 720, threads: 2, maxInputBytes: 2 * 1024 * 1024 * 1024, maxOutputBytes: 512 * 1024 * 1024 })
    expect(canvasComposeRequestSchema.safeParse({ canvasId: crypto.randomUUID(), taskIds: Array.from({ length: 11 }, () => crypto.randomUUID()), transition: 'cut' }).success).toBe(false)
  })

  it('cut -> normalizes every clip and concatenates in input order', () => {
    const filter = buildComposeFilter([2, 3, 4], 'cut', 0.5)
    expect(filter).toContain('[0:v]scale=1280:720')
    expect(filter).toContain('[v0][v1][v2]concat=n=3:v=1:a=0[outv]')
  })

  it('crossfade -> offsets use accumulated duration minus prior fades', () => {
    const filter = buildComposeFilter([2, 3, 4], 'crossfade', 0.5)
    expect(filter).toContain('[v0][v1]xfade=transition=fade:duration=0.5:offset=1.500[x1]')
    expect(filter).toContain('[x1][v2]xfade=transition=fade:duration=0.5:offset=4.000[outv]')
  })
})

describe('canvas compose audio filter', () => {
  it('original audio + voice + looping music -> explicit three-track amix', () => {
    const filter = buildComposeAudioFilter({ durations: [4, 6], hasAudio: [true, false], transition: 'cut', crossfadeSec: 0.5, preserveOriginalAudio: true, voiceInputIndex: 2, musicInputIndex: 3, voiceVolume: 1.2, musicVolume: 0.3, outputDuration: 10 })
    expect(filter).toContain('[0:a]aresample=48000')
    expect(filter).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=6.000')
    expect(filter).toContain('[2:a]aresample=48000')
    expect(filter).toContain('volume=1.2')
    expect(filter).toContain('volume=0.3')
    expect(filter).toContain('[basea][voice][music]amix=inputs=3:duration=first')
  })

  it('preserve original off -> replaces every clip audio with exact-duration silence', () => {
    const filter = buildComposeAudioFilter({ durations: [3], hasAudio: [true], transition: 'cut', crossfadeSec: 0.5, preserveOriginalAudio: false, voiceVolume: 1, musicVolume: 0.25, outputDuration: 3 })
    expect(filter).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=3.000')
    expect(filter).not.toContain('[0:a]aresample')
  })
})

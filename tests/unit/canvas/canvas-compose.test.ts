import { describe, expect, it } from 'vitest'
import { buildComposeFilter } from '@/lib/canvas/ffmpeg-compose-executor'
import { CANVAS_COMPOSE_LIMITS, canvasComposeRequestSchema } from '@/lib/canvas/compose-contract'

describe('canvas compose contract', () => {
  it('hard limits -> 10 clips, 3 minutes, 720p, two ffmpeg threads', () => {
    expect(CANVAS_COMPOSE_LIMITS).toMatchObject({ maxClips: 10, maxDurationSec: 180, width: 1280, height: 720, threads: 2, maxInputBytes: 2 * 1024 * 1024 * 1024, maxOutputBytes: 512 * 1024 * 1024 })
    expect(canvasComposeRequestSchema.safeParse({ taskIds: Array.from({ length: 11 }, () => crypto.randomUUID()), transition: 'cut' }).success).toBe(false)
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

import { describe, expect, it, vi } from 'vitest'

// queues.ts constructs BullMQ Queue instances at module load — stub bullmq +
// redis so importing it here doesn't open a real connection.
vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn()
    close = vi.fn()
  },
}))
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))

import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { TASK_TYPE } from '@/lib/task/types'

// Regression guard for the Phase 9.1 CRITICAL: the playground task types were
// registered in the image/video worker switches but NOT in queues.ts's
// IMAGE_TYPES/VIDEO_TYPES, so getQueueTypeByTaskType defaulted them to 'text'
// — landing every playground job on the text worker, which has no handler and
// fails it instantly. This pins them to the right queue.
describe('Phase 9.1 — playground task queue routing', () => {
  it('routes PLAYGROUND_IMAGE to the image queue (not text)', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.PLAYGROUND_IMAGE)).toBe('image')
  })

  it('routes PLAYGROUND_VIDEO to the video queue (not text)', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.PLAYGROUND_VIDEO)).toBe('video')
  })

  it('routes PLAYGROUND_VIDEO_ANALYZE to the text queue', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.PLAYGROUND_VIDEO_ANALYZE)).toBe('text')
  })

  // Same invariant for the canvas task types — CANVAS_STORYBOARD is an LLM
  // text task (default → text), CANVAS_TTS must land on the VOICE queue.
  it('routes CANVAS_STORYBOARD to the text queue', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.CANVAS_STORYBOARD)).toBe('text')
  })

  it('routes CANVAS_TEXT to the text queue', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.CANVAS_TEXT)).toBe('text')
  })

  it('routes CANVAS_TTS to the voice queue (not text)', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.CANVAS_TTS)).toBe('voice')
  })

  it('routes CANVAS_COMPOSE_VIDEO to the video queue (never text)', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.CANVAS_COMPOSE_VIDEO)).toBe('video')
  })

  it('routes CANVAS_STORYBOARD_EXPORT to the video queue (never text)', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.CANVAS_STORYBOARD_EXPORT)).toBe('video')
  })
})

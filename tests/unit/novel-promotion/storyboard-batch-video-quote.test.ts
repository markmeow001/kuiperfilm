import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  issueStoryboardBatchVideoQuote,
  verifyStoryboardBatchVideoQuote,
} from '@/lib/novel-promotion/storyboard-batch-video-quote'

const claims = {
  userId: 'user-1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  batchRunId: 'batch-1',
  settings: {
    videoModel: 'fal::video-model',
    generationOptions: { duration: 5, generateAudio: false },
  },
  pricing: {
    version: 'storyboard-video-v1',
    currency: 'CNY' as const,
    estimatedCostPerTask: 2.5,
    estimatedTotalCost: 2.5,
  },
  targets: [{
    panelId: 'panel-1',
    disposition: 'new' as const,
    taskId: null,
    status: null,
    source: {
      updatedAt: '2026-08-10T10:00:00.000Z',
      imageUrl: 'https://media.test/panel-1.jpg',
      imageMediaId: null,
      description: 'wide shot',
      videoPrompt: 'slow pan',
      firstLastFramePrompt: null,
      srtSegment: null,
      videoUrl: null,
      videoMediaId: null,
    },
  }],
}

describe('storyboard batch video signed quote', () => {
  beforeEach(() => {
    process.env.API_ENCRYPTION_KEY = 'test-only-storyboard-batch-video-signing-secret'
  })

  afterEach(() => {
    delete process.env.API_ENCRYPTION_KEY
  })

  it('authenticates all bound claims and rejects a forged token', () => {
    const token = issueStoryboardBatchVideoQuote(claims, {
      now: new Date('2026-08-10T10:00:00.000Z'),
    })

    expect(verifyStoryboardBatchVideoQuote(token, {
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    }, {
      now: new Date('2026-08-10T10:01:00.000Z'),
    })).toMatchObject(claims)

    const forged = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
    expect(() => verifyStoryboardBatchVideoQuote(forged, {
      userId: 'user-1', projectId: 'project-1', episodeId: 'episode-1',
    })).toThrow('BATCH_VIDEO_QUOTE_INVALID')
  })

  it('rejects cross-user/project/episode use and expiry', () => {
    const token = issueStoryboardBatchVideoQuote(claims, {
      now: new Date('2026-08-10T10:00:00.000Z'),
      ttlMs: 60_000,
    })

    expect(() => verifyStoryboardBatchVideoQuote(token, {
      userId: 'user-2', projectId: 'project-1', episodeId: 'episode-1',
    })).toThrow('BATCH_VIDEO_QUOTE_CONTEXT_MISMATCH')
    expect(() => verifyStoryboardBatchVideoQuote(token, {
      userId: 'user-1', projectId: 'project-2', episodeId: 'episode-1',
    })).toThrow('BATCH_VIDEO_QUOTE_CONTEXT_MISMATCH')
    expect(() => verifyStoryboardBatchVideoQuote(token, {
      userId: 'user-1', projectId: 'project-1', episodeId: 'episode-2',
    })).toThrow('BATCH_VIDEO_QUOTE_CONTEXT_MISMATCH')
    expect(() => verifyStoryboardBatchVideoQuote(token, {
      userId: 'user-1', projectId: 'project-1', episodeId: 'episode-1',
    }, {
      now: new Date('2026-08-10T10:01:01.000Z'),
    })).toThrow('BATCH_VIDEO_QUOTE_EXPIRED')
  })
})

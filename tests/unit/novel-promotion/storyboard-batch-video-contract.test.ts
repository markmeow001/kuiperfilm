import { describe, expect, it } from 'vitest'
import {
  parseStoryboardBatchVideoQuote,
  parseStoryboardBatchVideoSubmission,
} from '@/lib/novel-promotion/storyboard-batch-video-contract'

const quote = {
  kind: 'quote',
  batchRunId: 'batch-1',
  quotedAt: '2026-08-10T10:00:00.000Z',
  quoteFingerprint: 'v1.cXVvdGU.c2lnbmF0dXJl',
  episodeId: 'episode-1',
  videoModel: 'fal::video-model',
  currency: 'CNY',
  estimatedCostPerTask: 2.5,
  estimatedTotalCost: 2.5,
  targets: [
    { panelId: 'panel-new', disposition: 'new', taskId: null, status: null },
    { panelId: 'panel-active', disposition: 'already_active', taskId: 'task-active', status: 'processing' },
  ],
  total: 2,
  newTasks: 1,
  alreadyActive: 1,
  skipped: 2,
  skippedMissingImage: 1,
  skippedHasVideo: 1,
}

describe('storyboard batch video runtime contract', () => {
  it('accepts a complete quote and rejects malformed count/target payloads', () => {
    expect(parseStoryboardBatchVideoQuote(quote)).toMatchObject({
      batchRunId: 'batch-1',
      newTasks: 1,
      alreadyActive: 1,
    })
    expect(() => parseStoryboardBatchVideoQuote({ ...quote, newTasks: '1' })).toThrow(/quote/i)
    expect(() => parseStoryboardBatchVideoQuote({ ...quote, targets: [{ panelId: 'panel-new' }] })).toThrow(/quote/i)
  })

  it('rejects malformed 2xx submission items instead of casting them to success', () => {
    const submission = {
      kind: 'submission',
      batchRunId: 'batch-1',
      quoteFingerprint: 'v1.cXVvdGU.c2lnbmF0dXJl',
      total: 2,
      accepted: 1,
      deduped: 0,
      rejected: 1,
      outcome: 'partial',
      items: [
        { panelId: 'panel-new', outcome: 'accepted', taskId: 'task-1', status: 'queued', error: null },
        { panelId: 'panel-bad', outcome: 'rejected', taskId: null, status: null, error: { code: 'QUEUE_DOWN', message: 'down' } },
      ],
    }
    expect(parseStoryboardBatchVideoSubmission(submission)).toMatchObject({ outcome: 'partial' })
    expect(() => parseStoryboardBatchVideoSubmission({
      ...submission,
      items: [{ panelId: 'panel-new', outcome: 'accepted', taskId: null, status: 'queued', error: null }],
    })).toThrow(/submission/i)
  })
})

import { describe, expect, it } from 'vitest'
import type { JobView } from '@/lib/task/job-view'
import {
  formatDuration,
  jobCategory,
  jobCostPresentation,
  shortIdentifier,
  toJobCardStatus,
} from '@/app/[locale]/v2/jobs/job-center-format'

function buildJob(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 'task-1',
    type: 'video_panel',
    title: 'Video Panel',
    typeLabel: 'Video Panel',
    targetType: 'NovelPromotionPanel',
    targetId: 'panel-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status: 'running',
    progress: 42,
    model: 'seedance-2.0',
    cost: { estimated: 1.28, actual: null, currency: 'CNY' },
    billingStatus: 'reserved',
    refund: { status: 'not_refunded', amount: null },
    error: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:05.000Z',
    queuedAt: '2026-08-08T00:00:01.000Z',
    startedAt: '2026-08-08T00:00:02.000Z',
    finishedAt: null,
    durationMs: null,
    attempt: 1,
    maxAttempts: 3,
    stageLabel: 'Processing',
    canCancel: true,
    ...overrides,
  }
}

describe('Job Center presentation helpers', () => {
  it('task type -> stable production category without inventing output data', () => {
    expect(jobCategory('video_multi_shot')).toBe('video')
    expect(jobCategory('voice_line')).toBe('voice')
    expect(jobCategory('analyze_novel')).toBe('analysis')
    expect(jobCategory('image_character')).toBe('image')
    expect(jobCategory('screenplay_convert')).toBe('text')
    expect(jobCategory('unknown_worker_task')).toBe('other')
  })

  it('canonical task status -> JobCard status preserves cancellation and completion', () => {
    expect(toJobCardStatus('queued')).toBe('queued')
    expect(toJobCardStatus('running')).toBe('running')
    expect(toJobCardStatus('completed')).toBe('succeeded')
    expect(toJobCardStatus('cancelled')).toBe('cancelled')
    expect(toJobCardStatus('failed')).toBe('failed')
  })

  it('settled billing -> displays actual CNY; reserved billing -> displays estimate', () => {
    const charged = jobCostPresentation(buildJob({
      billingStatus: 'charged',
      cost: { estimated: 1.28, actual: 1.1, currency: 'CNY' },
    }), 'en')
    const reserved = jobCostPresentation(buildJob(), 'en')

    expect(charged).toEqual({ kind: 'actual', amount: 'CNY 1.10' })
    expect(reserved).toEqual({ kind: 'estimated', amount: 'CNY 1.28' })
  })

  it('unknown and free billing -> stays explicit instead of substituting zero', () => {
    expect(jobCostPresentation(buildJob({
      billingStatus: 'unknown',
      cost: { estimated: null, actual: null, currency: 'CNY' },
    }), 'zh')).toEqual({ kind: 'unknown', amount: null })
    expect(jobCostPresentation(buildJob({
      billingStatus: 'not_billable',
      cost: { estimated: null, actual: 0, currency: 'CNY' },
    }), 'zh')).toEqual({ kind: 'free', amount: null })
  })

  it('duration and identifiers -> format only known values', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(124_000)).toBe('2m 4s')
    expect(formatDuration(null)).toBeNull()
    expect(shortIdentifier('12345678901234567890', 8)).toBe('12345678…')
  })
})

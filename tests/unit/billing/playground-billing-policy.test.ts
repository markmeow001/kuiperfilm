import { describe, expect, it } from 'vitest'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_TYPE } from '@/lib/task/types'

describe('Phase 9.1 — playground task billing policy', () => {
  it('marks both playground task types billable', () => {
    expect(isBillableTaskType(TASK_TYPE.PLAYGROUND_IMAGE)).toBe(true)
    expect(isBillableTaskType(TASK_TYPE.PLAYGROUND_VIDEO)).toBe(true)
  })

  it('builds image billing info from payload.modelId + resolution', () => {
    const info = buildDefaultTaskBillingInfo(TASK_TYPE.PLAYGROUND_IMAGE, {
      modelId: 'nano-banana',
      resolution: '1024x1024',
    })
    if (!info || !info.billable) throw new Error('expected billable image billing info')
    expect(info.apiType).toBe('image')
    expect(info.model).toBe('nano-banana')
    expect(info.taskType).toBe(TASK_TYPE.PLAYGROUND_IMAGE)
  })

  it('builds video billing info from payload.modelId + resolution + duration', () => {
    const info = buildDefaultTaskBillingInfo(TASK_TYPE.PLAYGROUND_VIDEO, {
      modelId: 'seedance-1.0',
      resolution: '720p',
      duration: 5,
    })
    if (!info || !info.billable) throw new Error('expected billable video billing info')
    expect(info.apiType).toBe('video')
    expect(info.model).toBe('seedance-1.0')
    expect(info.taskType).toBe(TASK_TYPE.PLAYGROUND_VIDEO)
  })

  it('returns null (no model) when payload lacks a model id', () => {
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.PLAYGROUND_IMAGE, { resolution: '512x512' })).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.PLAYGROUND_VIDEO, { duration: 5 })).toBeNull()
  })
})

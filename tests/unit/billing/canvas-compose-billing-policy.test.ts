import { describe, expect, it } from 'vitest'
import { isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_TYPE } from '@/lib/task/types'

describe('canvas composition billing policy', () => {
  it('self-hosted CPU composition -> free task with no billing freeze', () => {
    expect(isBillableTaskType(TASK_TYPE.CANVAS_COMPOSE_VIDEO)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'
import type { TaskBillingInfo } from '@/lib/task/types'

function expectBillableInfo(info: TaskBillingInfo | null): Extract<TaskBillingInfo, { billable: true }> {
  expect(info).toBeTruthy()
  expect(info?.billable).toBe(true)
  if (!info || !info.billable) {
    throw new Error('Expected billable task billing info')
  }
  return info
}

describe('billing/task-policy', () => {
  const billingPayload = {
    analysisModel: 'anthropic/claude-sonnet-4',
    imageModel: 'seedream',
    videoModel: 'doubao-seedance-1-5-pro-251215',
    audioModel: 'atlascloud::bytedance/seed-audio-1.0',
    providerText: 'Atlas voice',
  } as const

  it('builds TaskBillingInfo for every billable task type', () => {
    for (const taskType of Object.values(TASK_TYPE)) {
      if (!isBillableTaskType(taskType)) continue
      const info = expectBillableInfo(buildDefaultTaskBillingInfo(taskType, billingPayload))
      expect(info.taskType).toBe(taskType)
      expect(info.maxFrozenCost).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns null for a non-billable task type', () => {
    const fake = 'not_billable' as unknown as (typeof TASK_TYPE)[keyof typeof TASK_TYPE]
    expect(isBillableTaskType(fake)).toBe(false)
    expect(buildDefaultTaskBillingInfo(fake, {})).toBeNull()
  })

  it('builds text billing info from explicit model payload', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.ANALYZE_NOVEL, {
      analysisModel: 'anthropic/claude-sonnet-4',
    }))
    expect(info.apiType).toBe('text')
    expect(info.model).toBe('anthropic/claude-sonnet-4')
    expect(info.quantity).toBe(4200)
  })

  it('returns null for missing required models in text/image/video tasks', () => {
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.ANALYZE_NOVEL, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, {})).toBeNull()
  })

  it('honors candidateCount/count for image tasks', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, {
      candidateCount: 4,
      imageModel: 'seedream4',
    }))
    expect(info.apiType).toBe('image')
    expect(info.quantity).toBe(4)
    expect(info.model).toBe('seedream4')
  })

  it('builds video billing info from firstLastFrame.flModel', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, {
      firstLastFrame: {
        flModel: 'doubao-seedance-1-0-pro-250528',
      },
      duration: 8,
    }))
    expect(info.apiType).toBe('video')
    expect(info.model).toBe('doubao-seedance-1-0-pro-250528')
    expect(info.quantity).toBe(1)
  })

  it('uses explicit lip sync model from payload', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.LIP_SYNC, {
      lipSyncModel: 'vidu::vidu-lipsync',
    }))
    expect(info.apiType).toBe('lip-sync')
    expect(info.model).toBe('vidu::vidu-lipsync')
    expect(info.quantity).toBe(1)
  })

  it.each([
    ['ASCII', TASK_TYPE.CANVAS_TTS, 'Use @audio1: Atlas', 18],
    ['CJK', TASK_TYPE.CANVAS_TTS, '@audio1 配音測試', 12],
    ['emoji', TASK_TYPE.VOICE_LINE, '@audio1 A😀中', 11],
  ])('%s pinned provider text -> freezes the exact Unicode code-point count', (_label, taskType, providerText, expectedCharacters) => {
    const model = 'atlascloud::bytedance/seed-audio-1.0'
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(taskType, {
      audioModel: model,
      providerText,
    }))

    expect(info.apiType).toBe('voice')
    expect(info.model).toBe(model)
    expect(info.quantity).toBe(expectedCharacters)
    expect(info.unit).toBe('character')
    expect(info.maxFrozenCost).toBeCloseTo(0.015 * 7.2 * (expectedCharacters / 1_000), 12)
    expect(info.metadata).toEqual({ submittedCharacters: expectedCharacters })
  })

  it('missing pinned voice model or submitted text -> does not fabricate a billing quote', () => {
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, {
      providerText: '@audio1 hello',
    })).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, {
      audioModel: 'atlascloud::bytedance/seed-audio-1.0',
    })).toBeNull()
  })

  it('pinned provider text whitespace -> counts exact submitted code points without trimming', () => {
    const providerText = '@audio1 hello '
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.CANVAS_TTS, {
      audioModel: 'atlascloud::bytedance/seed-audio-1.0',
      providerText,
    }))

    expect(info.quantity).toBe([...providerText].length)
    expect(info.metadata).toEqual({ submittedCharacters: 14 })
  })
})

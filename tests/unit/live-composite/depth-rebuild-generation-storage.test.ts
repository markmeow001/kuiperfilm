// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  depthRebuildGenerationStorageKey,
  readPendingDepthRebuildGeneration,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-generation-storage'

function savedGuidePlan() {
  return {
    version: 2 as const,
    strategy: 'full-depth-critical-rgb' as const,
    sourceDurationSeconds: 11.2,
    outputDurationSeconds: 12,
    criticalCenterSeconds: 9.1,
    referenceVideoWindows: [
      { role: 'depth' as const, startSeconds: 0, durationSeconds: 11.2 },
      { role: 'rgb' as const, startSeconds: 8.2, durationSeconds: 2.2 },
    ],
  }
}

function savedGeneration(guidePlan: Record<string, unknown>) {
  return {
    workflowId: 'workflow-v2-storage',
    segments: [{ requestKey: 'request-v2-storage' }],
    submission: {
      contractVersion: 2,
      segmentPrompts: ['保存當時的完整 v2 prompt'],
      segmentWindows: [{ startSeconds: 0, durationSeconds: 11.2 }],
      modelKey: 'atlascloud::seedance-2.0-r2v',
      resolution: '720p',
      aspectRatio: '16:9',
      sourceAudioMode: 'reference-only',
      guidePlan,
    },
  }
}

describe('Depth Rebuild v2 generation storage contract', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('已保存且結構合法、但不等於目前 planner 結果的 v2 plan -> 原樣保留', () => {
    const key = depthRebuildGenerationStorageKey('saved-v2-plan')
    const guidePlan = savedGuidePlan()
    sessionStorage.setItem(key, JSON.stringify(savedGeneration(guidePlan)))

    const restored = readPendingDepthRebuildGeneration(key)

    expect(restored?.submission.guidePlan).toEqual(guidePlan)
    expect(restored?.submission.guidePlan?.referenceVideoWindows[1]).toEqual({
      role: 'rgb',
      startSeconds: 8.2,
      durationSeconds: 2.2,
    })
    expect(sessionStorage.getItem(key)).not.toBeNull()
  })

  it.each([
    {
      label: '完整雙引導恰好 14.5 秒 nominal 上限',
      guidePlan: {
        version: 2,
        strategy: 'full-depth-full-rgb',
        sourceDurationSeconds: 7.25,
        outputDurationSeconds: 8,
        criticalCenterSeconds: 3.6,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 7.25 },
          { role: 'rgb', startSeconds: 0, durationSeconds: 7.25 },
        ],
      },
      segmentDuration: 7.25,
    },
    {
      label: 'Depth-only 恰好 15 秒 hard 上限',
      guidePlan: {
        version: 2,
        strategy: 'full-depth-only',
        sourceDurationSeconds: 15,
        outputDurationSeconds: 15,
        criticalCenterSeconds: 7.5,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 15 },
        ],
      },
      segmentDuration: 15,
    },
  ])('$label -> 可恢復', ({ guidePlan, segmentDuration }) => {
    const key = depthRebuildGenerationStorageKey(`boundary-${segmentDuration}`)
    const generation = savedGeneration(guidePlan)
    generation.submission.segmentWindows = [{ startSeconds: 0, durationSeconds: segmentDuration }]
    sessionStorage.setItem(key, JSON.stringify(generation))

    expect(readPendingDepthRebuildGeneration(key)?.submission.guidePlan).toEqual(guidePlan)
  })

  it.each([
    {
      label: 'plan 多出未版本化欄位',
      guidePlan: { ...savedGuidePlan(), plannerRevision: 3 },
    },
    {
      label: '輸出秒數不是整數',
      guidePlan: { ...savedGuidePlan(), outputDurationSeconds: 11.2 },
    },
    {
      label: '輸出整數不是原片秒數向上取整',
      guidePlan: { ...savedGuidePlan(), outputDurationSeconds: 13 },
    },
    {
      label: '原片短於 4 秒範圍',
      guidePlan: {
        version: 2,
        strategy: 'full-depth-only',
        sourceDurationSeconds: 3.9,
        outputDurationSeconds: 4,
        criticalCenterSeconds: 2,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 3.9 },
        ],
      },
    },
    {
      label: 'RGB reference 短於 2 秒範圍',
      guidePlan: {
        ...savedGuidePlan(),
        referenceVideoWindows: [
          savedGuidePlan().referenceVideoWindows[0],
          { role: 'rgb', startSeconds: 8.2, durationSeconds: 1.9 },
        ],
      },
    },
    {
      label: 'reference role 順序顛倒',
      guidePlan: {
        ...savedGuidePlan(),
        referenceVideoWindows: [...savedGuidePlan().referenceVideoWindows].reverse(),
      },
    },
    {
      label: 'strategy 與 reference 數量不符',
      guidePlan: { ...savedGuidePlan(), strategy: 'full-depth-only' },
    },
    {
      label: 'critical RGB 實際是完整來源',
      guidePlan: {
        version: 2,
        strategy: 'full-depth-critical-rgb',
        sourceDurationSeconds: 7,
        outputDurationSeconds: 7,
        criticalCenterSeconds: 3.5,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 7 },
          { role: 'rgb', startSeconds: 0, durationSeconds: 7 },
        ],
      },
    },
    {
      label: '雙參考超過 14.5 秒 nominal 上限',
      guidePlan: {
        version: 2,
        strategy: 'full-depth-full-rgb',
        sourceDurationSeconds: 7.3,
        outputDurationSeconds: 8,
        criticalCenterSeconds: 3.65,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 7.3 },
          { role: 'rgb', startSeconds: 0, durationSeconds: 7.3 },
        ],
      },
    },
    {
      label: '雙參考超過 15 秒 hard 上限',
      guidePlan: {
        version: 2,
        strategy: 'full-depth-full-rgb',
        sourceDurationSeconds: 8,
        outputDurationSeconds: 8,
        criticalCenterSeconds: 4,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 8 },
          { role: 'rgb', startSeconds: 0, durationSeconds: 8 },
        ],
      },
    },
    {
      label: 'critical center 不在 RGB window 內',
      guidePlan: { ...savedGuidePlan(), criticalCenterSeconds: 2 },
    },
  ])('$label -> 刪除不可信 session 紀錄', ({ label, guidePlan }) => {
    const key = depthRebuildGenerationStorageKey(`invalid-${label}`)
    sessionStorage.setItem(key, JSON.stringify(savedGeneration(guidePlan)))

    expect(readPendingDepthRebuildGeneration(key)).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
})

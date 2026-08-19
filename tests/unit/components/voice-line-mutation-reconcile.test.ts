import { describe, expect, it } from 'vitest'
import {
  isVoiceLineMutationOutcomeUnknown,
  shouldReconcileVoiceLineDelete,
  wasVoiceLineDeleteApplied,
  wasVoiceLineUpdateApplied,
} from '@/app/[locale]/v2/workspace/[projectId]/voice/voice-line-mutation-reconcile'
import type { VoiceLine } from '@/app/[locale]/v2/workspace/[projectId]/voice/voice-workspace-types'

const line: VoiceLine = {
  id: 'line-1',
  lineIndex: 1,
  content: 'Committed text',
  speaker: 'Ann',
  emotionPrompt: null,
  emotionStrength: null,
  audioUrl: null,
  lineTaskRunning: false,
  matchedPanelId: 'panel-2',
}

describe('V2 voice line mutation reconciliation', () => {
  it('[delete response is lost after commit] -> [successful refetch absence reconciles success]', () => {
    expect(isVoiceLineMutationOutcomeUnknown(new TypeError('network failed'))).toBe(true)
    expect(wasVoiceLineDeleteApplied([], 'line-1')).toBe(true)
    expect(wasVoiceLineDeleteApplied([line], 'line-1')).toBe(false)
  })

  it('[update response is lost after commit] -> [only the exact persisted draft reconciles success]', () => {
    expect(wasVoiceLineUpdateApplied([line], 'line-1', {
      content: 'Committed text',
      speaker: 'Ann',
      matchedPanelId: 'panel-2',
    })).toBe(true)
    expect(wasVoiceLineUpdateApplied([line], 'line-1', {
      content: 'Different text',
      speaker: 'Ann',
      matchedPanelId: 'panel-2',
    })).toBe(false)
  })

  it('[explicit 4xx] -> [does not treat the outcome as unknown]', () => {
    expect(isVoiceLineMutationOutcomeUnknown(Object.assign(new Error('conflict'), { status: 409 }))).toBe(false)
    expect(isVoiceLineMutationOutcomeUnknown(Object.assign(new Error('server'), { status: 500 }))).toBe(true)
  })

  it('[delete retry receives 404 after an applied outcome] -> [allows one scoped refetch reconciliation]', () => {
    expect(shouldReconcileVoiceLineDelete(Object.assign(new Error('not found'), { status: 404 }))).toBe(true)
    expect(shouldReconcileVoiceLineDelete(Object.assign(new Error('conflict'), { status: 409 }))).toBe(false)
  })
})

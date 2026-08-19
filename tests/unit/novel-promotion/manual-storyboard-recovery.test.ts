import { describe, expect, it } from 'vitest'
import {
  isManualStoryboardOutcomeUnknown,
  manualStoryboardRecoveryMatchesEpisode,
} from '@/lib/novel-promotion/manual-storyboard-recovery'

describe('manual storyboard recovery policy', () => {
  it('[outcome unknown pinned to episode A] -> switching to episode B cannot replay', () => {
    expect(manualStoryboardRecoveryMatchesEpisode('episode-A', 'episode-A')).toBe(true)
    expect(manualStoryboardRecoveryMatchesEpisode('episode-A', 'episode-B')).toBe(false)
  })

  it('[network / 5xx] -> preserve key; [explicit 4xx] -> allow a new key', () => {
    expect(isManualStoryboardOutcomeUnknown(new TypeError('network failed'))).toBe(true)
    expect(isManualStoryboardOutcomeUnknown(Object.assign(new Error('server'), { status: 503 }))).toBe(true)
    expect(isManualStoryboardOutcomeUnknown(Object.assign(new Error('invalid'), { status: 409 }))).toBe(false)
  })
})

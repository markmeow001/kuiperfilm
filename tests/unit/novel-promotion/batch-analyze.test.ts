import { describe, expect, it } from 'vitest'
import {
  isFullyStoryboarded,
  selectEpisodesNeedingStoryboard,
} from '@/lib/novel-promotion/batch-analyze'

describe('isFullyStoryboarded', () => {
  it('complete only when every clip has a storyboard', () => {
    expect(isFullyStoryboarded({ id: 'e', episodeNumber: 1, clipCount: 3, storyboardCount: 3 })).toBe(true)
    expect(isFullyStoryboarded({ id: 'e', episodeNumber: 1, clipCount: 3, storyboardCount: 4 })).toBe(true)
  })
  it('NOT complete when storyboards are partial (worker crashed mid-build)', () => {
    expect(isFullyStoryboarded({ id: 'e', episodeNumber: 1, clipCount: 5, storyboardCount: 3 })).toBe(false)
  })
  it('NOT complete when never analyzed (no clips) even if 0 storyboards', () => {
    expect(isFullyStoryboarded({ id: 'e', episodeNumber: 1, clipCount: 0, storyboardCount: 0 })).toBe(false)
  })
})

describe('selectEpisodesNeedingStoryboard', () => {
  it('selects un-analyzed AND partially-built episodes; skips only complete ones', () => {
    const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard([
      { id: 'e1', episodeNumber: 1, clipCount: 0, storyboardCount: 0 },   // never analyzed
      { id: 'e2', episodeNumber: 2, clipCount: 4, storyboardCount: 4 },   // complete
      { id: 'e3', episodeNumber: 3, clipCount: 5, storyboardCount: 2 },   // partial (crash)
    ])
    expect(toAnalyze).toEqual(['e1', 'e3'])
    expect(skipped).toEqual(['e2'])
  })

  it('orders selection low-to-high so the queue fills episode 1 first', () => {
    const { toAnalyze } = selectEpisodesNeedingStoryboard([
      { id: 'e3', episodeNumber: 3, clipCount: 0, storyboardCount: 0 },
      { id: 'e1', episodeNumber: 1, clipCount: 0, storyboardCount: 0 },
      { id: 'e2', episodeNumber: 2, clipCount: 0, storyboardCount: 0 },
    ])
    expect(toAnalyze).toEqual(['e1', 'e2', 'e3'])
  })

  it('skips everything when all episodes are fully storyboarded', () => {
    const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard([
      { id: 'e1', episodeNumber: 1, clipCount: 2, storyboardCount: 2 },
      { id: 'e2', episodeNumber: 2, clipCount: 3, storyboardCount: 3 },
    ])
    expect(toAnalyze).toEqual([])
    expect(skipped).toEqual(['e1', 'e2'])
  })

  it('handles an empty project (no episodes)', () => {
    expect(selectEpisodesNeedingStoryboard([])).toEqual({ toAnalyze: [], skipped: [] })
  })

  it('selects all when a fresh 70-episode upload has zero clips', () => {
    const episodes = Array.from({ length: 70 }, (_, i) => ({
      id: `e${i + 1}`,
      episodeNumber: i + 1,
      clipCount: 0,
      storyboardCount: 0,
    }))
    const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard(episodes)
    expect(toAnalyze).toHaveLength(70)
    expect(skipped).toHaveLength(0)
  })
})

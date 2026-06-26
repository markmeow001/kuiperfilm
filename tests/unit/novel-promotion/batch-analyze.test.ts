import { describe, expect, it } from 'vitest'
import { selectEpisodesNeedingStoryboard } from '@/lib/novel-promotion/batch-analyze'

describe('selectEpisodesNeedingStoryboard', () => {
  it('selects only episodes without a storyboard (skip-existing default)', () => {
    const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard([
      { id: 'e1', episodeNumber: 1, hasStoryboard: false },
      { id: 'e2', episodeNumber: 2, hasStoryboard: true },
      { id: 'e3', episodeNumber: 3, hasStoryboard: false },
    ])
    expect(toAnalyze).toEqual(['e1', 'e3'])
    expect(skipped).toEqual(['e2'])
  })

  it('orders selection low-to-high so the queue fills episode 1 first', () => {
    const { toAnalyze } = selectEpisodesNeedingStoryboard([
      { id: 'e3', episodeNumber: 3, hasStoryboard: false },
      { id: 'e1', episodeNumber: 1, hasStoryboard: false },
      { id: 'e2', episodeNumber: 2, hasStoryboard: false },
    ])
    expect(toAnalyze).toEqual(['e1', 'e2', 'e3'])
  })

  it('skips everything when all episodes already have storyboards', () => {
    const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard([
      { id: 'e1', episodeNumber: 1, hasStoryboard: true },
      { id: 'e2', episodeNumber: 2, hasStoryboard: true },
    ])
    expect(toAnalyze).toEqual([])
    expect(skipped).toEqual(['e1', 'e2'])
  })

  it('handles an empty project (no episodes)', () => {
    expect(selectEpisodesNeedingStoryboard([])).toEqual({ toAnalyze: [], skipped: [] })
  })

  it('selects all when a fresh 70-episode upload has zero storyboards', () => {
    const episodes = Array.from({ length: 70 }, (_, i) => ({
      id: `e${i + 1}`,
      episodeNumber: i + 1,
      hasStoryboard: false,
    }))
    const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard(episodes)
    expect(toAnalyze).toHaveLength(70)
    expect(skipped).toHaveLength(0)
  })
})

/**
 * "Analyze all episodes" batch selection (2026-06-25).
 *
 * After a multi-episode script is split into N episodes, this picks which
 * episodes the batch should analyze. By product decision the batch only fills
 * episodes that DON'T yet have a storyboard — it never clobbers an episode the
 * user has already analyzed / reviewed. Re-analyzing a specific episode stays a
 * per-episode action. Kept as a pure function so the skip rule is unit-tested
 * independently of the route's prisma / task-submission I/O.
 */

export interface EpisodeStoryboardState {
  id: string
  episodeNumber: number
  /** True when the episode already has at least one storyboard row. */
  hasStoryboard: boolean
}

export interface BatchAnalyzeSelection {
  /** Episode ids to submit an analyze-with-cascade task for. */
  toAnalyze: string[]
  /** Episode ids skipped because they already have a storyboard. */
  skipped: string[]
}

export function selectEpisodesNeedingStoryboard(
  episodes: ReadonlyArray<EpisodeStoryboardState>,
): BatchAnalyzeSelection {
  const toAnalyze: string[] = []
  const skipped: string[] = []
  // Stable, low-to-high episode order so the queue fills episode 1 first.
  const ordered = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
  for (const ep of ordered) {
    if (ep.hasStoryboard) skipped.push(ep.id)
    else toAnalyze.push(ep.id)
  }
  return { toAnalyze, skipped }
}

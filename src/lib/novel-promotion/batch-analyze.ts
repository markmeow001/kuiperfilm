/**
 * "Analyze all episodes" batch selection (2026-06-25).
 *
 * After a multi-episode script is split into N episodes, this picks which
 * episodes the batch should analyze. By product decision the batch only fills
 * episodes that DON'T yet have a COMPLETE storyboard — it never clobbers an
 * episode the user has already analyzed / reviewed. Re-analyzing a specific
 * episode stays a per-episode action. Kept as a pure function so the rule is
 * unit-tested independently of the route's prisma / task-submission I/O.
 *
 * "Complete" = the episode has clips AND every clip has a storyboard row
 * (storyboards are 1-per-clip, NOT 1-per-episode — there is no episodeId unique
 * constraint). A worker that crashed after writing storyboards for only some
 * clips leaves the episode with storyboardCount < clipCount; treating mere
 * `storyboardCount > 0` as "done" would silently skip that half-built episode
 * forever, so we require full coverage. clipCount === 0 means analyze never ran.
 */

export interface EpisodeStoryboardState {
  id: string
  episodeNumber: number
  /** Number of clips (groups) the episode has been split into. 0 = not analyzed. */
  clipCount: number
  /** Number of storyboard rows (1 per clip when fully built). */
  storyboardCount: number
}

export interface BatchAnalyzeSelection {
  /** Episode ids to submit an analyze-with-cascade task for. */
  toAnalyze: string[]
  /** Episode ids skipped because they already have a complete storyboard. */
  skipped: string[]
}

/** An episode is fully storyboarded only when every clip has a storyboard row. */
export function isFullyStoryboarded(e: EpisodeStoryboardState): boolean {
  return e.clipCount > 0 && e.storyboardCount >= e.clipCount
}

export function selectEpisodesNeedingStoryboard(
  episodes: ReadonlyArray<EpisodeStoryboardState>,
): BatchAnalyzeSelection {
  const toAnalyze: string[] = []
  const skipped: string[] = []
  // Stable, low-to-high episode order so the queue fills episode 1 first.
  const ordered = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
  for (const ep of ordered) {
    if (isFullyStoryboarded(ep)) skipped.push(ep.id)
    else toAnalyze.push(ep.id)
  }
  return { toAnalyze, skipped }
}

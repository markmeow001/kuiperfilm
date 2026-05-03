/**
 * Helpers for the multi-shot clip URL storage layer.
 *
 * A storyboard's multi-shot output can be either:
 *   1. A single mp4 (≤15s case) — historically stored in
 *      `multiShotVideoUrl` (legacy column).
 *   2. N chunks (>15s case, dialogue split across multiple Kling calls)
 *      — stored as JSON array in `multiShotClipUrls` (new 2026-05-03
 *      column).
 *
 * Readers should always go through `getMultiShotClipUrls()` so the
 * fallback semantics stay consistent across API routes / UI / ZIP
 * exporter / task-status feeds.
 *
 * Writer side: prefer `setMultiShotClipUrls()` so we always populate
 * the array column; the legacy column gets the first chunk for
 * backward compatibility with any reader still pulling
 * `multiShotVideoUrl` directly.
 */

interface StoryboardLike {
  multiShotVideoUrl?: string | null
  multiShotClipUrls?: string | null
}

/**
 * Resolve a storyboard's multi-shot output into a plain array of URLs.
 *
 *   - If `multiShotClipUrls` is non-null and parses to a non-empty
 *     array of strings → return that.
 *   - Else if `multiShotVideoUrl` is non-null → wrap in [url].
 *   - Else → return [].
 *
 * Never throws — bad data falls back to []. This is the right default
 * for read paths because UI can render "no video yet" cleanly.
 */
export function getMultiShotClipUrls(storyboard: StoryboardLike): string[] {
  const json = storyboard.multiShotClipUrls
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown
      if (Array.isArray(parsed)) {
        const urls = parsed.filter((u): u is string => typeof u === 'string' && u.length > 0)
        if (urls.length > 0) return urls
      }
    } catch {
      // Malformed JSON — fall through to the legacy column.
    }
  }
  const legacy = storyboard.multiShotVideoUrl
  if (legacy && legacy.length > 0) return [legacy]
  return []
}

/**
 * Build the DB update payload for writing a multi-shot result.
 *
 *   - For 1-clip results, both columns are populated so legacy
 *     consumers (that read `multiShotVideoUrl` directly) keep working.
 *   - For N-clip results, the legacy column gets the FIRST clip url
 *     so old code at least sees something playable; full set lives in
 *     the JSON array.
 */
export function buildMultiShotClipUpdate(urls: string[]): {
  multiShotVideoUrl: string | null
  multiShotClipUrls: string | null
} {
  if (urls.length === 0) {
    return { multiShotVideoUrl: null, multiShotClipUrls: null }
  }
  return {
    multiShotVideoUrl: urls[0],
    multiShotClipUrls: JSON.stringify(urls),
  }
}

/**
 * True iff the storyboard's multi-shot output spans multiple clips.
 * Used by the UI to decide between a single-video player vs. a
 * multi-clip rail.
 */
export function isMultiShotChunked(storyboard: StoryboardLike): boolean {
  return getMultiShotClipUrls(storyboard).length > 1
}

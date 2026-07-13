/**
 * Pure selector: from a completed Playground task's `result`, pick the bare COS
 * key of the primary output (the durable object we can re-sign / copy). Run
 * results store `resultUrls` as a mix of bare keys and signed https URLs; we
 * want the first bare key (an https entry is a transient signed URL, not a
 * durable object we can copy server-side).
 *
 * Shared by the canvas "use as background" / "use as reference" copy routes so
 * both agree on what counts as the copyable source key.
 */
export function pickRunResultKey(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const urls = (result as { resultUrls?: unknown }).resultUrls
  if (!Array.isArray(urls)) return null
  const key = urls.find(
    (u): u is string => typeof u === 'string' && u.length > 0 && !u.startsWith('http'),
  )
  return key ?? null
}

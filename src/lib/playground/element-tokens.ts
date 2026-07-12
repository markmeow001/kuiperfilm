/**
 * Kling O3 element token replacement (2026-07-10).
 *
 * The Kling O3 reference-to-video API binds named subjects via the
 * `elements` array and expects the prompt to reference each subject as
 * `<<<element_N>>>` (1-based index into that array). Playground users
 * type the subject's NAME in the prompt; this helper swaps names for
 * tokens server-side so the UX stays natural (mirrors the @角色 chips
 * in the storyboard narrative editor).
 *
 * Matching rules:
 *  - longer names are replaced first so `VeraMom` never gets partially
 *    eaten by `Vera`
 *  - ASCII-only names match on word boundaries (Vera ≠ Veranda); CJK
 *    has no word boundaries, so names containing CJK substring-match
 *  - every occurrence is replaced
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** ASCII word-char test — names made only of these get \b boundaries. */
function isAsciiWordName(name: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(name)
}

/**
 * Replace element names in `prompt` with `<<<element_N>>>` tokens.
 * `names[i]` maps to token index i+1 (the Kling elements array is
 * 1-based). Names absent from the prompt are left alone — Kling
 * accepts unreferenced elements, binding is just weaker.
 */
export interface ElementNameMatch {
  /** UTF-16 offset of the match start (includes a leading @ if present). */
  start: number
  /** Exclusive end offset. */
  end: number
  /** Index into the ORIGINAL names array (drives per-subject colors). */
  nameIndex: number
}

/**
 * Locate every bound-subject-name occurrence in the prompt (2026-07-12
 * prompt-highlight feature). Mirrors replaceElementNamesWithTokens'
 * matching exactly — optional @ prefix, ASCII word boundaries, CJK
 * substring, longest-name-first claiming — so what lights up in the UI is
 * precisely what binds on submit. Returns ranges sorted by start.
 */
export function findElementNameMatches(
  prompt: string,
  names: readonly string[],
): ElementNameMatch[] {
  const ordered = names
    .map((name, nameIndex) => ({ name: name.trim(), nameIndex }))
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length)

  const matches: ElementNameMatch[] = []
  const claimed: Array<[number, number]> = []
  for (const { name, nameIndex } of ordered) {
    const escaped = escapeRegExp(name)
    const pattern = isAsciiWordName(name)
      ? new RegExp(`@?\\b${escaped}\\b`, 'g')
      : new RegExp(`@?${escaped}`, 'g')
    for (const hit of prompt.matchAll(pattern)) {
      const start = hit.index ?? 0
      const end = start + hit[0].length
      if (claimed.some(([s, e]) => start < e && end > s)) continue
      claimed.push([start, end])
      matches.push({ start, end, nameIndex })
    }
  }
  return matches.sort((a, b) => a.start - b.start)
}

/**
 * Build the 參考圖對應 mapping section for named plain reference images
 * (2026-07-10). Seedance-class r2v has no API-level named binding — the
 * storyboard pipeline binds names to images TEXTUALLY via a mapping table
 * (see buildR2vRefMapSection in multi-shot-video-atlascloud-path); this is
 * the playground twin. `names[i]` labels image i+1; blank/null entries are
 * skipped. Returns '' when nothing is named.
 */
export function buildRefImageMapSection(names: ReadonlyArray<string | null | undefined>): string {
  const lines = names
    .map((name, i) => {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      return trimmed ? `image ${i + 1} = 「${trimmed}」` : null
    })
    .filter((l): l is string => Boolean(l))
  if (lines.length === 0) return ''
  return `參考圖對應：\n${lines.join('\n')}`
}

export function replaceElementNamesWithTokens(prompt: string, names: readonly string[]): string {
  // Longest-first so overlapping names resolve to the most specific one.
  const ordered = names
    .map((name, index) => ({ name, token: `<<<element_${index + 1}>>>` }))
    .filter((entry) => entry.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length)

  let out = prompt
  for (const { name, token } of ordered) {
    const escaped = escapeRegExp(name)
    // `@?` swallows the storyboard-carried @Name prefix — the @ is prompt
    // sugar, not part of the subject name; leaving it produced a stray
    // "@<<<element_N>>>". (2026-07-12)
    const pattern = isAsciiWordName(name)
      ? new RegExp(`@?\\b${escaped}\\b`, 'g')
      : new RegExp(`@?${escaped}`, 'g')
    out = out.replace(pattern, token)
  }
  return out
}

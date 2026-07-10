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
export function replaceElementNamesWithTokens(prompt: string, names: readonly string[]): string {
  // Longest-first so overlapping names resolve to the most specific one.
  const ordered = names
    .map((name, index) => ({ name, token: `<<<element_${index + 1}>>>` }))
    .filter((entry) => entry.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length)

  let out = prompt
  for (const { name, token } of ordered) {
    const escaped = escapeRegExp(name)
    const pattern = isAsciiWordName(name)
      ? new RegExp(`\\b${escaped}\\b`, 'g')
      : new RegExp(escaped, 'g')
    out = out.replace(pattern, token)
  }
  return out
}

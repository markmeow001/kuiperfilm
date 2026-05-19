/**
 * Script-level language detector for bilingual / multilingual screenplays.
 *
 * Why script-level rather than full NLP language ID:
 *
 *   - The use case is "Beastbound-style" pro screenplays where each
 *     English paragraph is paired with its Chinese translation. We need
 *     to drop one side before sending to the storyboard LLM (mixed-
 *     language prompts confuse character-binding and lipsync downstream).
 *
 *   - A regex-based script counter is good enough: Han / Latin / Hangul /
 *     Kana / Cyrillic / Arabic ranges don't overlap. We can't distinguish
 *     English from Spanish (both Latin), but the use case doesn't need
 *     it — author writes in one Latin language at a time, and "keep the
 *     Latin parts" preserves that single language correctly.
 *
 * Edge cases handled:
 *   - Inline bilingual ("EP32 — TITLE / 我们交还的姓氏" on one line) is
 *     classified as `mixed` and kept in EVERY language filter, so author-
 *     written headings survive.
 *   - Slug lines ("INT. AVALON ACADEMY — NIGHT") are all-caps Latin even
 *     in a Chinese-language pull — we mark them `neutral` so a "zh"
 *     filter still keeps them, since Chinese-speaking directors still
 *     need to read the scene slug.
 *   - Short paragraphs (< 6 chars, formatting markers, blank lines) are
 *     `neutral`.
 */

export type ScriptCode =
  | 'zh'   // CJK Han ideographs (Simplified or Traditional Chinese)
  | 'en'   // Latin alphabet (English, Spanish, French, Portuguese, …)
  | 'ja'   // Japanese — flagged by presence of Hiragana / Katakana
  | 'ko'   // Korean Hangul
  | 'ru'   // Cyrillic
  | 'ar'   // Arabic

type LineClass = ScriptCode | 'mixed' | 'neutral' | 'slug'

/**
 * Human-facing label for picker UI. Keep these short — they appear in a
 * radio list. Latin gets a hint that it covers more than English so users
 * importing French / Spanish scripts don't think the tool only handles EN.
 */
export const SCRIPT_LABELS: Record<ScriptCode, string> = {
  zh: '中文',
  en: 'English / 拉丁文',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  ar: 'العربية',
}

function isUppercaseLatin(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return c >= 0x41 && c <= 0x5A
}
function isLowercaseLatin(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return c >= 0x61 && c <= 0x7A
}

interface ScriptCounts {
  han: number
  latin: number
  latinLower: number  // separate to detect ALL-CAPS slug lines
  kana: number
  hangul: number
  cyrillic: number
  arabic: number
  total: number
}

function countScripts(text: string): ScriptCounts {
  let han = 0, latin = 0, latinLower = 0, kana = 0, hangul = 0, cyrillic = 0, arabic = 0, total = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    total++
    if (code >= 0x4E00 && code <= 0x9FFF) han++
    else if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) kana++
    else if (code >= 0xAC00 && code <= 0xD7AF) hangul++
    else if (code >= 0x0400 && code <= 0x04FF) cyrillic++
    else if (code >= 0x0600 && code <= 0x06FF) arabic++
    else if (isUppercaseLatin(ch)) { latin++ }
    else if (isLowercaseLatin(ch)) { latin++; latinLower++ }
  }
  return { han, latin, latinLower, kana, hangul, cyrillic, arabic, total }
}

function classifyLine(line: string): LineClass {
  const trimmed = line.trim()
  if (trimmed.length === 0) return 'neutral'
  if (trimmed.length < 6) return 'neutral'

  const c = countScripts(trimmed)

  // Inline-bilingual lines: substantial Han + substantial Latin both
  // present. These usually carry single-line headings like
  // "EP32 — TITLE / 我们交还的姓氏" — preserve in every filter.
  if (c.han >= 5 && c.latin >= 5) return 'mixed'

  // Japanese: Kana is the giveaway (Kana ranges don't overlap with Han).
  // A line with kana + Han is still Japanese, not Chinese.
  if (c.kana >= 3) return 'ja'

  // Slug lines / shot headings: ALL-CAPS Latin, no lower-case, often
  // contains em-dash and CUT TO / INT. / EXT. Treat as neutral so they
  // survive a "zh" filter.
  if (c.latin >= 6 && c.latinLower === 0 && c.han === 0) return 'slug'

  // Now pick the dominant script. Need at least 5 chars of evidence so
  // we don't classify "🎵" or "1." as a language.
  const scores: Array<[ScriptCode, number]> = [
    ['zh', c.han],
    ['en', c.latin],
    ['ko', c.hangul],
    ['ru', c.cyrillic],
    ['ar', c.arabic],
  ]
  scores.sort((a, b) => b[1] - a[1])
  if (scores[0][1] >= 5) return scores[0][0]
  return 'neutral'
}

/**
 * Detect which scripts are present in the document. Returns codes sorted
 * by total character count descending (so the dominant script is first —
 * useful as the default picker selection).
 */
export function detectScripts(text: string): ScriptCode[] {
  // Walk the whole text. For 100KB+ scripts we could sample, but a single
  // pass over 100KB of UTF-8 is sub-millisecond — not worth the complexity.
  const totals: Record<ScriptCode, number> = { zh: 0, en: 0, ja: 0, ko: 0, ru: 0, ar: 0 }
  const lines = text.split(/\n/)
  for (const line of lines) {
    const cls = classifyLine(line)
    if (cls === 'neutral' || cls === 'slug' || cls === 'mixed') continue
    totals[cls] += line.length
  }
  // Threshold: a script must contribute at least 50 chars of dedicated
  // (non-mixed, non-slug) content to register. Below that it's likely a
  // stray loanword or quote, not actual content authored in that script.
  const present = (Object.entries(totals) as Array<[ScriptCode, number]>)
    .filter(([, v]) => v >= 50)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
  return present
}

/**
 * Return only the paragraphs of `text` whose dominant script is `target`,
 * preserving neutral / slug / mixed paragraphs (universal context like
 * scene headings, formatting markers, single-line bilingual titles).
 *
 * Paragraph delimiter: a run of 2+ newlines if present; otherwise we
 * filter line-by-line. The double-newline path preserves multi-line
 * dialogue blocks; the single-newline fallback rescues docs that use
 * tight line breaks instead of blank lines.
 */
export function filterByScript(text: string, target: ScriptCode): string {
  const doubleNewline = /\n\s*\n+/
  if (doubleNewline.test(text)) {
    const paragraphs = text.split(/(\n\s*\n+)/) // keep separators
    const out: string[] = []
    for (let i = 0; i < paragraphs.length; i++) {
      const piece = paragraphs[i]
      if (i % 2 === 1) {
        // Separator. Keep only if surrounded by kept content (avoid
        // leading / trailing blank gaps).
        if (out.length > 0) out.push(piece)
        continue
      }
      const cls = classifyParagraph(piece)
      if (cls === target || cls === 'neutral' || cls === 'slug' || cls === 'mixed') {
        out.push(piece)
      }
    }
    return out.join('').replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n')
  }
  // No double newlines — filter per line.
  return text.split('\n')
    .filter((line) => {
      const cls = classifyLine(line)
      return cls === target || cls === 'neutral' || cls === 'slug' || cls === 'mixed'
    })
    .join('\n')
    .replace(/^\s+|\s+$/g, '')
}

function classifyParagraph(paragraph: string): LineClass {
  // Aggregate line classifications. Largest non-neutral wins.
  const lines = paragraph.split(/\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return 'neutral'
  const counts: Partial<Record<LineClass, number>> = {}
  for (const line of lines) {
    const cls = classifyLine(line)
    counts[cls] = (counts[cls] ?? 0) + 1
  }
  // "mixed" wins outright — a paragraph with any inline-bilingual line
  // should be preserved in every filter (e.g. multi-line bilingual headers).
  if ((counts.mixed ?? 0) > 0) return 'mixed'
  let best: LineClass = 'neutral'
  let bestCount = 0
  for (const [k, v] of Object.entries(counts)) {
    if ((k === 'neutral' || k === 'slug') && best === 'neutral') {
      // slug beats neutral, but a real-language vote still wins below.
      if (k === 'slug' && (v ?? 0) > bestCount) {
        best = 'slug'
        bestCount = v ?? 0
      }
      continue
    }
    if (k !== 'neutral' && k !== 'slug' && (v ?? 0) > bestCount) {
      best = k as LineClass
      bestCount = v ?? 0
    }
  }
  return best
}

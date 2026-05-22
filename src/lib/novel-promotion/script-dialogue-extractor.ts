/**
 * Script-format dialogue extractor.
 *
 * The voice_analysis LLM prompt only recognises **quoted** dialogue
 * ("xxx" / 「xxx」 / 「他说："xxx"」). Screenplay-style colon dialogue
 * (王玄OS：洞府一甲子... / 桃桃（哽咽VO）：爸爸...) is silently dropped,
 * which means iangyc's 2026-05-12 episode produced an empty voice_lines
 * table even though the original script had five dialogue lines.
 *
 * This module is the deterministic write-side fallback that pairs with
 * the LLM output — same pattern used for panel.characters (the
 * enrichPanelCharacters / 12b89e1 fix). LLM remains the primary path;
 * regex extraction backfills anything the LLM missed.
 */

interface ExtractedDialogue {
  speaker: string
  modifier: string | null // 'OS' | 'VO' | '画外音' | '独白' | '旁白' | null
  content: string
  lineNumber: number // 1-based original-script line
}

/** Tokens treated as VO/OS modifiers — both English abbreviations
 *  (commonly stuck inline to the speaker name) and full Chinese names. */
const MODIFIER_TOKENS = [
  // Longer ones first so 'V.O.' matches before 'VO' when used as a suffix.
  'V.O.',
  'O.S.',
  'VO',
  'OS',
  '画外音',
  '畫外音',
  '旁白',
  '独白',
  '獨白',
] as const

/** Non-dialogue line keywords that look like "speaker:content" but are
 *  actually screenplay metadata. We do not want to extract these as
 *  voice lines even though they share the colon shape. */
const NON_DIALOGUE_HEAD_KEYWORDS = new Set([
  '字幕',
  '场景',
  '場景',
  '画面',
  '畫面',
  '标题',
  '標題',
  '人物',
  '镜头',
  '鏡頭',
  '特效',
  '注释',
  '註釋',
  '时间',
  '時間',
  '地点',
  '地點',
])

/** Chapter / act / scene markers commonly used as section headers in
 *  Chinese and English shot-lists. Matches the WHOLE speaker head; any
 *  match rejects the line outright. Without this guard, "第一幕：致命倒数"
 *  becomes speaker=第一幕 content=致命倒数, which was the 2026-05-22
 *  《迁徙》 bug. Keep the patterns greedy on the marker token and anchor
 *  with ^…$ so genuine names ending in 幕/集 (rare) are not blocked. */
const CHAPTER_MARKER_RE = /^(?:第[零一二三四五六七八九十百千0-9]+[幕集章节節场場回部]|序幕|序章|终幕|終幕|尾声|尾聲|楔子|引子|(?:Episode|Act|Chapter|Scene|Part|Prologue|Epilogue)\s*\d*)$/i

/** Speakers must contain at least one CJK or Latin LETTER. Pure-digit
 *  heads like "0" (extracted from a timestamp like "0:03 - 0:12 [...]")
 *  pass SPEAKER_SHAPE_RE because \w includes digits — reject them here.
 *  CJK range covers Chinese, Japanese kanji, and Korean hanja; Latin
 *  covers screenplay imports written with English speaker names. */
const HAS_LETTER_RE = /[一-鿿A-Za-z]/

/** Action markers that prefix scene direction lines. We skip the whole
 *  line. (△/▲ are screenplay convention; the rest are defensive.) */
const ACTION_PREFIX_RE = /^[△▲◇◆＊*•·]/

/** Speaker name acceptable shape: CJK + Latin + middle-dot + space.
 *  Pure-ASCII (e.g. "Dr. Smith") allowed; long meta-text rejected. */
const SPEAKER_SHAPE_RE = /^[一-鿿A-Za-z··　-〿\w\s.]+$/

const MAX_SPEAKER_LENGTH = 20

/**
 * Extract all script-format dialogue lines from a raw episode script.
 * Returns each occurrence in original order with its line number so
 * downstream callers can re-derive ordering / panel proximity.
 *
 * Quoted dialogue is intentionally NOT extracted here — the LLM is
 * already accurate on that path, and we don't want to double-count.
 * Only lines that match the screenplay `speaker[(modifier)]: content`
 * shape are returned.
 */
export function extractScriptDialogues(rawScript: string): ExtractedDialogue[] {
  if (!rawScript || !rawScript.trim()) return []
  const results: ExtractedDialogue[] = []
  const lines = rawScript.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    if (ACTION_PREFIX_RE.test(trimmed)) continue

    // Find first half-width or full-width colon.
    const colonMatch = trimmed.match(/^([^:：]{1,40})[：:](.+)$/)
    if (!colonMatch) continue

    const headRaw = colonMatch[1].trim()
    const tail = colonMatch[2].trim()
    if (!tail) continue

    const parsed = parseSpeakerHead(headRaw)
    if (!parsed) continue
    if (NON_DIALOGUE_HEAD_KEYWORDS.has(parsed.speaker)) continue
    if (CHAPTER_MARKER_RE.test(parsed.speaker)) continue
    if (!HAS_LETTER_RE.test(parsed.speaker)) continue
    if (!SPEAKER_SHAPE_RE.test(parsed.speaker)) continue
    if (parsed.speaker.length === 0 || parsed.speaker.length > MAX_SPEAKER_LENGTH) continue

    results.push({
      speaker: parsed.speaker,
      modifier: parsed.modifier,
      content: tail,
      lineNumber: i + 1,
    })
  }

  return results
}

/**
 * Parse the part before the colon into `{speaker, modifier}`. Handles:
 *   "王玄OS"             → speaker="王玄",  modifier="OS"
 *   "桃桃（哽咽VO）"      → speaker="桃桃",  modifier="VO"   (parens, comma-sep tokens)
 *   "王玄（闭眼皱眉，OS）"  → speaker="王玄",  modifier="OS"
 *   "柳如烟"             → speaker="柳如烟", modifier=null
 *   "（无名路人）"         → null (skipped, no real speaker)
 */
function parseSpeakerHead(head: string): { speaker: string; modifier: string | null } | null {
  let speaker = head.trim()
  let modifier: string | null = null

  // Strip trailing parenthetical (full-width or half-width).
  const parenMatch = speaker.match(/^([^（(]*)[（(]\s*([^)）]*)\s*[)）]\s*$/)
  if (parenMatch) {
    speaker = parenMatch[1].trim()
    const parenContent = parenMatch[2]
    // The parenthetical can carry emotion descriptors mixed with the
    // modifier (e.g. "闭眼皱眉，OS" comma-separated, or "哽咽VO" glued
    // straight onto the descriptor). Scan the whole parenthetical for
    // any modifier appearance; the descriptor text is irrelevant to us.
    modifier = findModifierInText(parenContent)
  }

  // Strip inline-suffix modifier (王玄OS, 桃桃VO, 王玄旁白, etc).
  for (const token of MODIFIER_TOKENS) {
    if (speaker.endsWith(token)) {
      speaker = speaker.slice(0, -token.length).trim()
      if (modifier === null) modifier = token
      break
    }
  }

  if (!speaker) return null
  return { speaker, modifier }
}

function findModifierInText(text: string): string | null {
  if (!text) return null
  const upper = text.toUpperCase()
  for (const m of MODIFIER_TOKENS) {
    if (upper.includes(m.toUpperCase())) return m
  }
  return null
}

/**
 * Build a normalised key for one dialogue line — strips all whitespace
 * and punctuation so trailing ellipsis / spacing variations collapse
 * together. Returns the full normalised content (not truncated) so the
 * caller can prefix-match against varying-length variants.
 */
export function dialogueDedupKey(speaker: string, content: string): string {
  const normalisedContent = content
    .replace(/\s+/g, '')
    .replace(/[，,。.！!？?…\-—　]/g, '')
    // 2026-05-22 — strip every flavour of quote so an LLM emission of
    // `Warning. Illegal...` dedupes against the regex extraction of
    // `"Warning. Illegal..."` (script kept the quotes, LLM stripped
    // them). Without this, the same line lands in voice_lines twice.
    .replace(/["'`‘’“”「」『』]/g, '')
  return `${speaker.trim()}::${normalisedContent}`
}

/** Minimum overlap (in normalised chars) for two dialogue keys to be
 *  considered "the same line". Short enough to absorb ellipsis /
 *  truncation, long enough not to collapse genuinely distinct lines. */
const DEDUP_MIN_PREFIX = 8

/**
 * True if `candidateKey` shares the same speaker AND a common prefix
 * of ≥ DEDUP_MIN_PREFIX normalised chars with any key in `seen`.
 * Used to suppress regex-extracted rows already covered by LLM output.
 */
export function isDialogueDuplicate(candidateKey: string, seen: Iterable<string>): boolean {
  const [candidateSpeaker, candidateContent] = splitDedupKey(candidateKey)
  if (!candidateSpeaker || candidateContent.length === 0) return false
  for (const key of seen) {
    const [speaker, content] = splitDedupKey(key)
    if (speaker !== candidateSpeaker) continue
    const overlap = Math.min(content.length, candidateContent.length)
    if (overlap < DEDUP_MIN_PREFIX) continue
    if (content.slice(0, overlap) === candidateContent.slice(0, overlap)) return true
  }
  return false
}

function splitDedupKey(key: string): [string, string] {
  const sep = key.indexOf('::')
  if (sep === -1) return ['', key]
  return [key.slice(0, sep), key.slice(sep + 2)]
}

/**
 * Heuristic emotionStrength for regex-extracted lines (LLM rows already
 * carry their own). VO/OS lines lean contemplative (lower intensity);
 * exclamation / multiple exclamation pushes higher; questions and
 * ellipses sit in the middle. Returns a value in [0.1, 0.5] matching
 * the voice_analysis.zh.txt scale.
 */
export function inferEmotionFromContent(content: string, modifier: string | null): number {
  const isVoiceOver =
    modifier === 'OS' ||
    modifier === 'VO' ||
    modifier === 'O.S.' ||
    modifier === 'V.O.' ||
    modifier === '画外音' ||
    modifier === '畫外音' ||
    modifier === '旁白' ||
    modifier === '独白' ||
    modifier === '獨白'

  if (/[！!]{2,}/.test(content)) return 0.4
  if (isVoiceOver) {
    if (/[！!]/.test(content)) return 0.3
    return 0.2
  }
  if (/[！!]/.test(content)) return 0.3
  if (/[？?]/.test(content)) return 0.25
  if (/[…]/.test(content)) return 0.2
  return 0.2
}

export type { ExtractedDialogue }

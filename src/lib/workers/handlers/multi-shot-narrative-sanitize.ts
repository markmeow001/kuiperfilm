/**
 * Narrative-prompt sanitizers for the R2V rawPrompt (hand-edited / LLM-authored)
 * branch. Kept separate from the audio directive so each concern stays small.
 *
 * 2026-06-17 — the storyboard-detail LLM introduces characters with on-screen
 * caption lines like `乾  字幕: 王玄二弟子，` / `坤  字卡: 三弟子`. These are doubly
 * wrong on a clean-frame R2V pipeline: the model (1) renders the text into the
 * frame (the very 字幕 the clean-frame directive forbids — a pink-elephant prime)
 * and (2) reads the caption aloud as 口白 (user-reported: 字幕 被口白念出來). The
 * real character identity is already carried by the @ref binding, so the caption
 * line carries no information the video can legally show — we drop it before the
 * prompt is sent. The prompt-side fix (forbidding the LLM from emitting captions)
 * is the root cause; this is the safety net for narratives already saved with
 * captions, so the user doesn't have to hand-edit every group.
 */

/** Caption-label markers that must never reach the video model. */
const CAPTION_MARKERS = ['字幕', '字卡', '名牌', '名条', '名條', '标题卡', '標題卡', '角标', '角標']

const CAPTION_LINE_RE = new RegExp(`(?:${CAPTION_MARKERS.join('|')})[:：]`)

export interface CaptionStripResult {
  cleaned: string
  removed: string[]
}

/**
 * Remove on-screen caption / name-card lines from a narrative. A line is dropped
 * when it carries a caption marker used as a label (`字幕：…`, `字卡：…`), e.g.
 * `乾  字幕: 王玄二弟子，`. Returns the cleaned narrative plus the removed lines
 * so the caller can LOG what was stripped (never silently truncate user content).
 *
 * Conservative on purpose: only a `marker[:：]` label triggers removal, so prose
 * that merely mentions 字幕 in passing (e.g. 描述某人盯著电视字幕) is preserved —
 * it has no labeling colon right after the marker.
 */
export function stripCaptionLines(raw: string): CaptionStripResult {
  if (!raw) return { cleaned: raw, removed: [] }
  const removed: string[] = []
  const keptLines: string[] = []
  for (const line of raw.split('\n')) {
    if (CAPTION_LINE_RE.test(line)) {
      const trimmed = line.trim()
      if (trimmed.length > 0) removed.push(trimmed)
      continue
    }
    keptLines.push(line)
  }
  if (removed.length === 0) return { cleaned: raw, removed }
  // Collapse the blank gaps left by removed lines so the scaffold stays tidy.
  const cleaned = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { cleaned, removed }
}

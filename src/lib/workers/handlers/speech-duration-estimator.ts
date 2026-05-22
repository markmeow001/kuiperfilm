/**
 * Speech-duration estimator for Kling Omni multi-shot dialogue.
 *
 * Why this exists:
 *   Kling Omni intelligence mode allocates roughly equal time across
 *   shots (15s / N). When a panel's dialogue is long, the TTS engine
 *   can't fit the line in its slice and trails off mid-word. Users
 *   reported "對白被砍" — the model genuinely runs out of seconds.
 *
 * Approach:
 *   For each panel, estimate how long the dialogue takes to speak from
 *   raw text length, then build a `multi_prompt` durations array that
 *   guarantees every line has airtime. Stays inside Kling's hard 15s
 *   total cap (see KLING_OMNI_MAX_TOTAL_DURATION); if the script can't
 *   fit, throws a clear error so the caller can split into multiple
 *   Kling tasks rather than silently truncate.
 *
 * Estimation tuning:
 *   - CJK (中/日/韓): ~4 chars/sec for emotional delivery, faster
 *     than "comfortable read aloud" (~3) but slower than rapid
 *     dialogue (~5). 4 is the empirical sweet spot from Kling Omni
 *     TTS samples we tested 2026-04 ~ 2026-05.
 *   - Non-CJK (en/es/pt etc): ~2.3 words/sec ≈ 138 wpm, the standard
 *     conversational TV-drama rate.
 *   - Per-line buffer: 0.4s for breath / scene action.
 *   - Floor per panel: KLING_OMNI_DEFAULT_PER_SHOT_DURATION (3s) so
 *     silent panels still get enough screen time.
 *
 * The multi-shot-video-b-path handler calls
 * buildDialogueDrivenDurations() when:
 *   - the caller didn't pass `panelDurations` explicitly, AND
 *   - at least one panel has matched dialogue
 *
 * If everything is silent we leave durations to the existing equal-
 * split logic (distributeShotDurations).
 */

// Pull constants from the leaf module, NOT from
// ./multi-shot-video-b-path — pulling them from b-path created a
// circular import that crashed the worker at startup. See
// ./kling-omni-constants for the full incident note.
import {
  KLING_OMNI_DEFAULT_PER_SHOT_DURATION,
  KLING_OMNI_MAX_TOTAL_DURATION,
} from './kling-omni-constants'

const CJK_CHARS_PER_SEC = 4
const NON_CJK_WORDS_PER_SEC = 2.3
const PER_LINE_BUFFER_SEC = 0.4
const PER_PANEL_MIN_SEC = KLING_OMNI_DEFAULT_PER_SHOT_DURATION
const PER_PANEL_MAX_SEC = KLING_OMNI_MAX_TOTAL_DURATION

/**
 * True for CJK Unified Ideographs and common kana ranges. We treat
 * each codepoint as one syllable for the purposes of timing — close
 * enough for the speech rate constants above.
 */
function isCjkChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (
    // CJK Unified Ideographs
    (code >= 0x4e00 && code <= 0x9fff) ||
    // CJK Extension A
    (code >= 0x3400 && code <= 0x4dbf) ||
    // Hiragana / Katakana
    (code >= 0x3040 && code <= 0x30ff) ||
    // Hangul Syllables
    (code >= 0xac00 && code <= 0xd7af)
  )
}

/**
 * Estimate seconds of speech for a single line of text. Mixed-script
 * lines are handled by accumulating CJK chars and non-CJK words
 * separately and adding their estimated times.
 */
export function estimateSpeechSeconds(text: string): number {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return 0
  let cjkChars = 0
  const nonCjkChars: string[] = []
  for (const ch of trimmed) {
    if (isCjkChar(ch)) {
      cjkChars += 1
    } else {
      nonCjkChars.push(ch)
    }
  }
  const cjkSec = cjkChars / CJK_CHARS_PER_SEC
  // Words for non-CJK = whitespace-split tokens of length > 0.
  const nonCjkText = nonCjkChars.join('')
  const wordCount = nonCjkText
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]/.test(w))
    .length
  const nonCjkSec = wordCount / NON_CJK_WORDS_PER_SEC
  return cjkSec + nonCjkSec
}

interface PanelDialogueLike {
  speaker: string
  content: string
}

/**
 * Sum the speech time of all lines on a panel + a small per-line
 * buffer for natural pauses. Returns 0 for silent panels — callers
 * decide what minimum silent-panel duration looks like.
 */
export function estimatePanelSpeechSeconds(lines: ReadonlyArray<PanelDialogueLike> | undefined): number {
  if (!lines || lines.length === 0) return 0
  let total = 0
  for (const line of lines) {
    total += estimateSpeechSeconds(line.content)
  }
  // One buffer per line covers pre-line breath + post-line beat.
  total += lines.length * PER_LINE_BUFFER_SEC
  return total
}

export interface DialogueDrivenDurationsResult {
  /** Per-panel duration in whole seconds, in input panel order. */
  durations: number[]
  /** Sum of `durations` — equals Kling's `Duration` field. */
  totalDuration: number
  /** Estimated raw seconds before clamping (sum of estimates). Useful for telemetry. */
  rawEstimateTotal: number
  /** Indexes of panels whose estimate exceeded PER_PANEL_MAX_SEC and were clamped. */
  clampedPanels: number[]
  /** True iff at least one line was found across all panels. */
  hasDialogue: boolean
}

export interface BuildDialogueDrivenDurationsParams {
  panels: ReadonlyArray<{ id: string }>
  dialogueByPanelId: ReadonlyMap<string, ReadonlyArray<PanelDialogueLike>>
  /** Optional override for the per-panel floor (silent panels). */
  silentPanelSeconds?: number
}

/**
 * Build a per-panel durations array sized so every dialogue line has
 * airtime. Returns null when no panel has dialogue (caller should fall
 * back to the existing equal-split logic).
 *
 * Throws DIALOGUE_EXCEEDS_KLING_BUDGET when the total estimated speech
 * time exceeds KLING_OMNI_MAX_TOTAL_DURATION even after applying min
 * floors — the caller can surface this to the user with the suggested
 * fix (split the panel group into two Kling tasks).
 */
export function buildDialogueDrivenDurations(
  params: BuildDialogueDrivenDurationsParams,
): DialogueDrivenDurationsResult | null {
  const { panels, dialogueByPanelId } = params
  const silentSec = params.silentPanelSeconds ?? PER_PANEL_MIN_SEC

  let hasAny = false
  const rawEstimates: number[] = []
  for (const p of panels) {
    const lines = dialogueByPanelId.get(p.id)
    const sec = estimatePanelSpeechSeconds(lines)
    if (sec > 0) hasAny = true
    rawEstimates.push(sec)
  }
  if (!hasAny) return null

  // First pass: clamp each panel to [floor, max]. Floor = silentSec for
  // panels with no dialogue; for panels with dialogue, floor is also
  // silentSec because Kling's per-shot minimum is 1 but we want at
  // least 3s for visual coherence (matches default).
  const clampedPanels: number[] = []
  const clamped = rawEstimates.map((sec, i) => {
    if (sec === 0) return silentSec
    if (sec > PER_PANEL_MAX_SEC) {
      clampedPanels.push(i)
      return PER_PANEL_MAX_SEC
    }
    // Round up — better to give the line an extra fraction-second than
    // truncate the tail. Kling rejects fractional durations (must be
    // integer seconds).
    return Math.max(silentSec, Math.ceil(sec))
  })

  let total = clamped.reduce((a, b) => a + b, 0)
  const rawTotal = rawEstimates.reduce((a, b) => a + b, 0)

  // If the un-clamped speech estimate alone exceeds the total budget,
  // we genuinely cannot fit. Surface a friendly error.
  if (rawTotal > PER_PANEL_MAX_SEC) {
    throw new Error(
      `DIALOGUE_EXCEEDS_KLING_BUDGET: estimated ${rawTotal.toFixed(1)}s of speech exceeds Kling Omni's ${PER_PANEL_MAX_SEC}s per-task cap. Split this panel group into two video tasks or shorten dialogue.`,
    )
  }

  // If the integer-rounded total overruns 15s purely because of silent-
  // panel padding, shave silent panels first (they're the cheapest to
  // shrink). Floor is 1s — Kling's hard minimum.
  if (total > PER_PANEL_MAX_SEC) {
    for (let i = 0; i < clamped.length && total > PER_PANEL_MAX_SEC; i++) {
      if (rawEstimates[i] === 0 && clamped[i] > 1) {
        const cut = Math.min(clamped[i] - 1, total - PER_PANEL_MAX_SEC)
        clamped[i] -= cut
        total -= cut
      }
    }
  }

  // Then trim panels whose ceil() rounding pushed them above the
  // estimate (give back the rounding slack). Stay above estimate.
  if (total > PER_PANEL_MAX_SEC) {
    for (let i = 0; i < clamped.length && total > PER_PANEL_MAX_SEC; i++) {
      const estCeil = Math.ceil(rawEstimates[i])
      if (clamped[i] > estCeil) {
        const cut = Math.min(clamped[i] - estCeil, total - PER_PANEL_MAX_SEC)
        clamped[i] -= cut
        total -= cut
      }
    }
  }

  // Last resort: still over — should be unreachable given the
  // rawTotal check above, but defend anyway.
  if (total > PER_PANEL_MAX_SEC) {
    throw new Error(
      `DIALOGUE_EXCEEDS_KLING_BUDGET: even after silent-panel trimming, total reached ${total}s (cap ${PER_PANEL_MAX_SEC}s). Split into multiple video tasks.`,
    )
  }

  return {
    durations: clamped,
    totalDuration: total,
    rawEstimateTotal: rawTotal,
    clampedPanels,
    hasDialogue: true,
  }
}

export interface GroupRecommendedDurationOptions {
  /**
   * 2026-05-22 — per-group fair share derived from project.targetDuration.
   * Caller computes `targetSecPerGroup = targetTotalSec / groupCount` and
   * passes it here so silent groups don't collapse to the 10s default when
   * the user explicitly wants a longer total. Honored as a soft floor —
   * still clamped to [5, 15] for Seedance per-call hard limits, and still
   * overridden by panel-count floor (~2.5s/panel) when that's larger so
   * dense groups don't shrink.
   *
   * Omit (or pass null/undefined) to keep the legacy "fixed 10s floor"
   * behavior — used by tests + any caller that hasn't been threaded to
   * carry targetDuration yet.
   */
  targetSecPerGroup?: number | null
}

/**
 * Single-group recommended duration helper used by frontend group cards
 * and the cumulative time-range computation in V2GroupsLayout. Mirrors
 * the worker's Phase M baseline so the dropdown "Auto (推薦 Ns)" hint,
 * the group header time-range label, and the actual generated mp4 all
 * agree on the same N.
 *
 * Pipeline:
 *   1. Pull dialogue out of each panel's srtSegment (loose ":"/"：" split,
 *      narration when no speaker prefix).
 *   2. Run buildDialogueDrivenDurations. If it returns hasDialogue,
 *      use its totalDuration.
 *   3. Otherwise (no dialogue, or DIALOGUE_EXCEEDS_KLING_BUDGET) fall
 *      back to max(targetFloor, panels*2.5) clamped to [4, 15]. targetFloor
 *      is options.targetSecPerGroup when supplied, else the legacy 10s.
 *
 * Returns null only when panels is empty (caller can decide what to
 * render then — typically just hide the segment).
 */
export function computeGroupRecommendedDurationSec(
  panels: Array<{ id: string; srtSegment?: string | null }>,
  options?: GroupRecommendedDurationOptions,
): number | null {
  if (panels.length === 0) return null

  const dialogueByPanelId = new Map<string, Array<{ speaker: string; content: string }>>()
  for (const p of panels) {
    const seg = (p.srtSegment ?? '').trim()
    if (!seg) continue
    // [\s\S] in lieu of /s flag (frontend tsconfig predates ES2018).
    const m = seg.match(/^([^:：「"'']{1,20})\s*[:：]\s*([\s\S]+)$/)
    const speaker = m?.[1]?.trim() || '旁白'
    const content = m?.[2]?.trim() || seg
    dialogueByPanelId.set(p.id, [{ speaker, content }])
  }

  try {
    const driven = buildDialogueDrivenDurations({
      panels: panels.map((p) => ({ id: p.id })),
      dialogueByPanelId,
    })
    if (driven && driven.hasDialogue) {
      return driven.totalDuration
    }
  } catch {
    // DIALOGUE_EXCEEDS_KLING_BUDGET — fall through to baseline.
  }

  // 2026-05-22 — when caller supplies a target share, use it as the floor.
  // Otherwise keep the legacy fixed-10s floor. Panel-count floor (2.5s per
  // panel) wins when groups are dense so we don't squeeze visual beats.
  const targetFloor =
    typeof options?.targetSecPerGroup === 'number' && Number.isFinite(options.targetSecPerGroup)
      ? options.targetSecPerGroup
      : 10
  const panelFloor = Math.round(panels.length * 2.5)
  const baseline = Math.max(targetFloor, panelFloor)
  return Math.max(4, Math.min(15, Math.round(baseline)))
}

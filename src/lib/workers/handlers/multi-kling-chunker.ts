/**
 * Multi-Kling chunker — split a panel group into sub-tasks when its
 * total dialogue exceeds Kling Omni's 15s per-call cap.
 *
 * Why this exists:
 *   Kling Omni multi-shot is hard-capped at 15s total Duration per
 *   API call (Tencent VOD AIGC §3.9.1). When a scene has more
 *   dialogue than that, the existing handler throws
 *   DIALOGUE_EXCEEDS_KLING_BUDGET. To deliver a watchable video
 *   without dropping any line, we split the panels into N chunks
 *   each ≤15s, dispatch them in sequence, and stitch the outputs
 *   via Tencent VOD's EditMedia (modern concat).
 *
 * Why score-based DP instead of greedy first-fit:
 *   Greedy "fill 15s then start a new chunk" creates the worst
 *   possible cuts — mid-line, mid-action. We score every candidate
 *   chunking and pick the one whose cut points land on natural beats:
 *   location changes (the cut would be a hard cut anyway), speaker
 *   changes (clean dialogue handoff), or shotType changes (intended
 *   visual punctuation).
 *
 * Voice consistency across chunks is NOT addressed here — the Tencent
 * Kling Omni API doesn't expose voice_id (capability matrix at VOD doc
 * §3.9.1). User-accepted trade-off: every line preserved with mild
 * voice drift > silently dropped half the dialogue.
 */

import {
  KLING_OMNI_MAX_TOTAL_DURATION,
  KLING_OMNI_MAX_SHOTS,
  KLING_OMNI_DEFAULT_PER_SHOT_DURATION,
} from './kling-omni-constants'
import { estimatePanelSpeechSeconds } from './speech-duration-estimator'

/** How much of the 15s budget we target — leaves a 3s breathing room. */
export const CHUNK_TARGET_SECONDS = 12

/** Maximum chunks per dispatch. Throttled by Tencent's per-account quota
 *  (default 5 parallel slots); we leave room for other users' jobs. */
export const MAX_CHUNKS_PER_DISPATCH = 3

interface PanelLike {
  id: string
  /** Optional — used to detect location changes for cleaner cuts. */
  locationId?: string | null
  /** Optional — used to detect speaker handoffs. */
  shotType?: string | null
}

interface DialogueLineLike {
  speaker: string
  content: string
}

export interface MultiKlingChunk {
  /** Panels included in this chunk, in original order. */
  panels: ReadonlyArray<PanelLike>
  /** Per-panel duration in whole seconds; sums to ≤ KLING_OMNI_MAX_TOTAL_DURATION. */
  durations: number[]
  /** Sum of `durations`. */
  totalDuration: number
  /** Estimated speech seconds across the panels in this chunk (raw). */
  estimatedSpeechSeconds: number
}

export interface MultiKlingSplitPlan {
  /** Ordered chunks ready for sequential dispatch. */
  chunks: MultiKlingChunk[]
  /** Quality score the chunker picked; higher = cleaner cuts. */
  score: number
  /** Explanation of why each cut was placed where it is. */
  cutReasons: string[]
}

export interface BuildSplitPlanParams {
  panels: ReadonlyArray<PanelLike>
  dialogueByPanelId: ReadonlyMap<string, ReadonlyArray<DialogueLineLike>>
  /** Override target — defaults to CHUNK_TARGET_SECONDS. */
  targetSeconds?: number
}

interface DominantSpeakerCache {
  byPanel: Map<string, string | null>
}

function dominantSpeaker(
  panel: PanelLike,
  dialogueByPanelId: ReadonlyMap<string, ReadonlyArray<DialogueLineLike>>,
  cache: DominantSpeakerCache,
): string | null {
  const cached = cache.byPanel.get(panel.id)
  if (cached !== undefined) return cached
  const lines = dialogueByPanelId.get(panel.id)
  if (!lines || lines.length === 0) {
    cache.byPanel.set(panel.id, null)
    return null
  }
  // Speaker that says the most chars wins. Most panels are single-
  // speaker so this collapses to "whoever spoke".
  const tally = new Map<string, number>()
  for (const line of lines) {
    const k = line.speaker?.trim() || 'unknown'
    tally.set(k, (tally.get(k) ?? 0) + line.content.length)
  }
  let best: { speaker: string; count: number } | null = null
  for (const [speaker, count] of tally) {
    if (!best || count > best.count) best = { speaker, count }
  }
  const winner = best?.speaker ?? null
  cache.byPanel.set(panel.id, winner)
  return winner
}

/**
 * Score a candidate cut between panels[i-1] and panels[i]. Higher is
 * better. Returns 0 when no signal — that's a "neutral" cut, neither
 * great nor terrible.
 *
 * Heuristics tuned for short-form drama dialogue scenes (the demo
 * project's content). Over time we'll log which signals correlate
 * with viewer-judged quality and re-tune.
 */
function cutQualityScore(
  prev: PanelLike,
  next: PanelLike,
  dialogueByPanelId: ReadonlyMap<string, ReadonlyArray<DialogueLineLike>>,
  cache: DominantSpeakerCache,
): { score: number; reason: string } {
  // Location change — cleanest cut possible. The viewer expects a hard
  // cut at scene transitions, so the seam reads as cinematography.
  if (prev.locationId && next.locationId && prev.locationId !== next.locationId) {
    return { score: 100, reason: 'location-change' }
  }

  // Speaker handoff — second-cleanest. The new chunk gets a fresh
  // "who's talking" reset. Avoids mid-line splits since a different
  // speaker on each side means the line ended.
  const prevSpeaker = dominantSpeaker(prev, dialogueByPanelId, cache)
  const nextSpeaker = dominantSpeaker(next, dialogueByPanelId, cache)
  if (prevSpeaker && nextSpeaker && prevSpeaker !== nextSpeaker) {
    return { score: 50, reason: 'speaker-change' }
  }

  // Shot-type change — directorially intentional cut, viewer-readable.
  if (prev.shotType && next.shotType && prev.shotType !== next.shotType) {
    return { score: 20, reason: 'shot-type-change' }
  }

  // Silent boundary — the cut lands where there's no dialogue on
  // either side. Less bad than mid-dialogue cut.
  const prevHasDialogue = !!dialogueByPanelId.get(prev.id)?.length
  const nextHasDialogue = !!dialogueByPanelId.get(next.id)?.length
  if (!prevHasDialogue || !nextHasDialogue) {
    return { score: 10, reason: 'silent-boundary' }
  }

  // Same-speaker mid-conversation cut. Still acceptable but not
  // preferred. Will be visibly a cut.
  return { score: 0, reason: 'mid-conversation' }
}

/**
 * Build per-panel durations for a chunk so every line has airtime.
 * Conservative: rounds speech estimates up, gives silent panels the
 * default 3s floor.
 */
function buildChunkDurations(
  panels: ReadonlyArray<PanelLike>,
  dialogueByPanelId: ReadonlyMap<string, ReadonlyArray<DialogueLineLike>>,
): { durations: number[]; total: number; speechTotal: number } {
  const durations: number[] = []
  let speechTotal = 0
  for (const p of panels) {
    const lines = dialogueByPanelId.get(p.id)
    const speech = estimatePanelSpeechSeconds(lines)
    speechTotal += speech
    if (speech === 0) {
      durations.push(KLING_OMNI_DEFAULT_PER_SHOT_DURATION)
    } else {
      durations.push(Math.max(KLING_OMNI_DEFAULT_PER_SHOT_DURATION, Math.ceil(speech)))
    }
  }
  let total = durations.reduce((a, b) => a + b, 0)

  // If integer rounding pushed total over the cap, shave silent
  // panels (cheapest to shrink, floor 1s).
  if (total > KLING_OMNI_MAX_TOTAL_DURATION) {
    for (let i = 0; i < panels.length && total > KLING_OMNI_MAX_TOTAL_DURATION; i++) {
      const lines = dialogueByPanelId.get(panels[i].id)
      const isSilent = !lines || lines.length === 0
      if (isSilent && durations[i] > 1) {
        const cut = Math.min(durations[i] - 1, total - KLING_OMNI_MAX_TOTAL_DURATION)
        durations[i] -= cut
        total -= cut
      }
    }
  }

  return { durations, total, speechTotal }
}

/**
 * Returns true iff the candidate panel range fits in a single Kling
 * Omni call.
 */
function chunkFits(
  panels: ReadonlyArray<PanelLike>,
  dialogueByPanelId: ReadonlyMap<string, ReadonlyArray<DialogueLineLike>>,
  targetSeconds: number,
): { fits: boolean; speechTotal: number } {
  if (panels.length === 0) return { fits: false, speechTotal: 0 }
  if (panels.length > KLING_OMNI_MAX_SHOTS) {
    return { fits: false, speechTotal: 0 }
  }
  let speechTotal = 0
  let panelTotal = 0
  for (const p of panels) {
    const lines = dialogueByPanelId.get(p.id)
    const speech = estimatePanelSpeechSeconds(lines)
    speechTotal += speech
    const panelDur =
      speech === 0 ? KLING_OMNI_DEFAULT_PER_SHOT_DURATION : Math.max(KLING_OMNI_DEFAULT_PER_SHOT_DURATION, Math.ceil(speech))
    panelTotal += panelDur
  }
  // Hard limit: must fit Kling's 15s. Soft limit: prefer ≤ targetSeconds
  // for breathing room. The DP scorer prefers under-target chunks; this
  // function only enforces the hard cap.
  return {
    fits: speechTotal <= targetSeconds + 0.5 && panelTotal <= KLING_OMNI_MAX_TOTAL_DURATION,
    speechTotal,
  }
}

export class MultiKlingChunkerError extends Error {
  constructor(
    public readonly code:
      | 'TOO_MANY_PANELS'
      | 'SINGLE_PANEL_OVER_BUDGET'
      | 'EXCEEDS_DISPATCH_LIMIT',
    message: string,
  ) {
    super(message)
    this.name = 'MultiKlingChunkerError'
  }
}

/**
 * Build a split plan for a panel group whose dialogue exceeds the
 * single-call budget. Returns null when the group fits in one call
 * (caller should use the existing single-call path).
 *
 * Algorithm:
 *   - DP over panel boundaries.
 *   - For each i, find best (chunks[1..i]) chunking by trying every
 *     last-chunk-start boundary j ∈ [max(i-MAX_SHOTS, 0), i).
 *   - Score = previous chunking score + cut quality at boundary j.
 *   - Constraint: every chunk must fit (≤15s panel-total AND ≤target
 *     speech AND ≤6 panels).
 *
 * Throws MultiKlingChunkerError when:
 *   - A single panel's dialogue alone > 15s (un-fittable; user must
 *     shorten the line or split the panel).
 *   - The optimal split needs more than MAX_CHUNKS_PER_DISPATCH
 *     chunks (Tencent quota throttle).
 */
export function buildMultiKlingSplitPlan(
  params: BuildSplitPlanParams,
): MultiKlingSplitPlan | null {
  const { panels, dialogueByPanelId } = params
  const targetSeconds = params.targetSeconds ?? CHUNK_TARGET_SECONDS

  if (panels.length === 0) return null

  // Reject impossible inputs early.
  for (let i = 0; i < panels.length; i++) {
    const lines = dialogueByPanelId.get(panels[i].id)
    const speech = estimatePanelSpeechSeconds(lines)
    if (speech > KLING_OMNI_MAX_TOTAL_DURATION) {
      throw new MultiKlingChunkerError(
        'SINGLE_PANEL_OVER_BUDGET',
        `SINGLE_PANEL_OVER_BUDGET: Panel ${i + 1} alone has ${speech.toFixed(1)}s of speech, exceeding Kling Omni's ${KLING_OMNI_MAX_TOTAL_DURATION}s cap. Shorten the dialogue or split the panel.`,
      )
    }
  }

  // If the whole group fits in one call, no plan needed — caller falls
  // through to the existing single-call path.
  const wholeFits = chunkFits(panels, dialogueByPanelId, targetSeconds)
  if (wholeFits.fits) return null

  // DP: bestChunking[i] = optimal way to chunk panels[0..i).
  // Each entry stores the chunking + accumulated score.
  interface DpEntry {
    chunks: MultiKlingChunk[]
    score: number
    cutReasons: string[]
  }
  const speakerCache: DominantSpeakerCache = { byPanel: new Map() }
  const dp: Array<DpEntry | null> = [null] // dp[0] = empty chunking
  // Sentinel "before first panel" is just empty.
  dp[0] = { chunks: [], score: 0, cutReasons: [] }

  for (let i = 1; i <= panels.length; i++) {
    let best: DpEntry | null = null
    // Last chunk covers panels[j..i). j ranges so the chunk is at most
    // KLING_OMNI_MAX_SHOTS panels.
    const minJ = Math.max(0, i - KLING_OMNI_MAX_SHOTS)
    for (let j = minJ; j < i; j++) {
      const slice = panels.slice(j, i)
      const fit = chunkFits(slice, dialogueByPanelId, targetSeconds)
      if (!fit.fits) continue
      const prev = dp[j]
      if (!prev) continue

      const { durations, total, speechTotal } = buildChunkDurations(slice, dialogueByPanelId)
      const chunk: MultiKlingChunk = {
        panels: slice,
        durations,
        totalDuration: total,
        estimatedSpeechSeconds: speechTotal,
      }

      // Score the cut between this chunk and the previous one. The
      // very first chunk has no preceding cut; score 0.
      let cutScore = 0
      let cutReason = 'first-chunk'
      if (j > 0) {
        const c = cutQualityScore(panels[j - 1], panels[j], dialogueByPanelId, speakerCache)
        cutScore = c.score
        cutReason = c.reason
      }
      // Per-chunk cost — discourage adding chunks unless the cut
      // quality earns its keep. Tuned so a location-change cut (+100)
      // beats a fewer-chunks alternative, but speaker-change (+50) only
      // wins when the chunks genuinely don't fit together.
      const PER_CHUNK_COST = 30

      const candidate: DpEntry = {
        chunks: [...prev.chunks, chunk],
        score: prev.score + cutScore - PER_CHUNK_COST,
        cutReasons: j > 0 ? [...prev.cutReasons, cutReason] : prev.cutReasons,
      }

      if (!best || candidate.score > best.score) {
        best = candidate
      }
    }
    dp[i] = best
  }

  const result = dp[panels.length]
  if (!result) {
    // No valid chunking — every attempt ran into the 15s cap. Means
    // somewhere there's a contiguous run that can't be split (no
    // valid cut point). Surface that.
    throw new MultiKlingChunkerError(
      'TOO_MANY_PANELS',
      `TOO_MANY_PANELS: Could not find a valid chunking under Kling Omni's ${KLING_OMNI_MAX_TOTAL_DURATION}s/${KLING_OMNI_MAX_SHOTS}-shot caps. Some panels may need to be split or the dialogue trimmed.`,
    )
  }

  if (result.chunks.length > MAX_CHUNKS_PER_DISPATCH) {
    throw new MultiKlingChunkerError(
      'EXCEEDS_DISPATCH_LIMIT',
      `EXCEEDS_DISPATCH_LIMIT: Dialogue is too long: needs ${result.chunks.length} Kling segments but the per-job limit is ${MAX_CHUNKS_PER_DISPATCH}. Split this panel group into two storyboard rows or shorten the dialogue.`,
    )
  }

  return {
    chunks: result.chunks,
    score: result.score,
    cutReasons: result.cutReasons,
  }
}

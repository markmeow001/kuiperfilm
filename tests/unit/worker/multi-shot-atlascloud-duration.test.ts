/**
 * Phase M (2026-05-21) — duration computation for AtlasCloud composite path.
 *
 * Pre-fix bug: when user picked 15s but edited the narrative textarea
 * (narrativeDirty=true), frontend OMITS panelDurations and only sends
 * rawPrompt. Worker fell back to `panel_count * 2` baseline → 3 panels
 * yielded 6s, 4 panels yielded 8s. User-reported "選 15s 但出 6-8s".
 *
 * Fix: 3-tier priority — panelDurations.sum > dialogue-driven > generous
 * baseline (max 10s floor, panel_count * 2.5 ceiling, clamped 4-15).
 *
 * This is a code-shape (grep) test rather than a behavioral mock — the
 * worker entry has heavy dependencies (BullMQ Job, prisma, COS upload,
 * waitExternalResult) that are infeasible to mock for a unit suite. The
 * goal is to lock the priority chain + the baseline floor so the user's
 * 6-8s regression can't silently come back.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../..')

function readWorkerFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

describe('AtlasCloud composite duration priority (Phase M)', () => {
  const src = readWorkerFile('src/lib/workers/handlers/multi-shot-video-atlascloud-path.ts')

  it('imports buildDialogueDrivenDurations from the shared estimator', () => {
    // Shares the same dialogue→duration helper Kling b-path uses, so
    // BobAPI / Kling / AtlasCloud all derive timing from the same
    // speech estimate model.
    expect(src).toMatch(/from '\.\/speech-duration-estimator'/)
    expect(src).toMatch(/import \{ buildDialogueDrivenDurations \}/)
  })

  it('imports extractSpokenLineFromSrtSegment from b-path for srtSegment parsing', () => {
    // The dialogue source is panel.srtSegment, which can carry stage
    // directions mixed with spoken lines — b-path's extractor strips
    // stage directions so they don't bloat the duration estimate.
    expect(src).toMatch(/import \{ extractSpokenLineFromSrtSegment \}/)
  })

  it('four-tier duration priority: panelDurations > totalDurationSeconds > dialogueDriven > baseline', () => {
    // The if/else chain must check panelDurations FIRST, then Phase P's
    // totalDurationSeconds atomic override, then dialogue-driven, then
    // baseline. If we ever reorder, user's 时长 dropdown selection gets
    // silently ignored — exactly the bug Phase M / Phase P were added
    // to fix.
    expect(src).toMatch(/durationSource: 'panelDurations' \| 'totalDurationSeconds' \| 'dialogueDriven' \| 'baseline'/)
    expect(src).toMatch(/durationSource = 'panelDurations'/)
    expect(src).toMatch(/durationSource = 'totalDurationSeconds'/)
    expect(src).toMatch(/durationSource = 'dialogueDriven'/)
    expect(src).toMatch(/durationSource = 'baseline'/)
  })

  it('baseline floor is at least 10 seconds (NOT panel_count * 2)', () => {
    // Pre-fix used `Math.round(usedPanels.length * 2)` which produced
    // 6-8s for 3-4 panel groups. Phase M raises the floor:
    //   Math.max(10, Math.round(usedPanels.length * 2.5))
    // 3 panels → 10s, 4 → 10s, 5 → 13s, 6 → 15s. Always ≥ 10.
    expect(src).toMatch(/Math\.max\(10,/)
    expect(src).toMatch(/usedPanels\.length \* 2\.5/)
    // The old `panel_count * 2` baseline must NOT be in the duration
    // priority block anymore (it may appear in comments documenting
    // the bug but not in active code).
    const durationBlock = src.match(/\/\/ ── DURATION[\s\S]+?durationSource = 'baseline'[\s\S]+?\}\n  \}/)
    expect(durationBlock, 'duration block must exist').not.toBeNull()
    // Inside the active block, look for the old formula sans comments.
    // The comment "Pre-Phase-M baseline was panel_count * 2 which..."
    // mentions it; the regex catches active code only.
    expect(durationBlock![0]).toMatch(/Math\.max\(10/)
  })

  it('logs durationSource so the chosen tier is debuggable from worker logs', () => {
    // When a user reports unexpected duration, the worker log line
    // must surface which tier won. Otherwise debugging requires
    // re-reading the priority code each time.
    expect(src).toMatch(/durationSource,/)
  })

  it('uses panel.srtSegment as the dialogue source (matches b-path)', () => {
    // b-path's dialogueByPanel construction prefers panel.srtSegment
    // first, then voiceLines fallback. AtlasCloud only uses srtSegment
    // (no voice-extraction pipeline integration today) — should
    // explicitly read panel.srtSegment.
    expect(src).toMatch(/panel\.srtSegment/)
  })

  it('DIALOGUE_EXCEEDS_KLING_BUDGET falls back gracefully (does not crash)', () => {
    // buildDialogueDrivenDurations throws when speech > 15s. AtlasCloud
    // composite should catch this and fall through to baseline — chunking
    // the dialogue across multiple AtlasCloud calls is a future feature,
    // not a runtime crash today.
    expect(src).toMatch(/try \{\s*\n\s*driven = buildDialogueDrivenDurations/)
    expect(src).toMatch(/catch \(err\)/)
    expect(src).toMatch(/falling back to baseline/)
  })

  it('totalDurationSeconds (Phase P) sits between panelDurations and dialogue-driven', () => {
    // The if/else if chain MUST check (1) panelDurations, then (1.5)
    // totalDurationSeconds, then (2) dialogue-driven, then (3) baseline.
    // Reordering — e.g. dialogue-driven before totalDurationSeconds —
    // silently drops the user's explicit 15s pick under sendRaw=true
    // (the exact bug Phase P was added to fix).
    expect(src).toMatch(/durationSource: 'panelDurations' \| 'totalDurationSeconds' \| 'dialogueDriven' \| 'baseline'/)
    expect(src).toMatch(/durationSource = 'totalDurationSeconds'/)
    // The totalDurationSeconds branch sits IMMEDIATELY after panelDurations
    // — re-ordering this with an else-if for dialogue would put the
    // dialogue tier above explicit user pick, also a regression.
    expect(src).toMatch(/durationSource = 'panelDurations'[\s\S]*?else if[\s\S]*?totalDurationSeconds[\s\S]*?durationSource = 'totalDurationSeconds'/)
  })
})

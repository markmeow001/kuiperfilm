/**
 * 2026-06-13 — dialogue-driven default duration for the Seedance + ARK
 * composite paths.
 *
 * Product direction (R2V-first main pipeline): dialogue is the PRIMARY
 * signal for how long a composite should run. fal / atlascloud / Kling
 * b-path already size from each panel's spoken line via the shared
 * speech-duration-estimator; Seedance and ARK were the two stragglers
 * still using the flat `panel_count * 2` baseline even when panels carry
 * dialogue. That made dialogue-heavy groups trail off mid-line.
 *
 * Fix: both paths now run buildDialogueDrivenDurations when the caller
 * didn't pin durations, falling back to the panel-count baseline ONLY
 * for fully-silent groups.
 *
 * Code-shape (grep) test, same rationale as multi-shot-atlascloud-
 * duration.test.ts: the worker entry has heavy deps (BullMQ Job, prisma,
 * COS upload, waitExternalResult) that are infeasible to mock for a unit
 * suite. We lock the priority chain so dialogue can't silently stop
 * driving duration again. The estimator's own math is covered by
 * speech-duration-estimator.test.ts.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../..')

function readWorkerFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

const PATHS: Array<[string, string]> = [
  ['seedance', 'src/lib/workers/handlers/multi-shot-video-seedance-path.ts'],
  ['ark', 'src/lib/workers/handlers/multi-shot-video-ark-path.ts'],
]

describe.each(PATHS)('%s composite duration is dialogue-driven by default', (_name, rel) => {
  const src = readWorkerFile(rel)

  it('imports buildDialogueDrivenDurations from the shared estimator', () => {
    // Same helper Kling b-path / fal / atlascloud use, so every composite
    // path derives timing from one speech model.
    expect(src).toMatch(/from '\.\/speech-duration-estimator'/)
    expect(src).toMatch(/buildDialogueDrivenDurations/)
  })

  it('parses the dialogue source from panel.srtSegment via extractSpokenLineFromSrtSegment', () => {
    // srtSegment can mix stage directions with spoken lines; the b-path
    // extractor strips directions so they don't bloat the estimate.
    expect(src).toMatch(/extractSpokenLineFromSrtSegment\(seg, '旁白'\)/)
    expect(src).toMatch(/const seg = \(panel\.srtSegment \?\? ''\)\.trim\(\)/)
  })

  it('four-tier duration priority: panelDurations > totalDurationSeconds > dialogueDriven > baseline', () => {
    // Order matters: an explicit user pick (panelDurations / Phase P
    // totalDurationSeconds) must win over the dialogue estimate; dialogue
    // must win over the silent baseline.
    expect(src).toMatch(/durationSource: 'panelDurations' \| 'totalDurationSeconds' \| 'dialogueDriven' \| 'baseline'/)
    expect(src).toMatch(/durationSource = 'panelDurations'/)
    expect(src).toMatch(/durationSource = 'totalDurationSeconds'/)
    expect(src).toMatch(/durationSource = 'dialogueDriven'/)
    expect(src).toMatch(/durationSource = 'baseline'/)
    // panelDurations sits first, then totalDurationSeconds — re-ordering
    // would drop the user's explicit pick under sendRaw=true.
    expect(src).toMatch(/durationSource = 'panelDurations'[\s\S]*?else if[\s\S]*?totalDurationSeconds[\s\S]*?durationSource = 'totalDurationSeconds'/)
  })

  it('only falls back to the panel-count baseline for SILENT groups', () => {
    // The baseline must live inside the `else { ... if (driven.hasDialogue)`
    // branch — i.e. it's reached only when no panel has dialogue. The old
    // unconditional `panel_count * 2` baseline must be gone from the
    // top-level priority chain.
    expect(src).toMatch(/if \(driven && driven\.hasDialogue\)/)
    expect(src).toMatch(/durationSource = 'dialogueDriven'\s*\n\s*\} else \{[\s\S]*?usedPanels\.length \* 2[\s\S]*?durationSource = 'baseline'/)
  })

  it('catches DIALOGUE_EXCEEDS_KLING_BUDGET and falls back without crashing', () => {
    expect(src).toMatch(/driven = buildDialogueDrivenDurations\(\{ panels: usedPanels/)
    expect(src).toMatch(/catch \(err\)/)
    expect(src).toMatch(/falling back to baseline/)
  })

  it('logs durationSource so the chosen tier is debuggable from worker logs', () => {
    expect(src).toMatch(/durationSource,/)
  })
})

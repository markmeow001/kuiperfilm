# Plan: Multi-Kling split-and-concat for >15s dialogue groups
**v3 — drop voice pinning (Tencent doesn't expose it for Omni; voice drift accepted)**

**Author**: 2026-05-02
**Status**: Drafted, not approved
**Owner**: B-path video worker
**Related**: `speech-duration-estimator.ts`, `multi-shot-video-b-path.ts`

## Goal

When a multi-shot panel group's dialogue can't fit in Kling Omni's 15s
cap, deliver a single coherent video that preserves every line, sounds
natural, and cuts cleanly between segments — not just a stitched
playable file.

> Quality wins over cost. Token / API spend is secondary; we will pay
> for extra Kling calls, last-frame extraction, and re-encodes if they
> make the cut invisible to the viewer.

## What "best quality" means here

**Priority order (revised v3 after the spike):**

1. **No truncated dialogue** — every line gets its full speech window
   plus natural breathing room. *Non-negotiable.*
2. **Invisible video cuts** — viewer cannot tell where one Kling
   segment ended and the next began. Visual continuity at the splice.
3. **Natural pacing** — no rushed dialogue from cramming text into
   too-short windows. Target leaves breathing room.
4. **Single playback** — user gets one mp4, one play button, one
   timeline. No "play part 1, then part 2" UX.
5. ~~Voice consistency across segments~~ — **DROPPED.** The Tencent
   VOD/VCLM Kling Omni API does not surface a `voice_id` parameter
   (capability matrix at VOD doc §3.9.1 explicitly marks 声音控制 as
   ❌ ❌ for std/pro). We cannot pin voices. We accept the trade-off:
   slight timbre drift between segments is preferable to losing 5 of
   10 dialogue lines because they couldn't fit a single 15s call. If
   Tencent ever exposes voice_id for Omni, we wire it then; the
   schema already has the fields.

## Core design decisions

### 1. Split at natural beats, not greedy 15s fit

Greedy first-fit causes splits mid-line and mid-action — the worst
possible places. Instead, the chunker scores every panel boundary and
picks splits where:

- **Dialogue boundary** — never split inside a single speaker's line.
  Always between lines.
- **Location change** — splits at `panel.location` transitions are
  free quality wins (the cut would be a hard cut anyway).
- **Speaker change** — second-best split point; gives the new chunk a
  fresh "who is talking" reset.
- **Action beat boundary** — between `panel.shotType` changes (close-up
  → wide, etc), since those are intended visual punctuation.

Algorithm: dynamic programming. For each candidate chunking, compute a
quality score:

```
score = -1000 * (chunks with mid-line splits)
      +   100 * (chunks ending on location change)
      +    50 * (chunks ending on speaker change)
      +    20 * (chunks ending on shotType change)
      -    30 * (chunks with > 14s used budget)   # rushed
      -    10 * (chunks with < 6s used budget)    # too short, jarring
      +    15 * (chunks with 2-4 panels)          # cohesive scene
      -   500 * (chunks > 6 panels OR > 15s)      # invalid
```

Pick the chunking with the highest score. O(N²) DP, N≤30 panels in
practice — trivially fast.

### 2. Last-frame seeding for visual continuity

Kling Omni image-to-video accepts a reference image as the first
frame. We exploit this:

- After segment 1 returns, extract its **last frame** via Tencent VOD
  `SnapshotByTimeOffset` (free, sub-second).
- Use that frame as the **first-frame reference** for segment 2.
- Repeat for every subsequent segment.

Result: visual continuity across cuts. The character's pose, the
camera angle, the lighting state at the moment of the cut are all
carried forward. The splice becomes invisible to the viewer.

Trade-off: segments must run sequentially, not in parallel. Wall time
goes from `max(N)` to `sum(N)`. Worth it — perfect cuts beat fast cuts.

### 3. ~~Voice pinning~~ (dropped — Tencent doesn't expose it for Omni)

Kling Omni's TTS can pick different voice timbres on different calls
even when the speaker name is identical. We can't fix this through the
Tencent API today (`voice_id` not exposed for Omni — see priority
list above).

We're accepting the trade-off: every line preserved with mild voice
drift is qualitatively better than half the lines silently dropped.
Schema already has `Character.customVoiceMediaId` / `voiceId` —
when Tencent opens the door for Omni, the wiring is one PR.

The dedicated TTS-and-mux path stays a separate (deferred) plan
alongside lip-sync revival.

### 4. Breathing-room budget — target 12s, cap 15s

Estimator change: target each chunk at **12s used**, leaving a 3s
buffer for:
- 1.5s slack before the line so the actor takes a breath
- 0.5s post-line beat before the cut
- 1.0s safety against estimator under-shoot (long words, emotional
  delivery)

Hard cap stays at 15s (Kling API). When over budget after splitting,
the chunker prefers more chunks of 10s over fewer chunks of 14s. The
latter feels rushed even when it technically fits.

### 5. Optional cross-fade at seams

Tencent VOD `ConcatTask` defaults to hard cut. Hard cuts aren't always
bad — they're the language of cinema — but for **same-scene continued
dialogue** (most over-15s cases) a 0.4s audio crossfade + 0.2s video
dissolve hides the seam.

Apply crossfade IFF:
- The split point is NOT at a location change (location change reads
  cleanly as a hard cut)
- The split point is NOT at a shotType change (intended visual cut)

Otherwise hard cut wins. Tencent VOD `TranscodeTask` with audio
fade-in/out parameters does this — chained after `ConcatTask` in the
same task graph.

### 6. Pre-submit preview

Best UX for a complex auto-decision: show the user what we're about
to do.

When the worker detects a >15s case, **before dispatching Kling
tasks**, write a "split plan" record:

```
{
  segments: [
    { panels: [p1, p2, p3], duration: 11s, dialogue: ["line 1", "line 2"] },
    { panels: [p4, p5],     duration: 9s,  dialogue: ["line 3", "line 4"] },
  ],
  totalDuration: 20s,
  cuts: [{ at: 11s, type: "location-change" }],
}
```

V1: this lives in the task's `metadata` JSON for inspection — no UI
yet, but the data is there.

V2: V2 storyboard renders a "智能分鏡將拆成 2 段（11s + 9s），可調
整分割點" card before commit. User can drag the split points or
override.

V1 + V2 share the same plan format so V1 → V2 is a UI change only.

## Architecture

```
multi-shot-video-handler
  → runMultiShotBPath
    → estimate dialogue total
    → if ≤ 12s: existing single-task path (no change)
    → else:
       1. score-based chunker → SplitPlan
       2. write SplitPlan into task metadata (preview)
       3. submit chunk[0] (Kling Omni)
       4. wait → extract last frame
       5. submit chunk[1] with last-frame as referenceImageUrl
       6. wait → extract last frame → submit chunk[2] …
       7. (parallel for non-continuity chunks at location-change cuts)
       8. ConcatTask(child mp4s) + optional fade-in/out TranscodeTask
       9. return single mp4 url
```

Sequential vs parallel: chunks separated by a **location change** can
go in parallel (visual continuity not required). Same-scene chunks
must go sequentially for last-frame seeding. Chunker emits this
metadata; dispatcher reads it.

## Failure handling — quality-aware

| Failure | Behaviour |
|---|---|
| Chunk N Kling fails | Retry once (existing per-task retry). If second fail, fail whole job — DON'T deliver an incomplete video that drops dialogue silently. |
| Last-frame extraction fails | Fall back to no-seed for next chunk. Log warning so we can audit. The cut will be hard, not invisible — degraded but functional. |
| ConcatTask fails | Retry; if persistent, fail job. Don't deliver loose chunks. |
| User cancels mid-flight | Existing `assertTaskActive` check between phases. Pending Kling submissions cancelled via Tencent API. |

## Implementation breakdown

1. **`speech-duration-estimator.ts`** — keep existing helpers; add
   `chunkPanelsByQuality(panels, dialogueByPanel)`:
   - Returns `SplitPlan` (segments + cut metadata + parallelizable flag)
   - Score-based DP with the heuristics above
   - Unit tests cover: location-change cuts, speaker-change cuts,
     mid-line never split, ≤12s target hold under realistic dialogue.

2. **`generator-api`** — add:
   - `submitTencentConcatTask({ fileIds, fadeMask })` — chains
     ConcatTask + optional TranscodeTask in one ProcessMedia call.
   - `extractLastFrame(fileId)` — wraps SnapshotByTimeOffset at
     `duration - 0.1s`.

3. **`multi-shot-video-b-path.ts`** — branch in `runMultiShotBPath`:
   - Estimate. If single-task path covers it, no change.
   - Else: chunk → write plan to task metadata → run dispatch loop
     (sequential for continuity, parallel where allowed) → extract
     last frame between sequential pairs → concat → return.
   - Inject voice pinning into every speaker's first line per chunk.

4. **`tests/unit/worker/multi-shot-video-b-path-split-concat.test.ts`**
   - Mock Tencent client end-to-end.
   - Verify split plan respects all five quality dimensions.
   - Verify last-frame seeding chains correctly.
   - Verify location-change cuts don't get crossfade.
   - Verify dialogue lines never get truncated.
   - Verify failure modes don't deliver incomplete videos.

5. **Telemetry**: log per chunk `(panelCount, durationUsed, cutType,
   parallelizable, voicePinTokens, lastFrameSeeded)`. After a week of
   prod, audit which heuristics are pulling weight.

6. **Manual quality gate** before flipping default-on:
   - Admin generates 5 known-long-dialogue scenes.
   - Watch each; verify (a) every line audible, (b) no visible cut,
     (c) voice timbre stable per speaker, (d) pacing not rushed.
   - Only then enable for editor+ tier.

## What we're explicitly choosing to do, accepting the cost

- Sequential dispatch for same-scene chunks → longer wall time, but
  invisible cuts. **Accepted.**
- Last-frame snapshot per cut → tiny extra Tencent VOD call. **Accepted.**
- Voice pinning tokens → ~30 extra characters per speaker per chunk
  in the prompt. **Accepted.**
- N × Kling Omni cost → user-visible quota usage. **Accepted.**
- Crossfade re-encode → small Tencent transcoding fee. **Accepted.**

Net: ~3-5x the cost of a single 15s call for a typical 2-chunk split.
Not optimizing. Worth it.

## Open questions to spike before code

1. **Does Kling Omni honour explicit voice descriptors in the prompt
   reliably?** Test with two consecutive calls using the same speaker
   description and compare timbre by ear. If <80% consistent, jump
   straight to (b) — wire `Character.voiceType` through.

2. **Does Tencent VOD ConcatTask preserve audio without re-encoding
   when sources match codec?** If yes, no audio quality loss. If no,
   we need to budget for the re-encode in the latency model.

3. **Is `SnapshotByTimeOffset` synchronous or async?** Affects whether
   step 4 (extract → seed next) needs another poll cycle.

4. **Maximum chunk count Tencent's parallel-task quota allows per
   account?** Need to know before promising "up to N chunks".

I'll spike all four against the doc + a sandbox project before
starting code. ~2 hours.

## Estimate

- Spike (above 4 questions): 2 hours
- Chunker + tests: 4 hours
- Generator-api wrappers + tests: 3 hours
- Worker branch integration + manual smoke: 4 hours
- Quality gate (admin reviews 5 scenes): 2 hours

**Total: ~2 dev-days**, longer than v1 plan because quality wins
several places where v1 took shortcuts. Schedule day 1 spike + chunker,
day 2 integration + quality gate.

## Rollout

1. Behind admin-only flag for 1 day. Watch logs + watch videos.
2. Editor tier for 3 days. Collect manual quality scores.
3. Member tier with quota cap (N ≤ 4 chunks initially) once 95%+ of
   admin/editor outputs pass quality gate.
4. Drop the cap once production data shows N=6 chunks works (~90s of
   dialogue).

# Spike findings — Multi-Kling split-and-concat

**Date**: 2026-05-02
**Status**: Done. Plan v2 needs adjustments based on these findings.
**Companion**: `2026-05-02-multi-kling-split-concat.md`

## Q1: Does Kling Omni honour voice descriptors in the prompt?

### Finding

**Voice ID pinning is NOT available for Kling 3.0-Omni via Tencent VOD.**
The Tencent VOD AIGC 接入指南 §3.10 explicitly says:

> 3.10 可灵指定音色（voice_id）-Kling 2.6
> 备注：Kling **2.6** 仅 **1080P** 分辨率支持指定音色 ID

Kling 3.0 and 3.0-Omni — the models we use — are **not** on that list.
The `<<<voice_id>>>` syntax exists in Kling's API surface but Tencent
has not exposed it for the Omni models. Asked across the doc; no
workaround found.

### Implication for plan

The cross-segment voice consistency strategy in plan v2 (option a:
prompt descriptors like `[陳警官 — 男性低沉嗓音 35 歲]`) becomes the
**only** path, not a first-choice. Option b (voice_id) is blocked
upstream.

**Risk**: descriptor-based pinning is best-effort. Kling Omni's TTS
may still drift between calls. We have to plan for partial drift
rather than guaranteed consistency.

### Mitigations

1. **Standardize the descriptor format**: every speaker on first
   appearance per segment gets `[name — gender, vocal-range, age]`.
   No variation from segment to segment.
2. **Limit segment count**: each additional segment is another roll
   of the timbre dice. Cap at 3 segments default; surface a warning
   above that.
3. **Audit gate before rollout**: admin reviews 10 samples of 2-segment
   and 3-segment outputs by ear. If drift is audible >20% of time,
   block production rollout and pivot to option c (separate TTS path,
   deferred behind lip-sync revival).

## Q2: Does ConcatTask / EditMedia preserve audio without re-encoding?

### Finding

Tencent VOD has TWO concat-style APIs:

- **`ConcatTask` (2017 legacy)** — separate endpoint. Doc says
  explicitly "仅用于对 2017 版接口". We should not use this.
- **`EditMedia` (modern)** — this is the right surface. SDK type
  `EditMediaRequest` accepts `FileInfos: Array<{ FileId,
  StartTimeOffset?, EndTimeOffset? }>` and a `Definition` template:
  - `10`: match highest resolution
  - `20`: match highest bitrate

Async — returns `TaskId`, `Status: PROCESSING|FINISH`. Same poll
pattern as Kling itself, reuses `waitExternalResult`.

### Re-encoding behaviour

The doc does **not** state whether audio is preserved or re-encoded
when sources match codec/resolution. The presence of `Definition: 10`
(resolution-based) and `Definition: 20` (bitrate-based) "templates"
suggests EditMedia normalizes outputs — i.e., it likely re-encodes
even if sources match.

This is the one open item I can't close from docs alone. We have to
**test it in production** by:
1. Running EditMedia on two matching Kling Omni outputs (same 720P
   H.264 / AAC).
2. Comparing output bitrate, audio bit-depth, and codec headers.
3. Listening for compression artifacts vs source.

If re-encoding does happen, the audible quality loss should be small
(VOD's default transcode template is high-quality), but worth
verifying before defaulting on.

### Implication for plan

Plan v2's "ConcatTask" references → switch to `EditMedia` with
`Definition: 10` (resolution-aware). Add a manual production smoke
test as the first step of implementation, before writing chunker code.

### Bonus capability

`EditMediaFileInfo` accepts `StartTimeOffset` / `EndTimeOffset` per
source — if seam quality is poor, we can in-line crossfades by
overlapping segments by 0.4s and using `EditMedia` to pick the right
slices. Cleaner than chained `TranscodeTask`.

## Q3: Is `SnapshotByTimeOffsetTask` synchronous or async?

### Finding

**Async**, returns a TaskId, requires polling. SDK type:

```ts
interface SnapshotByTimeOffsetTaskInput {
  Definition: number  // template ID
  ExtTimeOffsetSet: string[]  // e.g. ["99.9%", "14.9s"]
}
```

Time offsets accept either `s`-suffix seconds or `%`-suffix percentage
of total duration. For "last frame" we'd use `"99.99%"` or compute
`duration - 0.1s` and pass `"X.Xs"`.

Output: `MediaSnapshotByTimeOffsetItem.PicInfoSet[].Url` — direct image
URL we can pass back as Kling Omni's `referenceImageUrls[0]`.

Typical processing time: not in docs, but our existing experience says
~5-10s for a single frame. Plan v2's "extract last frame between
sequential pairs" is correct.

### Implication for plan

Confirmed async — sequential dispatch loop per plan v2 already accounts
for this. Use `"99.99%"` for "near-last-frame" to avoid edge cases
where exact-end frame is the splice (Kling Omni's last frame can
sometimes be a fade-out artifact).

## Q4: How many parallel chunks can our Tencent quota support?

### Finding

Two layers:

- **Our queue**: `QUEUE_CONCURRENCY_VIDEO=2` default (env-tunable).
- **Tencent's per-account quota**: 5 parallel AIGC tasks (per
  `project_kuiperfilm_tencent_concurrency.md` memory). User has asked
  Tencent for raise to 20; not yet granted.

### Implication for plan

If a single user's job splits into N segments and dispatches them
concurrently, that job uses N of the 5 slots. With N=4, only 1 slot
remains for everyone else's jobs. With N=5, the whole platform stalls
waiting for that single user.

**The plan must throttle to keep platform-wide latency healthy.**

Constraints:

- Cap N (segments per job) at **3** by default. Covers ~36s of
  dialogue at 12s/segment target — long enough for 90% of cases per
  the dialogue length distribution we see in the demo project's voice
  lines.
- For dialogue >36s: surface a friendly UI prompt to the user
  ("對白超過 36 秒, 請拆成 2 個分鏡組") before the worker even
  attempts. Don't burn quota on impossible-to-finish jobs.
- Once Tencent raises to 20 slots, lift the cap to 6 segments
  (~72s), gated on `KLING_OMNI_MAX_SHOTS`.

Important: plan v2's "sequential for same-scene continuity" actually
**helps here** — sequential dispatch only uses 1 slot at a time. The
cap of 3 only matters when segments are at location-change cuts and
go in parallel. In practice, most over-15s dialogue is same-scene
(monologue, debate, interrogation), so they go sequential and don't
threaten quota.

## Updated plan summary (deltas from v2)

| Item | v2 | After spike |
|---|---|---|
| Concat API | `ConcatTask` | `EditMedia` (Definition: 10) |
| Voice pinning | option (a) preferred, (b) follow-up | option (a) **only path**; ship audit gate |
| Last-frame extract | `SnapshotByTimeOffset` async | unchanged, use `"99.99%"` |
| Parallel quota | unspecified | cap N=3 default until Tencent raises |
| New manual gate | none | smoke test EditMedia audio quality before code |

## Recommended next steps

1. **First sprint** (today/tomorrow): production smoke test — manually
   submit two Kling Omni outputs through `EditMedia` and inspect
   the result. 30-60 min.
2. **Second sprint**: implement `chunkPanelsByQuality()` + unit tests.
   No external dependencies, pure TS.
3. **Third sprint**: wire `EditMedia` + `SnapshotByTimeOffset` into
   `generator-api`. Smoke test against real Tencent.
4. **Fourth sprint**: integration in `runMultiShotBPath`. Manual
   audit gate (10 sample videos) before flag-on.

Total: still ~2 dev-days from spike to shipped behind admin flag.

## Open after spike (intentionally deferred)

- Kling 2.6 voice_id path: documented but not pursued in v1; revisit
  if 3.0-Omni descriptor pinning fails the audit gate.
- True audio crossfade at seams: depends on EditMedia smoke test
  outcome. If hard cuts are jarring, add `TranscodeTask` chain or
  use `StartTimeOffset` overlap trick from §Q2.
- Per-user quota fairness when one user fills 3 slots: revisit when
  Tencent raises to 20 slots.

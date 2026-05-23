/**
 * Multi-shot text-only tolerance — single source of truth.
 *
 * Some video models accept multi-shot panel groups where one or more
 * panels has no rendered image yet (the worker falls back to project
 * character/scene catalog refs). Others require every panel to have
 * an imageUrl (C-path Kling i2v chains first_frame across panels).
 *
 * This list lived in 3 places before 2026-05-22 — the API route gate
 * (generate-multi-shot-video), the V2 storyboard client's
 * handleSubmitMultiShot filter, and the worker dispatcher. The first
 * two missed `ark::` + `fal::` Seedance 2.0 entries; user got
 * PANELS_MISSING_IMAGE or a disabled button despite the worker
 * supporting both.
 *
 * Rule of thumb: a route is "tolerant" iff its worker path accepts
 * text-only panels (i.e. resolves anchors from char/scene/prop catalog
 * rather than per-panel imageUrl). When adding a new provider, register
 * it here AND ensure the worker dispatcher routes it correctly — the
 * unit test in `tests/unit/video-models/multi-shot-text-only.test.ts`
 * enforces parity with VIDEO_MODEL_VARIANTS so silent regressions
 * surface in CI.
 */

const TOLERATE_TEXT_ONLY_PATTERNS: ReadonlyArray<RegExp> = [
  // Tencent VOD Kling-3 / Kling-O1 → B-path multi_shot=intelligence.
  // SubjectInfos.N carries identity, so panels without imageUrl are fine.
  /^tencent-vod::Kling-(3|O1)/i,

  // BobAPI (taijiai) Seedance 2.0 — content[] @N composite path.
  /^taijiai::seedance-2\.0/i,

  // AtlasCloud Seedance 2.0 (any of t2v / i2v / r2v × std / fast).
  /^atlascloud::seedance-2\.0/i,

  // 2026-05-22 — 火山方舟 ARK direct Seedance 2.0 + 2.0 Fast.
  // multi-shot-video-ark-path composes refs from project catalog.
  /^ark::doubao-seedance-2-0(-fast)?-\d+$/i,

  // 2026-05-22 — fal Seedance 2.0 (i2v / r2v × std / fast).
  // multi-shot-video-fal-path treats first panel image as optional anchor.
  /^fal::bytedance\/seedance-2\.0(?:\/fast)?\/(image|reference)-to-video$/i,
]

/**
 * True when the given videoModel id can submit a multi-shot group with
 * one or more text-only panels (no rendered image yet).
 *
 * Returns false for null/undefined/empty so the gate stays strict by
 * default — when in doubt, require imageUrl.
 */
export function videoModelToleratesTextOnlyPanels(
  videoModel: string | null | undefined,
): boolean {
  if (typeof videoModel !== 'string' || videoModel.length === 0) return false
  for (const pattern of TOLERATE_TEXT_ONLY_PATTERNS) {
    if (pattern.test(videoModel)) return true
  }
  return false
}

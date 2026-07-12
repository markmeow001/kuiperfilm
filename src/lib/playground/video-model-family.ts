/**
 * Video-model UI family classifier (2026-07-12 adaptive left column).
 *
 * The Video studio renders a different parameter module set per family
 * (Higgsfield-style): kling-o3 binds subjects via the Elements modal,
 * seedance-class takes a unified media card with @-order references,
 * everything else gets start/end frame slots. Pure string classification
 * on the full modelKey (provider::modelId) — no capability lookup, so it
 * stays render-safe.
 */

export type VideoModelFamily = 'kling-o3' | 'seedance' | 'frames'

export function videoModelFamily(modelKey: string): VideoModelFamily {
  if (/::kling-o3-/.test(modelKey)) return 'kling-o3'
  // AtlasCloud seedance/wan line + fal bytedance seedance line share the
  // multi-ref "@image N" referencing convention.
  if (/^atlascloud::(seedance|wan)-/.test(modelKey)) return 'seedance'
  if (/^fal::bytedance\/seedance-/.test(modelKey)) return 'seedance'
  return 'frames'
}

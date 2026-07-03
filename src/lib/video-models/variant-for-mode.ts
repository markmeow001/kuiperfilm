/**
 * Map a video generation MODE to the right model VARIANT.
 *
 * Seedance-class lines register t2v / i2v / r2v as sibling variant ids that
 * differ only in suffix (e.g. atlascloud::seedance-2.0-i2v). The endpoint —
 * not a request flag — decides what a leading image MEANS:
 *   t2v: images ignored · i2v: image = FIRST FRAME · r2v: images = style/identity refs
 *
 * Users repeatedly hit this: picking the r2v variant and expecting first-frame
 * behavior ("参考图只吃样式不当首帧", 2026-07-02). The pickers now express
 * intent as a mode, and this helper swaps to the sibling variant that
 * implements it — only when that sibling is actually in the user's enabled
 * list, otherwise the original key is kept (the caller may show a hint).
 */
export type VideoRefMode = 'text' | 'image' | 'omni' | 'firstlast'

const SUFFIX_BY_MODE: Record<VideoRefMode, 't2v' | 'i2v' | 'r2v'> = {
  text: 't2v',
  image: 'i2v',
  // 首尾帧 anchors a first frame too — i2v is the frame-anchored endpoint.
  firstlast: 'i2v',
  omni: 'r2v',
}

const VARIANT_SUFFIX_RE = /^(.*-)(t2v|i2v|r2v)$/

/**
 * Returns the sibling variant key matching `mode`, or `modelKey` unchanged
 * when the key has no t2v/i2v/r2v suffix (non-variant models: fal flat i2v,
 * Kling, …) or the sibling isn't in `availableKeys`.
 */
export function variantKeyForMode(
  modelKey: string,
  mode: VideoRefMode,
  availableKeys: readonly string[],
): string {
  const m = modelKey.match(VARIANT_SUFFIX_RE)
  if (!m) return modelKey
  const want = SUFFIX_BY_MODE[mode]
  if (m[2] === want) return modelKey
  const target = `${m[1]}${want}`
  return availableKeys.includes(target) ? target : modelKey
}

/** True when `modelKey` belongs to a t2v/i2v/r2v variant line. */
export function isVariantSuffixedKey(modelKey: string): boolean {
  return VARIANT_SUFFIX_RE.test(modelKey)
}

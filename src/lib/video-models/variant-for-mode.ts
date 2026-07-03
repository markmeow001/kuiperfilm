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

const SEGMENT_BY_MODE: Record<VideoRefMode, 'text-to-video' | 'image-to-video' | 'reference-to-video'> = {
  text: 'text-to-video',
  image: 'image-to-video',
  firstlast: 'image-to-video',
  omni: 'reference-to-video',
}

// Two id conventions carry the variant:
//   dash style  (AtlasCloud presets):  atlascloud::seedance-2.0-r2v
//   slug style  (fal presets):         fal::bytedance/seedance-2.0/reference-to-video
const DASH_VARIANT_RE = /^(.*-)(t2v|i2v|r2v)$/
const SLUG_VARIANT_RE = /^(.*\/)(text-to-video|image-to-video|reference-to-video)$/

/**
 * Returns the sibling variant key matching `mode`, or `modelKey` unchanged
 * when the key carries no variant marker (flat i2v models, Kling, …) or the
 * sibling isn't in `availableKeys`.
 */
export function variantKeyForMode(
  modelKey: string,
  mode: VideoRefMode,
  availableKeys: readonly string[],
): string {
  const dash = modelKey.match(DASH_VARIANT_RE)
  if (dash) {
    const want = SUFFIX_BY_MODE[mode]
    if (dash[2] === want) return modelKey
    const target = `${dash[1]}${want}`
    return availableKeys.includes(target) ? target : modelKey
  }
  const slug = modelKey.match(SLUG_VARIANT_RE)
  if (slug) {
    const want = SEGMENT_BY_MODE[mode]
    if (slug[2] === want) return modelKey
    const target = `${slug[1]}${want}`
    return availableKeys.includes(target) ? target : modelKey
  }
  return modelKey
}

/** True when `modelKey` belongs to a t2v/i2v/r2v variant line (either style). */
export function isVariantSuffixedKey(modelKey: string): boolean {
  return DASH_VARIANT_RE.test(modelKey) || SLUG_VARIANT_RE.test(modelKey)
}

/** True when `modelKey` is a variant key that does NOT implement `mode` —
 *  i.e. the UI should warn that the matching sibling isn't enabled. */
export function variantModeMismatch(modelKey: string, mode: VideoRefMode): boolean {
  const dash = modelKey.match(DASH_VARIANT_RE)
  if (dash) return dash[2] !== SUFFIX_BY_MODE[mode]
  const slug = modelKey.match(SLUG_VARIANT_RE)
  if (slug) return slug[2] !== SEGMENT_BY_MODE[mode]
  return false
}

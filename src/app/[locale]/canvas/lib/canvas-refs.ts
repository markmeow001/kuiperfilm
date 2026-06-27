/**
 * Pure selector: from a media node's upstream-connected nodes, pick the
 * reference image URLs to feed the generator.
 *
 * i2v chaining mechanism: the Playground video worker treats signedImageUrls[0]
 * as the first frame (leadImageUrl) and passes http URLs through untouched
 * (toSignedUrlIfCos only signs bare COS keys). So a connected image/character
 * node's result URL becomes the video's first frame with zero backend change.
 * For an image node the same URLs act as edit/consistency references.
 *
 * Only image & character nodes contribute (they hold a frame); text/video
 * upstreams are ignored. Order follows connection order so the user controls
 * which frame leads by wiring order.
 */

const REF_BEARING_TYPES = new Set(['image', 'character'])

export interface UpstreamNodeLike {
  type?: string | null
  data?: { resultUrl?: string | null } | Record<string, unknown> | null
}

export function pickUpstreamReferenceUrls(
  upstream: ReadonlyArray<UpstreamNodeLike | null | undefined>,
): string[] {
  const out: string[] = []
  for (const n of upstream) {
    if (!n || !n.type || !REF_BEARING_TYPES.has(n.type)) continue
    const url = (n.data as { resultUrl?: unknown } | null | undefined)?.resultUrl
    if (typeof url === 'string' && url.length > 0) out.push(url)
  }
  return out
}

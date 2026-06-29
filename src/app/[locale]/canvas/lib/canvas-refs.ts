/**
 * Pure selector: from a media node's upstream-connected nodes, pick the
 * reference image URLs to feed the generator.
 *
 * i2v chaining mechanism: the Playground video worker treats signedImageUrls[0]
 * as the first frame (leadImageUrl). toSignedUrlIfCos signs bare COS keys
 * (images/|voice/|video/ prefix) and passes http URLs through untouched. So we
 * prefer a node's durable `referenceKey` (a bare COS key the worker re-signs
 * fresh — survives signed-URL expiry) and fall back to `resultUrl` (a signed
 * URL, fine within a session) for run-result nodes that don't expose a key.
 *
 * Only image/character/director nodes contribute (they hold a frame);
 * text/video upstreams are ignored. Order follows connection order so the user
 * controls which frame leads by wiring order.
 */

const REF_BEARING_TYPES = new Set(['image', 'character', 'director'])

export interface UpstreamNodeLike {
  id?: string
  type?: string | null
  data?: { resultUrl?: string | null; referenceKey?: string | null } | Record<string, unknown> | null
}

/**
 * Collect text from upstream 文本/脚本 nodes feeding a generative node — the
 * script that drives this shot. Returns the joined prompt fragments in
 * connection order so a 文本 node wired into an image/video node contributes its
 * content to that node's generation (script → 分镜 → 生成 chain).
 */
export function pickUpstreamText(
  upstream: ReadonlyArray<UpstreamNodeLike | null | undefined>,
): string {
  const out: string[] = []
  for (const n of upstream) {
    if (!n || n.type !== 'text') continue
    const prompt = (n.data as { prompt?: unknown } | null | undefined)?.prompt
    if (typeof prompt === 'string' && prompt.trim()) out.push(prompt.trim())
  }
  return out.join('\n')
}

export function pickUpstreamReferenceUrls(
  upstream: ReadonlyArray<UpstreamNodeLike | null | undefined>,
  selfId?: string,
): string[] {
  const out: string[] = []
  for (const n of upstream) {
    if (!n || !n.type || !REF_BEARING_TYPES.has(n.type)) continue
    if (selfId && n.id === selfId) continue // never feed a node its own output (self-loop)
    const data = n.data as { resultUrl?: unknown; referenceKey?: unknown } | null | undefined
    const key = data?.referenceKey
    const url = data?.resultUrl
    // Prefer the durable key (re-signed by the worker); fall back to the URL.
    if (typeof key === 'string' && key.length > 0) out.push(key)
    else if (typeof url === 'string' && url.length > 0) out.push(url)
  }
  return out
}

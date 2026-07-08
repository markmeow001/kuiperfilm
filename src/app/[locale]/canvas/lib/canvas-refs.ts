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
 * Contributions by node type:
 *  - image/character/director → referenceKey / resultUrl (they hold a frame)
 *  - video → tailFrameUrl(生成结果的尾帧,worker 用 ffmpeg 抽出) — 让
 *    「上一镜视频 → 下一镜」连线成为真正的首尾帧接力(续镜链)。没有
 *    tailFrameUrl 的视频节点(旧结果/抽帧失败)不贡献,静默跳过。
 *  - text upstreams are ignored (they feed prompts, not frames).
 * Order follows connection order so the user controls which frame leads by
 * wiring order.
 */

const REF_BEARING_TYPES = new Set(['image', 'character', 'director'])

export interface UpstreamNodeLike {
  id?: string
  type?: string | null
  data?: { resultUrl?: string | null; referenceKey?: string | null; tailFrameUrl?: string | null } | Record<string, unknown> | null
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
    if (!n || !n.type) continue
    if (selfId && n.id === selfId) continue // never feed a node its own output (self-loop)
    // 视频上游 → 尾帧接力:贡献 worker 抽出的尾帧(签名/公开 URL,直接过
    // reference-guard 的 https 白名单)。
    if (n.type === 'video') {
      const tail = (n.data as { tailFrameUrl?: unknown } | null | undefined)?.tailFrameUrl
      if (typeof tail === 'string' && tail.length > 0) out.push(tail)
      continue
    }
    if (!REF_BEARING_TYPES.has(n.type)) continue
    const data = n.data as { resultUrl?: unknown; referenceKey?: unknown } | null | undefined
    const key = data?.referenceKey
    const url = data?.resultUrl
    // Prefer the durable key (re-signed by the worker); fall back to the URL.
    if (typeof key === 'string' && key.length > 0) out.push(key)
    else if (typeof url === 'string' && url.length > 0) out.push(url)
  }
  return out
}

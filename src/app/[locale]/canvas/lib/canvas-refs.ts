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
 *  - image/character/scene/prop/director → referenceKey / resultUrl (they hold a frame)
 *  - script → data.refUrls(脚本节点把 上游参考节点 + 全部资产设定图 缓存在
 *    自己的 data 上;铺出的镜头节点只连 脚本→镜头 一条线。注意语义差异:
 *    批量提交用的是「该镜出场资产」的精准参考(shotReferenceKeys),relay 给
 *    单镜重生的则是全卡司 — 重生输入比初次生成宽,是已知且刻意的折衷,
 *    换掉 N×M 蜘蛛网连线)。
 *  - video → tailFrameUrl(生成结果的尾帧,worker 用 ffmpeg 抽出) — 让
 *    「上一镜视频 → 下一镜」连线成为真正的首尾帧接力(续镜链)。没有
 *    tailFrameUrl 的视频节点(旧结果/抽帧失败)不贡献,静默跳过。
 *  - text upstreams are ignored (they feed prompts, not frames).
 * Order follows connection order so the user controls which frame leads by
 * wiring order.
 */

const REF_BEARING_TYPES = new Set(['image', 'character', 'scene', 'prop', 'director'])

export interface UpstreamNodeLike {
  id?: string
  type?: string | null
  data?: { resultUrl?: string | null; referenceKey?: string | null; tailFrameUrl?: string | null; prompt?: string | null; shots?: Array<{ description?: string; dialogue?: string }> | null } | Record<string, unknown> | null
}

/**
 * Collect text from upstream 文本/脚本 nodes feeding a generative node — the
 * script that drives this shot. Returns the joined prompt fragments in
 * connection order so a 文本 node wired into an image/video node contributes its
 * content to that node's generation (script → 分镜 → 生成 chain).
 */
export function pickUpstreamText(
  upstream: ReadonlyArray<UpstreamNodeLike | null | undefined>,
  options?: {
    /**
     * false = script 上游不贡献分镜文字。生成节点（MediaNode）必须传 false：
     * 铺出的镜头节点自带完整 finalPrompt，若再把整份分镜表倾倒进 basePrompt，
     * 每次单镜重生都会被全剧文本稀释（2026-08-20 review #12）。音频节点保留
     * 默认 true——script→audio 的对白文字是设计行为。
     */
    includeScriptShots?: boolean
  },
): string {
  const includeScriptShots = options?.includeScriptShots ?? true
  const out: string[] = []
  for (const n of upstream) {
    if (!n || (n.type !== 'text' && n.type !== 'script')) continue
    if (n.type === 'script' && !includeScriptShots) continue
    const data = n.data as { prompt?: unknown; shots?: unknown } | null | undefined
    if (n.type === 'script' && Array.isArray(data?.shots) && data.shots.length > 0) {
      const shotText = data.shots
        .map((shot) => {
          if (!shot || typeof shot !== 'object') return ''
          const value = shot as { description?: unknown; dialogue?: unknown }
          return [value.description, value.dialogue].filter((part): part is string => typeof part === 'string' && Boolean(part.trim())).join('；')
        })
        .filter(Boolean)
        .join('\n')
      if (shotText) out.push(shotText)
      continue
    }
    const prompt = data?.prompt
    if (typeof prompt === 'string' && prompt.trim()) out.push(prompt.trim())
  }
  return out.join('\n')
}

/** Frame-bearing upstreams in connection order. Characters are identity refs,
 * not blocking frames, so they must never accidentally become an I2V first or
 * last frame. */
export function pickUpstreamFrameUrls(
  upstream: ReadonlyArray<UpstreamNodeLike | null | undefined>,
): string[] {
  const out: string[] = []
  for (const node of upstream) {
    if (!node) continue
    const data = node.data as { resultUrl?: unknown; referenceKey?: unknown; tailFrameUrl?: unknown } | null | undefined
    if (node.type === 'video') {
      if (typeof data?.tailFrameUrl === 'string' && data.tailFrameUrl) out.push(data.tailFrameUrl)
      continue
    }
    if (node.type !== 'image') continue
    if (typeof data?.referenceKey === 'string' && data.referenceKey) out.push(data.referenceKey)
    else if (typeof data?.resultUrl === 'string' && data.resultUrl) out.push(data.resultUrl)
  }
  return out
}

/**
 * 首尾帧模式的帧来源解析（纯函数，行为测试覆盖）：
 * - 首帧：本节点参考图（anchorKey）优先，否则第 1 条连线的帧
 * - 尾帧：显式上传（lastFrameKey）优先；有 anchor 时第 1 条连线当尾帧，
 *   否则第 2 条连线
 * upstreamFrames 的顺序 = 连线建立顺序（不是画面位置）——UI 必须把这点
 * 标示给用户（MediaNode 首尾帧区）。
 */
export function resolveFirstLastFrames(opts: {
  anchorKey?: string | null
  lastFrameKey?: string | null
  upstreamFrames: readonly string[]
}): { firstFrame: string | null; lastFrame: string | null } {
  const firstFrame = opts.anchorKey ?? opts.upstreamFrames[0] ?? null
  const lastFrame = opts.lastFrameKey ?? (opts.anchorKey ? opts.upstreamFrames[0] : opts.upstreamFrames[1]) ?? null
  return { firstFrame, lastFrame }
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
    // Script upstream relays the refs bound to IT (角色/场景/道具→脚本→镜头)。
    if (n.type === 'script') {
      const refUrls = (n.data as { refUrls?: unknown } | null | undefined)?.refUrls
      if (Array.isArray(refUrls)) {
        for (const ref of refUrls) {
          if (typeof ref === 'string' && ref.length > 0) out.push(ref)
        }
      }
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

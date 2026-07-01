/**
 * LibTV-derived design tokens for the infinite-canvas region.
 *
 * Source: ~/canvas_ref/libtv-uiux-spec.md (agent audit of liblib.tv, 2026-06-27).
 * Near-black, low-chroma, single cyan accent. Kept as a typed constant object so
 * node components and the canvas shell stay visually consistent without copying
 * hex strings around (immutable single source — see coding-style 鐵則).
 *
 * NOTE: these are canvas-local on purpose. The rest of KuiperAI V2 uses the
 * amber/stone palette; the canvas is a deliberately distinct "studio" surface.
 */
export const CANVAS_TOKENS = {
  bg: {
    canvas: '#0A0A0B',
    app: '#0E0E10',
    panel: '#131316',
    popover: '#16161A',
    card: '#1B1B1F',
    hover: '#232328',
    input: '#202024',
  },
  accent: '#4FD2E8', // cyan — CTA / slider fill / selected ring / primary action
  gold: '#F4C44E', // credits / membership only
  sceneBlue: '#4F8EF7', // 3D 人偶 / gizmo only (M2)
  text: {
    primary: '#F2F2F4',
    secondary: '#A8A8B0',
    muted: '#6E6E76',
  },
  hairline: 'rgba(255,255,255,0.08)',
  radius: { sm: 6, md: 10, lg: 14, xl: 20 },
  grid: 24, // dot-grid spacing
} as const

/** Per-node-type accent + label metadata. */
export type CanvasNodeType = 'character' | 'image' | 'video' | 'text' | 'director' | 'script' | 'audio'

export const NODE_META: Record<
  CanvasNodeType,
  { label: string; accent: string; hint: string }
> = {
  character: { label: '角色', accent: '#C8A2FF', hint: '绑参考图 / 角色库' },
  image: { label: '图片', accent: CANVAS_TOKENS.accent, hint: '文字生图 / 编辑' },
  video: { label: '视频', accent: '#7BE3A4', hint: '首帧图 → 短片' },
  text: { label: '文本', accent: CANVAS_TOKENS.text.secondary, hint: '脚本 / 提示词' },
  director: { label: '导演台', accent: '#4F8EF7', hint: '3D 站位 → 参考图' },
  script: { label: '脚本', accent: '#F7B84F', hint: '剧本 → 分镜 → 批量生图' },
  audio: { label: '音频', accent: '#F78FD2', hint: '文字 + 参考音 → 克隆配音' },
}

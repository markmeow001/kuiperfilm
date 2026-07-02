/**
 * LibTV-derived design tokens for the infinite-canvas region.
 *
 * Source: ~/canvas_ref/libtv-full-clone-spec-2026-07-01.md — getComputedStyle
 * MEASURED values from liblib.tv (2026-07-01 re-audit). These replace the
 * 2026-06-27 estimated palette (near-black + cyan): the real LibTV surface is
 * a warmer #141414/#262626 gray ramp with a blue #1880FF accent, neutral gray
 * edges, and a white generate CTA. Kept as a typed constant object so node
 * components and the canvas shell stay visually consistent without copying
 * hex strings around (immutable single source — see coding-style 鐵則).
 *
 * NOTE: these are canvas-local on purpose. The rest of KuiperAI V2 uses the
 * amber/stone palette; the canvas is a deliberately distinct "studio" surface.
 */
export const CANVAS_TOKENS = {
  bg: {
    canvas: '#141414',
    app: '#1B1B1B',
    panel: '#262626',
    popover: '#1A1A1A',
    card: '#262626',
    hover: 'rgba(255,255,255,0.10)',
    active: 'rgba(255,255,255,0.15)',
    input: '#1B1B1B',
  },
  accent: '#1880FF', // brand blue — links / slider fill / primary emphasis
  accentText: '#FFFFFF', // text on accent surfaces
  cta: '#FFFFFF', // generate ↑ button — white pill, dark glyph
  ctaText: '#141414',
  gold: '#F4C44E', // credits / membership only
  sceneBlue: '#4F8EF7', // 3D 人偶 / gizmo only (M2)
  text: {
    primary: '#F7F7F7',
    secondary: '#919191',
    muted: '#6E6E76',
  },
  hairline: '#363636', // 0.5–1px borders on cards / dock / top-bar capsules
  selectedRing: '#A8A8A8', // selected node = inset 2px ring
  edge: {
    idle: '#86909C',
    lit: '#C0C8D0', // selected/adjacent/working edges
  },
  shadow: '0 4px 10px rgba(0,0,0,0.12)', // node card
  shadowPopover: '0 16px 40px rgba(0,0,0,0.55)',
  radius: { sm: 6, md: 8, lg: 12, xl: 16 },
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

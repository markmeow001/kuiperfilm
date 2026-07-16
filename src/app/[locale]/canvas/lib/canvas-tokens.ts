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
 * Canvas-local tokens mapped to the Kuiper V2 product language: near-black
 * surfaces, magenta creation actions, violet AI tools, and restrained gold
 * output accents.
 */
export const CANVAS_TOKENS = {
  bg: {
    canvas: '#08070B',
    app: '#100E15',
    panel: '#15121C',
    popover: '#191521',
    card: '#1B1723',
    hover: 'rgba(255,255,255,0.07)',
    active: 'rgba(216,70,239,0.16)',
    input: '#0F0D13',
  },
  accent: '#E052E8',
  accentSoft: 'rgba(224,82,232,0.14)',
  accentText: '#FFFFFF', // text on accent surfaces
  cta: '#FFFFFF', // generate ↑ button — white pill, dark glyph
  ctaText: '#100E15',
  gold: '#E9B95B',
  sceneBlue: '#8D76FF',
  text: {
    primary: '#F7F7F7',
    secondary: '#B5ADBE',
    muted: '#7C7385',
  },
  hairline: '#30293A',
  selectedRing: '#E052E8',
  edge: {
    idle: '#665D70',
    lit: '#E052E8',
  },
  shadow: '0 8px 24px rgba(0,0,0,0.28)',
  shadowPopover: '0 24px 60px rgba(0,0,0,0.58)',
  radius: { sm: 6, md: 8, lg: 12, xl: 16 },
  grid: 24, // dot-grid spacing
} as const

/** Per-node-type accent + label metadata. */
export type CanvasNodeType = 'character' | 'image' | 'video' | 'text' | 'director' | 'script' | 'audio' | 'composition' | 'group'

export const NODE_META: Record<
  CanvasNodeType,
  { label: string; accent: string; hint: string }
> = {
  character: { label: '角色', accent: '#C8A2FF', hint: '绑参考图 / 角色库' },
  image: { label: '图片', accent: CANVAS_TOKENS.accent, hint: '文字生图 / 编辑' },
  video: { label: '视频', accent: '#7BE3A4', hint: '首帧图 → 短片' },
  text: { label: '文本', accent: CANVAS_TOKENS.text.secondary, hint: '脚本 / 提示词' },
  director: { label: '导演台', accent: '#8D76FF', hint: '3D 站位 → 参考图' },
  script: { label: '脚本', accent: '#E9B95B', hint: '剧本 → 分镜 → 批量生图' },
  audio: { label: '音频', accent: '#F78FD2', hint: '文字 + 参考音 → 克隆配音' },
  composition: { label: '视频合成', accent: '#55D6A8', hint: '片段排序 → 成片' },
  // Container only — never offered in add menus (ADD_ORDER excludes it);
  // created via G 成组 on a multi-selection.
  group: { label: '分组', accent: CANVAS_TOKENS.text.muted, hint: '' },
}

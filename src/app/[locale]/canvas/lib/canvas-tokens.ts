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
 * Canvas-local tokens mapped to the Kuiper production darkroom. Node-type
 * accents remain meaningful status markers, while shell actions, selection
 * and active edges use the shared process cyan language.
 */
export const CANVAS_TOKENS = {
  bg: {
    canvas: '#070B0F',
    app: '#0D141B',
    panel: '#111B24',
    popover: '#17232D',
    card: '#111B24',
    hover: 'rgba(255,255,255,0.07)',
    active: 'rgba(85,175,192,0.16)',
    input: '#0D141B',
  },
  accent: '#55AFC0',
  accentSoft: 'rgba(85,175,192,0.14)',
  accentText: '#FFFFFF', // text on accent surfaces
  cta: '#55AFC0',
  ctaText: '#071014',
  gold: '#E9B95B',
  sceneBlue: '#8D76FF',
  text: {
    primary: '#F2F6F7',
    secondary: '#A7B3BC',
    muted: '#7F9099',
  },
  hairline: '#263642',
  selectedRing: '#55AFC0',
  edge: {
    idle: '#4B6271',
    lit: '#55AFC0',
  },
  shadow: '0 8px 24px rgba(0,0,0,0.28)',
  shadowPopover: '0 24px 60px rgba(0,0,0,0.58)',
  radius: { sm: 6, md: 8, lg: 12, xl: 16 },
  grid: 24, // dot-grid spacing
} as const

/** Per-node-type accent + label metadata. */
export type CanvasNodeType = 'character' | 'image' | 'video' | 'text' | 'director' | 'script' | 'audio' | 'composition' | 'mask' | 'group'

export const NODE_META: Record<
  CanvasNodeType,
  { label: string; accent: string; hint: string }
> = {
  character: { label: '角色', accent: '#C8A2FF', hint: '綁定參考圖／角色庫' },
  image: { label: '圖片', accent: CANVAS_TOKENS.accent, hint: '文字生圖／編輯' },
  video: { label: '影片', accent: '#7BE3A4', hint: '首幀圖 → 短片' },
  text: { label: '文字', accent: CANVAS_TOKENS.text.secondary, hint: '腳本／提示詞' },
  director: { label: '導演台', accent: '#8D76FF', hint: '3D 站位 → 參考圖' },
  script: { label: '腳本', accent: '#E9B95B', hint: '劇本 → 分鏡 → 批次生圖' },
  audio: { label: '音訊', accent: '#F78FD2', hint: '文字＋參考音 → 複製配音' },
  composition: { label: '影片合成', accent: '#55D6A8', hint: '片段排序 → 成片' },
  mask: { label: '遮罩', accent: '#FF58C5', hint: '圈選背景／修補範圍' },
  // Container only — never offered in add menus (ADD_ORDER excludes it);
  // created via G 成组 on a multi-selection.
  group: { label: '群組', accent: CANVAS_TOKENS.text.muted, hint: '' },
}

/**
 * Per-project video generation mode (2026-05-29).
 *
 * KuiperAI supports two distinct creation flows now that Kling is no longer
 * the primary video model:
 *
 *   - 'r2v-narrative'  — text → AI grouping → Seedance R2V, NO text-to-image
 *                        step. One rich `description` artifact drives the
 *                        narrative + the model. Faster, simpler. DEFAULT.
 *   - 't2i-storyboard' — legacy 文生圖分鏡 → 圖生視頻. Per-shot first-frame
 *                        images, gallery card view, FrameLock, i2v models.
 *                        Kept for users who want per-shot image control.
 *
 * `resolveGenerationModeBehavior()` is the SINGLE SOURCE OF TRUTH — every
 * downstream consumer (analyze cascade, storyboard default view, video-model
 * picker filter, FrameLock visibility, auto-chain) reads it here rather than
 * scattering `mode === ...` checks. Unknown/null defaults to r2v-narrative.
 */

// Type-only Prisma import: this module is bundled into client components,
// a value import of @prisma/client here would leak the server client
// into the browser bundle.
import type { PanelGenerationMode } from '@prisma/client'

export const GENERATION_MODES = ['r2v-narrative', 't2i-storyboard'] as const
export type GenerationMode = (typeof GENERATION_MODES)[number]

// ── Phase 1.5C — per-PANEL generation mode (REDESIGN_PLAN §1.5) ──

/**
 * Literal mirror of the Prisma PanelGenerationMode enum. The `satisfies`
 * check makes tsc fail if this list ever drifts from the schema.
 */
export const PANEL_GENERATION_MODES = [
  'direct_t2v',
  'r2v_with_subjects',
  't2i_then_i2v',
  'r2v_with_motion_ref',
] as const satisfies readonly PanelGenerationMode[]

export function isPanelGenerationMode(value: unknown): value is PanelGenerationMode {
  return typeof value === 'string'
    && (PANEL_GENERATION_MODES as readonly string[]).includes(value)
}

/**
 * The panelGenerationMode to stamp on a NEWLY created panel.
 *
 * Priority:
 *   1. sourcePanelMode — duplicating / making a variant of an existing
 *      panel inherits its mode (legacy panels carry direct_t2v from the
 *      DB default and stay on the legacy path).
 *   2. project generationMode mapping:
 *        'r2v-narrative' (default) → 'r2v_with_subjects'
 *        't2i-storyboard'          → 't2i_then_i2v'
 *
 * The DB default stays direct_t2v on purpose (legacy rows must not flip
 * — see the 1.5A contract test); the R2V-first default for new panels
 * lives HERE, at the creation sites.
 */
export function defaultPanelGenerationMode(args: {
  projectGenerationMode?: string | null
  sourcePanelMode?: string | null
}): PanelGenerationMode {
  if (isPanelGenerationMode(args.sourcePanelMode)) return args.sourcePanelMode
  return normalizeGenerationMode(args.projectGenerationMode) === 't2i-storyboard'
    ? 't2i_then_i2v'
    : 'r2v_with_subjects'
}

export const OPENING_PACINGS = ['hook', 'cinematic'] as const
export type OpeningPacing = (typeof OPENING_PACINGS)[number]

export interface GenerationModeBehavior {
  /** Fire the post-analysis IMAGE_PANEL cascade (T2I) — false for R2V. */
  cascadeImageGen: boolean
  /** Auto-run group + narrative reseed after analyze completes (R2V only). */
  autoChainAfterAnalyze: boolean
  /** Show the Kling-3.0 i2v pixel-lock (FrameLock) affordance. */
  showFrameLock: boolean
  /** Which storyboard view to default to. */
  defaultStoryboardView: 'multishot' | 'gallery'
  /** Video-model picker scope. */
  videoModelFilter: 'seedance-only' | 'all'
}

export function resolveGenerationModeBehavior(
  mode: GenerationMode | string | null | undefined,
): GenerationModeBehavior {
  if (mode === 't2i-storyboard') {
    return {
      cascadeImageGen: true,
      autoChainAfterAnalyze: false,
      showFrameLock: true,
      defaultStoryboardView: 'gallery',
      videoModelFilter: 'all',
    }
  }
  // r2v-narrative — default for null / undefined / unknown values so a missing
  // column never silently re-enables the heavier T2I flow.
  return {
    cascadeImageGen: false,
    autoChainAfterAnalyze: true,
    showFrameLock: false,
    defaultStoryboardView: 'multishot',
    videoModelFilter: 'seedance-only',
  }
}

/** Narrow an arbitrary string to a valid GenerationMode (else default). */
export function normalizeGenerationMode(value: string | null | undefined): GenerationMode {
  return value === 't2i-storyboard' ? 't2i-storyboard' : 'r2v-narrative'
}

/** Narrow an arbitrary string to a valid OpeningPacing (else default). */
export function normalizeOpeningPacing(value: string | null | undefined): OpeningPacing {
  return value === 'cinematic' ? 'cinematic' : 'hook'
}

/**
 * The directive injected into the storyboard PLAN prompt's
 * `{opening_pacing_directive}` placeholder. Controls whether the opening of
 * each scene gets its own atmospheric establishing group (cinematic) or rushes
 * into the conflict (hook — the short-drama default). Normalizes unknown input.
 */
export function openingPacingDirective(pacing: string | null | undefined): string {
  if (normalizeOpeningPacing(pacing) === 'cinematic') {
    return '【開場節奏：電影氛圍】每個場景開頭，establishing 環境鏡頭要獨立成一個分鏡組（整組鋪環境氛圍 + 主體慢揭示，讓畫面呼吸），不與後續動作高潮同組。寧可開場慢，先建立場所感與氛圍。'
  }
  return '【開場節奏：短劇快鉤子】開場走冷開場節奏，3 秒內進入衝突或鉤子抓住觀眾，環境鋪陳精簡，不要慢吞吞。'
}

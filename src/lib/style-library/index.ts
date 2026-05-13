/**
 * Style Library — public entry point.
 *
 * Background (2026-05-13):
 *   This module ships the 29-style × 8-lighting catalog described in
 *   docs/style-library-design-v3.md. The legacy 22-entry catalog at
 *   `src/lib/style-profile/presets.ts` is STILL the source of truth
 *   wired into the live workers (panel-image, multi-shot-video-b-path,
 *   etc.) — this module is deliberately additive so the photoreal
 *   anchor work shipped earlier in the day stays intact.
 *
 *   The migration plan (not yet executed):
 *     1. ✅ Schema + seed data landed (Step 1+2 of the seed README)
 *     2. ✅ Prompt builder exposed as a module (Step 3 — this file)
 *     3. ⏳ Worker integration — opt-in flag, then default-on, then
 *        retire legacy preset catalog. Defer until UI + admin tooling
 *        catches up to the new (styleAnchor, visualModifiers, negative,
 *        recommendedKlingVersion) shape.
 *     4. ⏳ Thumbnail generation — see docs/runbooks/style-library-thumbnails.md
 *
 * Consumers can import from `@/lib/style-library` directly.
 */

export type {
  VisualStyle,
  LightingPreset,
  StyleLightingRecommendation,
  StyleElement,
  KlingPromptResult,
  MultiShotResult,
} from './types'
export { visualStyles } from './visual-styles'
export { lightingPresets } from './lighting-presets'
export {
  getStyle,
  getLighting,
  buildKlingPrompt,
  buildShortDramaShots,
  buildVodAigcRequest,
  buildVclmRequest,
  type BuildKlingPromptOptions,
  type ShotInput,
  type BuildMultiShotOptions,
  type BuildVodAigcRequestOptions,
  type BuildVclmRequestOptions,
} from './prompt-builder'

/**
 * Public API for the ReelShort cold-open module.
 *
 * Phase 1 — template-only mechanical reformat.
 * See docs/design/reelshort-cold-open-evaluation.md for design context.
 */

export type {
  ColdOpenVariant,
  ColdOpenPanel,
  ColdOpenVoiceLine,
  ColdOpenCharacterRef,
  ColdOpenBuildOptions,
} from './types'

export {
  COLD_OPEN_TOTAL_SECONDS,
  COLD_OPEN_PANEL_COUNT,
  COLD_OPEN_SHOT_DURATION_SECONDS,
} from './types'

export { detectColdOpenGenre, scoreColdOpenGenres } from './genre-detector'

export { getColdOpenTemplate } from './templates'

export { buildColdOpenShotBlock, fitPanelsToFourSlots } from './builder'

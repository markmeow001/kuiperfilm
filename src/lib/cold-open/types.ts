/**
 * ReelShort 8-second cold-open structure types.
 *
 * Phase 1 — Template-only mode. Pure mechanical reformat of group panels
 * into the 4-shot × 2-second hook formula validated by ReelShort /
 * DramaBox vertical micro-drama (5B+ views per series). Phase 2 will
 * add an LLM Shot Director that re-writes panel content semantically.
 *
 * See docs/design/reelshort-cold-open-evaluation.md for the full
 * formula, alignment analysis, and 3-phase integration plan.
 */

export type ColdOpenVariant = 'modern' | 'period' | 'action'

export interface ColdOpenVoiceLine {
  speaker: string
  content: string
  isVoiceover: boolean
}

export interface ColdOpenCharacterRef {
  name: string
  appearance?: string
}

export interface ColdOpenPanel {
  id: string
  description?: string | null
  // Union mirrors storyboard PanelLike.characters — panels may carry decoded
  // {name} refs or raw bare strings. extractPanelCharNames handles both.
  characters?: Array<ColdOpenCharacterRef | string> | null
  location?: string | null
  voiceLines?: ColdOpenVoiceLine[]
  /** Legacy fallback when voiceLines is missing. */
  srtSegment?: string | null
}

export interface ColdOpenBuildOptions {
  panels: ColdOpenPanel[]
  variant: ColdOpenVariant
  /** Per-shot photoreal anchor tag, appended to each shot title. */
  perShotTag: string
  /** Anti-text/UI strict line, appended to each shot block. */
  antiTextLine: string
}

export const COLD_OPEN_TOTAL_SECONDS = 8
export const COLD_OPEN_PANEL_COUNT = 4
export const COLD_OPEN_SHOT_DURATION_SECONDS = 2

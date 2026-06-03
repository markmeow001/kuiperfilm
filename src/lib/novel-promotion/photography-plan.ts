/**
 * Single source of truth for the per-panel "photography plan" shape.
 *
 * The cinematographer agent (agent_cinematographer.{zh,en}.txt) emits one
 * rule per panel. The editable photography UI (AIDataModal) reads these
 * fields: scene_summary, lighting{direction,quality}, characters[],
 * depth_of_field, color_tone. Before 2026-06-03 the merge mapped them into
 * an incompatible {composition, colorPalette, ...} shape, so the editor was
 * empty for both locales — see photography-plan.test.ts.
 *
 * buildPhotographyPlan is used by BOTH merge sites (orchestrator +
 * text.worker) so the shape can't drift between the two pipelines.
 */
type JsonRecord = Record<string, unknown>

export type PhotographyLighting = {
  direction?: string
  quality?: string
}

export type PhotographyCharacter = {
  name?: string
  screen_position?: string
  posture?: string
  facing?: string
}

/** One cinematographer rule — matches the UI's PhotographyRules type. */
export type PhotographyRule = JsonRecord & {
  panel_number?: number
  scene_summary?: string
  lighting?: PhotographyLighting
  characters?: PhotographyCharacter[]
  depth_of_field?: string
  color_tone?: string
}

/**
 * Project a cinematographer rule into the stored photographyPlan object.
 * Pass-through of the UI-schema content fields (drops panel_number, which is
 * matched by index downstream). Tolerant of missing fields.
 */
export function buildPhotographyPlan(rule: PhotographyRule): JsonRecord {
  return {
    scene_summary: rule.scene_summary,
    lighting: rule.lighting,
    characters: rule.characters,
    depth_of_field: rule.depth_of_field,
    color_tone: rule.color_tone,
  }
}

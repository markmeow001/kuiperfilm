export const PROMPT_IDS = {
  CHARACTER_IMAGE_TO_DESCRIPTION: 'character_image_to_description',
  CHARACTER_REFERENCE_TO_SHEET: 'character_reference_to_sheet',
  LOCATION_IMAGE_TO_DESCRIPTION: 'location_image_to_description',
  PROP_IMAGE_TO_DESCRIPTION: 'prop_image_to_description',
  NP_AGENT_ACTING_DIRECTION: 'np_agent_acting_direction',
  NP_AGENT_CHARACTER_PROFILE: 'np_agent_character_profile',
  NP_AGENT_CHARACTER_VISUAL: 'np_agent_character_visual',
  NP_AGENT_CINEMATOGRAPHER: 'np_agent_cinematographer',
  NP_AGENT_CLIP: 'np_agent_clip',
  NP_AGENT_SHOT_VARIANT_ANALYSIS: 'np_agent_shot_variant_analysis',
  NP_AGENT_SHOT_VARIANT_GENERATE: 'np_agent_shot_variant_generate',
  NP_AGENT_STORYBOARD_DETAIL: 'np_agent_storyboard_detail',
  /**
   * Kling-specific variant of NP_AGENT_STORYBOARD_DETAIL — emits Kling-tuned
   * camera vocabulary, English movement words, explicit timing hints, and
   * optional multi_shot_group tags so the generator can choose to merge
   * consecutive panels into a Kling 3.0 multi_shot=intelligence submission.
   */
  NP_KLING_AGENT_STORYBOARD_DETAIL: 'np_kling_agent_storyboard_detail',
  NP_AGENT_STORYBOARD_INSERT: 'np_agent_storyboard_insert',
  NP_AGENT_STORYBOARD_PLAN: 'np_agent_storyboard_plan',
  NP_CHARACTER_CREATE: 'np_character_create',
  NP_CHARACTER_DESCRIPTION_UPDATE: 'np_character_description_update',
  NP_CHARACTER_MODIFY: 'np_character_modify',
  NP_CHARACTER_REGENERATE: 'np_character_regenerate',
  NP_EPISODE_SPLIT: 'np_episode_split',
  NP_IMAGE_PROMPT_MODIFY: 'np_image_prompt_modify',
  NP_LOCATION_CREATE: 'np_location_create',
  NP_LOCATION_DESCRIPTION_UPDATE: 'np_location_description_update',
  NP_LOCATION_MODIFY: 'np_location_modify',
  NP_LOCATION_REGENERATE: 'np_location_regenerate',
  NP_SCREENPLAY_CONVERSION: 'np_screenplay_conversion',
  NP_SELECT_LOCATION: 'np_select_location',
  NP_SINGLE_PANEL_IMAGE: 'np_single_panel_image',
  NP_STORYBOARD_EDIT: 'np_storyboard_edit',
  NP_VOICE_ANALYSIS: 'np_voice_analysis',
  /**
   * Phase 12.5.3 — group consecutive storyboard panels into Kling multi-shot
   * clusters of 2-6 each, prioritising scene/character continuity. Output is
   * strict JSON: { groups: [{ id, panelIds: [...] }, ...] }.
   */
  NP_AUTO_GROUP_MULTI_SHOT: 'np_auto_group_multi_shot',
  /**
   * Phase 11.3 Stage A — extract first-class props from a script clip /
   * episode. Outputs `{ props: [{ name, summary, visual_description }] }`.
   * Backed by `lib/prompts/novel-promotion/extract_props.{zh,en}.txt`.
   */
  NP_EXTRACT_PROPS: 'np_extract_props',
} as const

export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS]

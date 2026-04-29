/**
 * Storyboard prompt routing.
 *
 * Picks which agent_storyboard_detail prompt template to load based on the
 * project's selected video model. The generic prompt (NP_AGENT_STORYBOARD_DETAIL)
 * works for every video provider; the Kling variant emits Kling-tuned camera
 * vocabulary, English movement words with explicit timing, and optional
 * multi_shot_group tags so the generator can choose to merge consecutive
 * panels into a Kling 3.0 multi_shot=intelligence submission.
 *
 * Rule: any video model whose modelId portion starts with "Kling-" routes
 * through the Kling prompt. Older Kling versions (2.0, 2.5, 2.6, O1) still
 * benefit from the Kling-friendly vocabulary; whether multi_shot_group tags
 * are actually used at submit time is the generator's decision based on the
 * concrete model version.
 */
import { PROMPT_IDS, type PromptId } from '@/lib/prompt-i18n/prompt-ids'

const KLING_MODEL_PREFIX_PATTERN = /^kling[-_ ]/i

/**
 * Strip the optional "<provider>::" prefix from a composite model key.
 * Supports both bare modelIds ("Kling-3.0") and composite keys
 * ("tencent-vod::Kling-3.0").
 */
function extractModelId(videoModel: string): string {
  const sepIndex = videoModel.indexOf('::')
  if (sepIndex < 0) return videoModel
  return videoModel.slice(sepIndex + 2)
}

/**
 * Returns true when the supplied video model is any Kling variant — the
 * Kling-tuned storyboard prompt should be preferred for these.
 */
export function isKlingVideoModel(
  videoModel: string | null | undefined,
): boolean {
  if (!videoModel) return false
  const trimmed = videoModel.trim()
  if (!trimmed) return false
  const modelId = extractModelId(trimmed)
  return KLING_MODEL_PREFIX_PATTERN.test(modelId)
}

/**
 * Picks the prompt id to use for the storyboard detail (Phase 3) stage.
 * Defaults to the generic prompt when videoModel is missing or not Kling.
 */
export function pickStoryboardDetailPromptId(
  videoModel: string | null | undefined,
): PromptId {
  return isKlingVideoModel(videoModel)
    ? PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL
    : PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL
}

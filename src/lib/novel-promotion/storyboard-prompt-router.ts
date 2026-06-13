/**
 * Storyboard prompt routing.
 *
 * Picks which agent_storyboard_detail prompt template to load based on the
 * project's selected video model. Two templates, NOT three:
 *
 *   - NP_AGENT_STORYBOARD_DETAIL (the "generic" one) — this IS the R2V-first
 *     detail prompt. The 2026-05~06 narrative-quality refactors evolved it
 *     into a model-agnostic, description-as-primary-narrative, five-element
 *     three-beat template (see its lines on "description 是 R2V 敘事的主文本").
 *     It is NOT T2V-oriented. Seedance / ARK / AtlasCloud / FAL all route here.
 *   - NP_KLING_AGENT_STORYBOARD_DETAIL — Kling-only variant: Kling-tuned camera
 *     vocabulary, English movement words with explicit timing, and optional
 *     multi_shot_group tags for Kling 3.0 multi_shot=intelligence merging.
 *
 * ⚠️ Do NOT create a separate NP_AGENT_STORYBOARD_R2V_DETAIL (as an early draft
 * of REDESIGN_PLAN §1.5B suggested) — the generic template already fills that
 * role, and duplicating ~419 bilingual lines would violate "no patches / DRY".
 * See docs/plans/2026-06-12-track-consolidation.md (Phase 1.5C slice 2).
 *
 * Rule: any video model whose modelId portion starts with "Kling-" routes
 * through the Kling prompt. Older Kling versions (2.0, 2.5, 2.6, O1) still
 * benefit from the Kling-friendly vocabulary; whether multi_shot_group tags
 * are actually used at submit time is the generator's decision based on the
 * concrete model version.
 *
 * Note on mode: the detail/Phase-3 stage runs BEFORE panels exist, so there is
 * no per-panel panelGenerationMode here — the only axis that matters at this
 * stage is the target video provider's prompt dialect (Kling vs R2V-generic).
 * Per-panel mode routing happens later, in the video worker (Phase 1.5C slice 3).
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

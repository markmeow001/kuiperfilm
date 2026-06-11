/**
 * Phase 2.5 Step 4-C (2026-06-11) — Skill constraint enforcement.
 *
 * Runs at submitTask time, BEFORE prepareTaskBilling freezes credits.
 * Submit-time enforcement (not worker-time) means:
 *   - User gets sub-second feedback toast
 *   - No billing rollback path exercised
 *   - No wasted queue entries
 *   - No useless Task row clutter
 *
 * Constraints supported in this commit:
 *   - enforceAudioRefPerCharacter — every character in the run's
 *     episode (or project, if no episode) must have at least one of
 *     `customVoiceUrl`, `customVoiceMediaId`, or `voiceId`. Episode-
 *     scoped so an unfinished ep5 doesn't block ep1.
 *
 * Future constraints (Phase 3.0):
 *   - forbiddenSubjects — prompt-filter at worker time, not here
 *   - forcePortrait / forceLandscape — payload-mutation in apply-defaults
 *
 * Plan: .claude/plan/skill-worker-dispatch.md (Sub-commit 4-C)
 */

import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import type { SkillConfig } from './types'

export interface ConstraintContext {
  episodeId?: string | null
}

/**
 * Top-level constraint runner. Reads `config.constraints` and runs
 * each enabled check. Throws on first violation so the user sees the
 * most actionable error first. Returns void on success.
 */
export async function enforceConstraints(
  projectId: string,
  config: SkillConfig,
  ctx: ConstraintContext,
): Promise<void> {
  const c = config.constraints
  if (!c) return
  if (c.enforceAudioRefPerCharacter) {
    await checkAudioRefPerCharacter(projectId, ctx.episodeId ?? null)
  }
  // forbiddenSubjects + forcePortrait + forceLandscape: not enforced
  // here; see module docstring.
}

/**
 * Verify every character in scope has at least one voice anchor.
 *
 * Scope:
 *   - episodeId provided → only characters in `episode_characters` for
 *     that episode are checked
 *   - episodeId omitted → all characters in the novel-promotion project
 *
 * Predicate (permissive — any of three counts):
 *   - customVoiceUrl  (uploaded reference audio URL)
 *   - customVoiceMediaId  (uploaded reference audio Media row)
 *   - voiceId  (preset TTS voice id, e.g. qwen-tts-vd voice)
 *
 * Throws ApiError('SKILL_PRECONDITION_FAILED', ...) with per-character
 * names so the front-end can deep-link to character setup.
 */
async function checkAudioRefPerCharacter(
  projectId: string,
  episodeId: string | null,
): Promise<void> {
  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    // Not a novel-promotion project — constraint is N/A. Other Skill
    // types (product-promo, MV, etc.) will plug in their own scope
    // resolver in future commits.
    return
  }

  type CharacterRow = {
    name: string
    customVoiceUrl: string | null
    customVoiceMediaId: string | null
    voiceId: string | null
  }

  let characters: CharacterRow[]

  if (episodeId) {
    const rows = await prisma.episodeCharacter.findMany({
      where: { episodeId },
      select: {
        character: {
          select: {
            name: true,
            customVoiceUrl: true,
            customVoiceMediaId: true,
            voiceId: true,
          },
        },
      },
    })
    characters = rows.map((r) => r.character)
  } else {
    characters = await prisma.novelPromotionCharacter.findMany({
      where: { novelPromotionProjectId: novelProject.id },
      select: {
        name: true,
        customVoiceUrl: true,
        customVoiceMediaId: true,
        voiceId: true,
      },
    })
  }

  const missing = characters.filter(
    (c) => !c.customVoiceUrl && !c.customVoiceMediaId && !c.voiceId,
  )
  if (missing.length > 0) {
    const names = missing.map((c) => c.name).join('、')
    throw new ApiError('SKILL_PRECONDITION_FAILED', {
      code: 'SKILL_AUDIO_REF_MISSING',
      message: `此 Skill 需要每位角色都有參考音頻，但 ${missing.length} 位角色尚未設定：${names}`,
      constraint: 'enforceAudioRefPerCharacter',
      missingCharacters: missing.map((c) => c.name),
    })
  }
}

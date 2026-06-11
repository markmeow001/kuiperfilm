/**
 * Phase 2.5 Step 4-A (2026-06-11) — Server-only Skill loader.
 *
 * Two entry points:
 *   - loadSkillConfigForProject(projectId) — called at submitTask to
 *     resolve a project's anchored Skill (if any). Returns null when
 *     the project has no originSkillId OR the Skill is archived/draft.
 *   - loadSkillConfigById(skillId) — called inside the worker to
 *     re-read the same row for prompts / constraints. Re-reading
 *     keeps the Skill row as the source of truth even when an
 *     editorial fix lands mid-flight; the videoModel is pinned at
 *     submitTask so billing remains consistent.
 *
 * Pure server module. NO React / UI imports. Used by:
 *   - src/lib/task/submitter.ts
 *   - src/lib/workers/handlers/multi-shot-video-handler.ts
 *   - src/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route.ts
 *
 * Spec: IMPL_PREP/R-skill-primitive.md §5
 * Plan: .claude/plan/skill-worker-dispatch.md (Sub-commit 4-A)
 */

import { prisma } from '@/lib/prisma'
import type { SkillConfig } from './types'

export interface ResolvedSkill {
  id: string
  slug: string
  config: SkillConfig
}

/**
 * Resolve a project's anchored Skill into a typed runtime config.
 *
 * Returns null when:
 *   - the project has no `originSkillId` (legacy / 自由創作), OR
 *   - the linked Skill row is missing (FK cascade SetNull cleared it), OR
 *   - the Skill is archived / draft (status !== 'published').
 *
 * Throws on a corrupted `config` JSON shape — callers catch and surface
 * as ApiError('INVALID_PARAMS', 'SKILL_CONFIG_BROKEN') so users get a
 * clear toast instead of a generic 500.
 */
export async function loadSkillConfigForProject(
  projectId: string,
): Promise<ResolvedSkill | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      originSkillId: true,
      originSkill: {
        select: { id: true, slug: true, status: true, config: true },
      },
    },
  })
  if (!project?.originSkill) return null
  if (project.originSkill.status !== 'published') return null
  const config = resolveSkillConfigFromRaw(
    project.originSkill.config,
    project.originSkill.slug,
  )
  return {
    id: project.originSkill.id,
    slug: project.originSkill.slug,
    config,
  }
}

/**
 * Worker entry point — re-read by id once we already have a skillId
 * pinned on the BullMQ job. Same shape as the project-scoped loader.
 */
export async function loadSkillConfigById(
  skillId: string,
): Promise<ResolvedSkill | null> {
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { id: true, slug: true, status: true, config: true },
  })
  if (!skill) return null
  if (skill.status !== 'published') return null
  const config = resolveSkillConfigFromRaw(skill.config, skill.slug)
  return { id: skill.id, slug: skill.slug, config }
}

/**
 * Strict JSON → SkillConfig narrowing with version gate. Throws on
 * shape violation. Caller decides whether to soft-fallback (worker)
 * or hard-fail (submit-time).
 */
export function resolveSkillConfigFromRaw(
  raw: unknown,
  slug: string,
): SkillConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`SKILL_CONFIG_INVALID: ${slug} config is not an object`)
  }
  const config = raw as Partial<SkillConfig>
  if (config.version !== 1) {
    throw new Error(
      `SKILL_CONFIG_VERSION_UNSUPPORTED: ${slug} version=${String(config.version)}`,
    )
  }
  if (!Array.isArray(config.pipeline) || config.pipeline.length === 0) {
    throw new Error(`SKILL_CONFIG_PIPELINE_EMPTY: ${slug}`)
  }
  if (!config.input || typeof config.input !== 'object') {
    throw new Error(`SKILL_CONFIG_INPUT_MISSING: ${slug}`)
  }
  if (!config.defaults || typeof config.defaults !== 'object') {
    throw new Error(`SKILL_CONFIG_DEFAULTS_MISSING: ${slug}`)
  }
  return config as SkillConfig
}

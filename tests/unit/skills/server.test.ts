/**
 * Phase 2.5 Step 4-A — server loader behavior contract.
 *
 * Covers:
 *   - null project / no originSkillId → null
 *   - Skill archived (status !== 'published') → null (graceful fallback)
 *   - Valid published Skill → returns ResolvedSkill
 *   - Corrupted config (version mismatch / missing pipeline) → throws
 *     specific error code so caller can surface clear error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUniqueProjectMock = vi.hoisted(() => vi.fn())
const findUniqueSkillMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: findUniqueProjectMock },
    skill: { findUnique: findUniqueSkillMock },
  },
}))

import {
  loadSkillConfigForProject,
  loadSkillConfigById,
  resolveSkillConfigFromRaw,
} from '@/lib/skills/server'

const VALID_CONFIG = {
  version: 1,
  input: { requiresScript: false },
  pipeline: [{ stage: 'generate_panel_video', model: 'ark::seedance-2.0' }],
  defaults: { aspectRatio: '9:16', durationPerShotSec: 10, shotCount: 3 },
}

describe('loadSkillConfigForProject', () => {
  beforeEach(() => {
    findUniqueProjectMock.mockReset()
  })

  it('returns null when project has no originSkillId', async () => {
    findUniqueProjectMock.mockResolvedValueOnce({ originSkillId: null, originSkill: null })
    const result = await loadSkillConfigForProject('proj-1')
    expect(result).toBeNull()
  })

  it('returns null when project not found', async () => {
    findUniqueProjectMock.mockResolvedValueOnce(null)
    const result = await loadSkillConfigForProject('proj-1')
    expect(result).toBeNull()
  })

  it('returns null when Skill is archived (status !== published)', async () => {
    findUniqueProjectMock.mockResolvedValueOnce({
      originSkillId: 'skill-1',
      originSkill: {
        id: 'skill-1',
        slug: 'drama-short',
        status: 'archived',
        config: VALID_CONFIG,
      },
    })
    const result = await loadSkillConfigForProject('proj-1')
    expect(result).toBeNull()
  })

  it('returns ResolvedSkill when Skill is published with valid config', async () => {
    findUniqueProjectMock.mockResolvedValueOnce({
      originSkillId: 'skill-1',
      originSkill: {
        id: 'skill-1',
        slug: 'drama-short',
        status: 'published',
        config: VALID_CONFIG,
      },
    })
    const result = await loadSkillConfigForProject('proj-1')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('skill-1')
    expect(result?.slug).toBe('drama-short')
    expect(result?.config.version).toBe(1)
    expect(result?.config.pipeline[0]?.model).toBe('ark::seedance-2.0')
  })
})

describe('loadSkillConfigById', () => {
  beforeEach(() => {
    findUniqueSkillMock.mockReset()
  })

  it('returns null when Skill not found', async () => {
    findUniqueSkillMock.mockResolvedValueOnce(null)
    const result = await loadSkillConfigById('missing')
    expect(result).toBeNull()
  })

  it('returns null when Skill is draft', async () => {
    findUniqueSkillMock.mockResolvedValueOnce({
      id: 'skill-1',
      slug: 'drama-short',
      status: 'draft',
      config: VALID_CONFIG,
    })
    const result = await loadSkillConfigById('skill-1')
    expect(result).toBeNull()
  })

  it('returns ResolvedSkill when published', async () => {
    findUniqueSkillMock.mockResolvedValueOnce({
      id: 'skill-1',
      slug: 'drama-short',
      status: 'published',
      config: VALID_CONFIG,
    })
    const result = await loadSkillConfigById('skill-1')
    expect(result?.id).toBe('skill-1')
  })
})

describe('resolveSkillConfigFromRaw', () => {
  it('throws on non-object raw', () => {
    expect(() => resolveSkillConfigFromRaw(null, 'x')).toThrow(/SKILL_CONFIG_INVALID/)
    expect(() => resolveSkillConfigFromRaw('not-an-object', 'x')).toThrow(/SKILL_CONFIG_INVALID/)
  })

  it('throws on unsupported version', () => {
    expect(() =>
      resolveSkillConfigFromRaw({ ...VALID_CONFIG, version: 2 }, 'x'),
    ).toThrow(/SKILL_CONFIG_VERSION_UNSUPPORTED/)
  })

  it('throws on empty pipeline', () => {
    expect(() =>
      resolveSkillConfigFromRaw({ ...VALID_CONFIG, pipeline: [] }, 'x'),
    ).toThrow(/SKILL_CONFIG_PIPELINE_EMPTY/)
  })

  it('throws on missing input', () => {
    const { input: _, ...withoutInput } = VALID_CONFIG
    expect(() => resolveSkillConfigFromRaw(withoutInput, 'x')).toThrow(
      /SKILL_CONFIG_INPUT_MISSING/,
    )
  })

  it('throws on missing defaults', () => {
    const { defaults: _, ...withoutDefaults } = VALID_CONFIG
    expect(() => resolveSkillConfigFromRaw(withoutDefaults, 'x')).toThrow(
      /SKILL_CONFIG_DEFAULTS_MISSING/,
    )
  })

  it('returns the typed config when shape valid', () => {
    const result = resolveSkillConfigFromRaw(VALID_CONFIG, 'x')
    expect(result.version).toBe(1)
    expect(result.pipeline.length).toBe(1)
  })
})

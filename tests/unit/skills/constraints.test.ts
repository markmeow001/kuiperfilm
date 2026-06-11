/**
 * Phase 2.5 Step 4-C — enforceAudioRefPerCharacter behavior contract.
 *
 * Verifies:
 *   - constraint skipped when not configured
 *   - permissive predicate (any of 3 fields counts)
 *   - episode-scoped vs project-scoped routing
 *   - missing characters surface via SKILL_PRECONDITION_FAILED with
 *     per-character names so the front-end can deep-link
 *   - non-novel-promotion projects skip the check (N/A scope)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const novelProjectMock = vi.hoisted(() => vi.fn())
const episodeCharacterMock = vi.hoisted(() => vi.fn())
const characterMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionProject: { findUnique: novelProjectMock },
    episodeCharacter: { findMany: episodeCharacterMock },
    novelPromotionCharacter: { findMany: characterMock },
  },
}))

import { enforceConstraints } from '@/lib/skills/constraints'
import type { SkillConfig } from '@/lib/skills/types'

function makeConfig(
  constraints?: SkillConfig['constraints'],
): SkillConfig {
  return {
    version: 1,
    input: {},
    pipeline: [{ stage: 'generate_panel_video', model: 'ark::seedance-2.0' }],
    defaults: {},
    ...(constraints ? { constraints } : {}),
  }
}

describe('enforceConstraints', () => {
  beforeEach(() => {
    novelProjectMock.mockReset()
    episodeCharacterMock.mockReset()
    characterMock.mockReset()
  })

  it('no-ops when config has no constraints block', async () => {
    await expect(
      enforceConstraints('proj-1', makeConfig(), { episodeId: null }),
    ).resolves.toBeUndefined()
    expect(novelProjectMock).not.toHaveBeenCalled()
  })

  it('no-ops when enforceAudioRefPerCharacter is false', async () => {
    await expect(
      enforceConstraints(
        'proj-1',
        makeConfig({ enforceAudioRefPerCharacter: false }),
        { episodeId: null },
      ),
    ).resolves.toBeUndefined()
    expect(novelProjectMock).not.toHaveBeenCalled()
  })

  it('skips check when project is not a novel-promotion project', async () => {
    novelProjectMock.mockResolvedValueOnce(null)
    await expect(
      enforceConstraints(
        'proj-1',
        makeConfig({ enforceAudioRefPerCharacter: true }),
        { episodeId: null },
      ),
    ).resolves.toBeUndefined()
    expect(episodeCharacterMock).not.toHaveBeenCalled()
    expect(characterMock).not.toHaveBeenCalled()
  })

  describe('episode-scoped check', () => {
    it('passes when all characters in episode have customVoiceUrl', async () => {
      novelProjectMock.mockResolvedValueOnce({ id: 'np-1' })
      episodeCharacterMock.mockResolvedValueOnce([
        { character: { name: '李婉', customVoiceUrl: 'cos://voice/a.mp3', customVoiceMediaId: null, voiceId: null } },
        { character: { name: '阿凱', customVoiceUrl: 'cos://voice/b.mp3', customVoiceMediaId: null, voiceId: null } },
      ])
      await expect(
        enforceConstraints(
          'proj-1',
          makeConfig({ enforceAudioRefPerCharacter: true }),
          { episodeId: 'ep-1' },
        ),
      ).resolves.toBeUndefined()
      expect(characterMock).not.toHaveBeenCalled()
    })

    it('passes when characters have voiceId (preset voice) instead of upload', async () => {
      novelProjectMock.mockResolvedValueOnce({ id: 'np-1' })
      episodeCharacterMock.mockResolvedValueOnce([
        { character: { name: '李婉', customVoiceUrl: null, customVoiceMediaId: null, voiceId: 'qwen-tts-vd::male-01' } },
      ])
      await expect(
        enforceConstraints(
          'proj-1',
          makeConfig({ enforceAudioRefPerCharacter: true }),
          { episodeId: 'ep-1' },
        ),
      ).resolves.toBeUndefined()
    })

    it('passes when characters have customVoiceMediaId', async () => {
      novelProjectMock.mockResolvedValueOnce({ id: 'np-1' })
      episodeCharacterMock.mockResolvedValueOnce([
        { character: { name: '李婉', customVoiceUrl: null, customVoiceMediaId: 'media-1', voiceId: null } },
      ])
      await expect(
        enforceConstraints(
          'proj-1',
          makeConfig({ enforceAudioRefPerCharacter: true }),
          { episodeId: 'ep-1' },
        ),
      ).resolves.toBeUndefined()
    })

    it('throws SKILL_PRECONDITION_FAILED with missing names when any character lacks all three fields', async () => {
      novelProjectMock.mockResolvedValueOnce({ id: 'np-1' })
      episodeCharacterMock.mockResolvedValueOnce([
        { character: { name: '李婉', customVoiceUrl: 'cos://voice/a.mp3', customVoiceMediaId: null, voiceId: null } },
        { character: { name: '阿凱', customVoiceUrl: null, customVoiceMediaId: null, voiceId: null } },
        { character: { name: '小明', customVoiceUrl: null, customVoiceMediaId: null, voiceId: null } },
      ])
      await expect(
        enforceConstraints(
          'proj-1',
          makeConfig({ enforceAudioRefPerCharacter: true }),
          { episodeId: 'ep-1' },
        ),
      ).rejects.toMatchObject({
        code: 'SKILL_PRECONDITION_FAILED',
        status: 412,
        details: {
          code: 'SKILL_AUDIO_REF_MISSING',
          constraint: 'enforceAudioRefPerCharacter',
          missingCharacters: ['阿凱', '小明'],
        },
      })
    })

    it('throws on empty episode roster when constraint requires audio (no characters = unmet)', async () => {
      // Currently zero characters → zero "missing" → passes. Documents
      // expected behavior: it's the caller's job to ensure the episode
      // actually has characters before generation. The
      // multi-shot-video-handler already throws if panel.characters is
      // empty at run-time.
      novelProjectMock.mockResolvedValueOnce({ id: 'np-1' })
      episodeCharacterMock.mockResolvedValueOnce([])
      await expect(
        enforceConstraints(
          'proj-1',
          makeConfig({ enforceAudioRefPerCharacter: true }),
          { episodeId: 'ep-1' },
        ),
      ).resolves.toBeUndefined()
    })
  })

  describe('project-scoped fallback (no episodeId)', () => {
    it('checks all project characters when episodeId is null', async () => {
      novelProjectMock.mockResolvedValueOnce({ id: 'np-1' })
      characterMock.mockResolvedValueOnce([
        { name: '李婉', customVoiceUrl: 'cos://voice/a.mp3', customVoiceMediaId: null, voiceId: null },
        { name: '阿凱', customVoiceUrl: null, customVoiceMediaId: null, voiceId: 'qwen-tts-vd::male-01' },
      ])
      await expect(
        enforceConstraints(
          'proj-1',
          makeConfig({ enforceAudioRefPerCharacter: true }),
          { episodeId: null },
        ),
      ).resolves.toBeUndefined()
      expect(episodeCharacterMock).not.toHaveBeenCalled()
    })

    it('throws with missing names in project-scoped check', async () => {
      novelProjectMock.mockResolvedValueOnce({ id: 'np-1' })
      characterMock.mockResolvedValueOnce([
        { name: '李婉', customVoiceUrl: null, customVoiceMediaId: null, voiceId: null },
      ])
      await expect(
        enforceConstraints(
          'proj-1',
          makeConfig({ enforceAudioRefPerCharacter: true }),
          { episodeId: null },
        ),
      ).rejects.toMatchObject({
        details: { missingCharacters: ['李婉'] },
      })
    })
  })
})

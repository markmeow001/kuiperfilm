import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { submitTask } from '@/lib/task/submitter'
import { logError as _ulogError } from '@/lib/logging/core'
import { readText, toStringArray, nameMatchesWithAlias } from './analyze-novel-utils'

/**
 * Process the LLM-emitted `updated_characters` array. Three goals:
 *   1. Backfill Character.introduction if it's empty (legacy rows from
 *      before the analyze worker persisted the field had `null` here,
 *      which left V2 cards without a role description).
 *   2. Merge newly discovered aliases (additive only — never drop
 *      existing aliases the user or earlier passes recorded).
 *   3. Backfill the primary CharacterAppearance.description with the
 *      LLM's freshly-emitted visual_description IF the row currently
 *      has none. This is the rescue path for characters extracted
 *      before visual_description was a required field — without it
 *      the image worker fed an empty prompt to Tencent VOD and got
 *      era-mismatched / wrong-gender output. We never overwrite an
 *      existing prompt — user edits are preserved.
 *
 * After a backfill, kicks off an IMAGE_CHARACTER task so the wrong
 * legacy image gets replaced without the user having to click 重生 on
 * every card. The shipped retry + concurrency=2 handles burst load.
 */
export async function processUpdatedCharacters(params: {
  job: Job<TaskJobData>
  parsedUpdated: Array<Record<string, unknown>>
  existingCharacters: Array<{
    id: string
    name: string
    aliases: string | null
    introduction: string | null
  }>
  projectId: string
}): Promise<{ backfilledCount: number }> {
  const { job, parsedUpdated, existingCharacters, projectId } = params
  const backfilled: Array<{ characterId: string; appearanceId: string }> = []

  for (const item of parsedUpdated) {
    const name = readText(item.name).trim()
    if (!name) continue
    const existing = existingCharacters.find((character) =>
      nameMatchesWithAlias(character.name, name),
    )
    if (!existing) continue

    const characterUpdates: Record<string, unknown> = {}
    const updatedIntro = readText(item.updated_introduction).trim()
    if (updatedIntro && !readText(existing.introduction).trim()) {
      characterUpdates.introduction = updatedIntro
    }
    const newAliases = toStringArray(item.updated_aliases)
    if (newAliases.length > 0) {
      let existingAliases: string[] = []
      try {
        const parsed = existing.aliases ? JSON.parse(existing.aliases) : []
        if (Array.isArray(parsed)) {
          existingAliases = parsed.filter((v): v is string => typeof v === 'string')
        }
      } catch {
        existingAliases = []
      }
      const merged = Array.from(new Set([...existingAliases, ...newAliases]))
      if (merged.length > existingAliases.length) {
        characterUpdates.aliases = JSON.stringify(merged)
      }
    }
    if (Object.keys(characterUpdates).length > 0) {
      await prisma.novelPromotionCharacter.update({
        where: { id: existing.id },
        data: characterUpdates,
      })
    }

    const visualDescription = readText(item.visual_description).trim()
    if (visualDescription) {
      const primary = await prisma.characterAppearance.findFirst({
        where: { characterId: existing.id, appearanceIndex: 0 },
        select: { id: true, description: true },
      })
      if (primary && !readText(primary.description).trim()) {
        await prisma.characterAppearance.update({
          where: { id: primary.id },
          data: {
            description: visualDescription,
            descriptions: JSON.stringify([visualDescription]),
          },
        })
        backfilled.push({ characterId: existing.id, appearanceId: primary.id })
      }
    }
  }

  for (const { characterId, appearanceId } of backfilled) {
    try {
      await submitTask({
        userId: job.data.userId,
        locale: job.data.locale,
        projectId,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
        targetId: appearanceId,
        payload: {
          type: 'character',
          id: characterId,
          appearanceId,
          imageIndex: 0,
        },
        dedupeKey: `image_character_backfill:${appearanceId}`,
        priority: 3,
      })
    } catch (err) {
      _ulogError('[analyze-novel] backfill regen submit failed:', err, {
        characterId,
        appearanceId,
      })
    }
  }

  return { backfilledCount: backfilled.length }
}

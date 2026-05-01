import { prisma } from '@/lib/prisma'
import { readText, toStringArray, nameMatchesWithAlias } from './analyze-novel-utils'

const PRIMARY_APPEARANCE_INDEX = 0

export async function processNewCharacters(params: {
  parsedCharacters: Array<Record<string, unknown>>
  existingCharacters: Array<{ name: string }>
  novelPromotionProjectId: string
}): Promise<Array<{ id: string }>> {
  const { parsedCharacters, existingCharacters, novelPromotionProjectId } = params
  const created: Array<{ id: string }> = []

  for (const item of parsedCharacters) {
    const name = readText(item.name).trim()
    if (!name) continue

    const existsInLibrary = existingCharacters.some(
      (character) => nameMatchesWithAlias(character.name, name),
    )
    if (existsInLibrary) continue

    const profileData = {
      role_level: item.role_level,
      archetype: item.archetype,
      personality_tags: toStringArray(item.personality_tags),
      era_period: item.era_period,
      social_class: item.social_class,
      occupation: item.occupation,
      costume_tier: item.costume_tier,
      suggested_colors: toStringArray(item.suggested_colors),
      primary_identifier: item.primary_identifier,
      visual_keywords: toStringArray(item.visual_keywords),
      gender: item.gender,
      age_range: item.age_range,
    }

    const introduction = readText(item.introduction).trim() || null
    const character = await prisma.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId,
        name,
        aliases: JSON.stringify(toStringArray(item.aliases)),
        profileData: JSON.stringify(profileData),
        profileConfirmed: false,
        // introduction is the human-readable role/relationship summary
        // shown on the SubjectsPage card. The prompt produces it but the
        // legacy handler dropped it on the floor; downstream consumers
        // (V2 cards, edit modal) had no source for the role description.
        introduction,
      },
      select: { id: true },
    })

    // Seed the primary CharacterAppearance row so downstream consumers
    // (regenerate-group / upload-asset-image / SubjectsPage cards) have
    // an appearanceId to bind to. The image is generated lazily when the
    // user clicks 重新生成 / 一鍵生圖. expected_appearances from the LLM
    // may carry additional change_reason entries; we honour the first
    // one here and leave secondary appearances for the multi-appearance
    // workflow (saved as project_kuiperai_multi_appearance_plan memory).
    const expectedAppearances = Array.isArray(item.expected_appearances)
      ? (item.expected_appearances as Array<{ id?: number; change_reason?: string }>)
      : []
    const initialChangeReason =
      readText(expectedAppearances[0]?.change_reason).trim() || '初始形象'

    // visual_description is the LLM-authored, era-grounded image prompt for
    // the initial appearance. Without it, the image worker fed an empty
    // userPrompt to the generator and got generic Tencent VOD output (a
    // contemporary drama could surface battlefield armor, robes, etc.).
    // Keep both `description` (singular, used as fallback prompt source)
    // and `descriptions` (JSON array, the canonical multi-prompt store)
    // in sync so either consumer works.
    const visualDescription = readText(item.visual_description).trim()
    await prisma.characterAppearance.create({
      data: {
        characterId: character.id,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
        changeReason: initialChangeReason,
        description: visualDescription || null,
        descriptions: visualDescription ? JSON.stringify([visualDescription]) : null,
        // image-urls contract requires JSON-strings in DB for both
        // imageUrls AND previousImageUrls — null on either field breaks
        // attachMediaFieldsToProject and cascades a 500 to the project
        // /data endpoint, blanking the v2 home name + step status.
        imageUrls: '[]',
        previousImageUrls: '[]',
      },
      select: { id: true },
    })
    created.push(character)
  }

  return created
}

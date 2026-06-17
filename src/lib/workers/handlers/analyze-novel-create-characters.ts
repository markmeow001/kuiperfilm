import { prisma } from '@/lib/prisma'
import { extractScriptDialogues } from '@/lib/novel-promotion/script-dialogue-extractor'
import { readText, toStringArray, nameMatchesWithAlias } from './analyze-novel-utils'

const PRIMARY_APPEARANCE_INDEX = 0

/**
 * Speaker names that the script-dialogue regex may legitimately pull
 * but that should NEVER become standalone character records — they are
 * narrative roles, not entities with a visual identity.
 */
const NARRATIVE_SPEAKER_BLOCKLIST = new Set([
  '旁白',
  '画外音',
  '畫外音',
  '独白',
  '獨白',
  '群众',
  '群眾',
  '众人',
  '眾人',
  '路人',
  '群演',
  'narrator',
  'Narrator',
  'NARRATOR',
])

/**
 * Mine speakers from the raw script and return any name that's not
 * already in `parsedCharacters` or `existingCharacters`. Used as a
 * deterministic safety net: the agent_character_profile prompt
 * excludes characters who only appear via VO/OS (their judgment rule
 * "是否在画面中有实际出镜" filters them out), so dialogue-only
 * characters like iangyc's 桃桃 never make it into the character
 * library. See `project_kuiperfilm_dialogue_extraction_bug` memory.
 */
export function mineSpeakersMissingFromRoster(params: {
  rawScript: string | null | undefined
  parsedCharacters: Array<Record<string, unknown>>
  existingCharacters: Array<{ name: string }>
}): Array<{ name: string; voiceOnly: boolean; sampleContent: string | null }> {
  const { rawScript, parsedCharacters, existingCharacters } = params
  if (!rawScript || !rawScript.trim()) return []

  const dialogues = extractScriptDialogues(rawScript)
  if (dialogues.length === 0) return []

  // Track each speaker's modifier history so we can flag VO-only speakers.
  type SpeakerTrack = { name: string; sawScreen: boolean; sawVoiceOver: boolean; firstContent: string }
  const speakerMap = new Map<string, SpeakerTrack>()
  for (const d of dialogues) {
    if (NARRATIVE_SPEAKER_BLOCKLIST.has(d.speaker)) continue
    const existing = speakerMap.get(d.speaker)
    const isVoiceOver = d.modifier !== null
    if (existing) {
      if (isVoiceOver) existing.sawVoiceOver = true
      else existing.sawScreen = true
    } else {
      speakerMap.set(d.speaker, {
        name: d.speaker,
        sawScreen: !isVoiceOver,
        sawVoiceOver: isVoiceOver,
        firstContent: d.content,
      })
    }
  }

  // Filter out anyone already represented in the roster (LLM-extracted
  // or pre-existing). nameMatchesWithAlias handles alias / honorific drift.
  const known: Array<{ name: string }> = [
    ...existingCharacters,
    ...parsedCharacters
      .map((c) => readText(c.name).trim())
      .filter(Boolean)
      .map((name) => ({ name })),
  ]
  const missing: Array<{ name: string; voiceOnly: boolean; sampleContent: string | null }> = []
  for (const track of speakerMap.values()) {
    if (known.some((k) => nameMatchesWithAlias(k.name, track.name))) continue
    missing.push({
      name: track.name,
      voiceOnly: track.sawVoiceOver && !track.sawScreen,
      sampleContent: track.firstContent || null,
    })
  }
  return missing
}

export async function processNewCharacters(params: {
  parsedCharacters: Array<Record<string, unknown>>
  existingCharacters: Array<{ name: string }>
  novelPromotionProjectId: string
  // Raw script text — enables deterministic backfill of dialogue-only
  // characters the LLM excluded. Optional so older callers compile.
  rawScript?: string | null
}): Promise<Array<{ id: string }>> {
  const { parsedCharacters, existingCharacters, novelPromotionProjectId, rawScript } = params

  // Backfill any speaker the LLM dropped. The mined entries are
  // appended onto parsedCharacters with a minimal profile so the
  // existing creation loop below treats them uniformly.
  const mined = mineSpeakersMissingFromRoster({ rawScript, parsedCharacters, existingCharacters })
  const charactersToCreate: Array<Record<string, unknown>> =
    mined.length === 0
      ? parsedCharacters
      : [
          ...parsedCharacters,
          ...mined.map((entry) => ({
            name: entry.name,
            // Mark voice-only speakers so downstream consumers can
            // skip generating a visual portrait until the user
            // confirms / uploads one. The flag is preserved inside
            // profileData JSON so we don't need a new column.
            appearance_mode: entry.voiceOnly ? 'voice_only' : 'mixed',
            introduction: entry.voiceOnly
              ? '台词角色（仅画外音/旁白出现，自动补建）'
              : '台词角色（自动补建）',
            // expected_appearances left empty → primary "初始形象" row
            // is still seeded by the loop below, but with no visual
            // description so image gen is deferred until upload.
          })),
        ]

  const created: Array<{ id: string }> = []

  for (const item of charactersToCreate) {
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
      // Preserved when present (mined VO speakers ship 'voice_only' so
      // downstream UI can offer "skip portrait generation" affordances).
      appearance_mode: typeof item.appearance_mode === 'string' ? item.appearance_mode : undefined,
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

    // Seed CharacterAppearance rows so downstream consumers (regenerate-group
    // / upload-asset-image / SubjectsPage cards) have an appearanceId to bind
    // to. Images are generated lazily when the user clicks 重新生成 / 一鍵生圖.
    //
    // 2026-06-16 — create ALL detected appearances, not just the primary.
    // The LLM emits one expected_appearances entry per PERSISTENT look
    // (初始形象 / 換裝 / 年齡變化), each with its own era-grounded
    // visual_description. A script that gives 王玄 three looks (修仙成年 /
    // 返老還春少年 / 現代便裝) now surfaces three 造型 instead of one.
    // (Previously we honoured only the first entry and left the rest for the
    // manual multi-appearance workflow — project_kuiperai_multi_appearance_plan.)
    // Capped to avoid runaway extraction; the prompt's 子形象 guardrails
    // already exclude effects / emotions / one-off actions.
    const MAX_APPEARANCES = 8
    const topVisualDescription = readText(item.visual_description).trim()
    const rawAppearances = Array.isArray(item.expected_appearances)
      ? (item.expected_appearances as Array<{
          id?: number
          change_reason?: string
          visual_description?: string
        }>)
      : []
    // Always create at least the primary; fall back to the top-level
    // visual_description for index 0 (older prompt filled only that one).
    const appearances = (
      rawAppearances.length > 0 ? rawAppearances : [{ change_reason: '初始形象' }]
    ).slice(0, MAX_APPEARANCES)

    for (let i = 0; i < appearances.length; i += 1) {
      const entry = appearances[i]
      const changeReason =
        readText(entry.change_reason).trim() || (i === 0 ? '初始形象' : `造型 ${i + 1}`)
      // Per-appearance description; the primary falls back to the top-level
      // visual_description so a script with a single look still gets a prompt
      // (otherwise the image worker fed an empty userPrompt → generic VOD output).
      // Keep `description` (singular fallback) and `descriptions` (JSON array,
      // canonical multi-prompt store) in sync so either consumer works.
      const desc =
        readText(entry.visual_description).trim() || (i === 0 ? topVisualDescription : '')
      await prisma.characterAppearance.create({
        data: {
          characterId: character.id,
          appearanceIndex: i === 0 ? PRIMARY_APPEARANCE_INDEX : i,
          changeReason,
          description: desc || null,
          descriptions: desc ? JSON.stringify([desc]) : null,
          // image-urls contract requires JSON-strings in DB for both
          // imageUrls AND previousImageUrls — null on either field breaks
          // attachMediaFieldsToProject and cascades a 500 to the project
          // /data endpoint, blanking the v2 home name + step status.
          imageUrls: '[]',
          previousImageUrls: '[]',
        },
        select: { id: true },
      })
    }
    created.push(character)
  }

  return created
}

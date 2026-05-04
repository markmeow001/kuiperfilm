import { prisma } from '@/lib/prisma'
import type { StoryboardPanel } from '@/lib/storyboard-phases'
import {
  linkEpisodeCharactersFromPanel,
  linkEpisodeLocationFromPanel,
} from '@/lib/episode-asset-bridge'
import { logError } from '@/lib/logging/core'

export type JsonRecord = Record<string, unknown>

export type ClipPanelsResult = {
  clipId: string
  clipIndex: number
  finalPanels: StoryboardPanel[]
}

export type PersistedStoryboard = {
  storyboardId: string
  clipId: string
  panels: Array<{
    id: string
    panelIndex: number
    description: string | null
    srtSegment: string | null
    characters: string | null
  }>
}

/**
 * 從 LLM 輸出的 source_text 抽出真正的對話。
 *
 * Background: agent_storyboard_plan prompt 規定每個 panel 都要有 source_text
 * (對應原文片段),所以 LLM 把場景描述如「特写: 一个插着...」、
 * 「全景: 餐桌上一片死寂。BRUCE...」、「编号1 ...」也塞進這個欄位,跟真
 * 對話混在一行。我們直接寫 srtSegment 結果 V2 對話框出現一堆敘述。
 *
 * 觀察到的混雜模式(real prod data,project 17b1f037):
 *   ❌ 「特写: 一个插着"45"数字蜡烛的蛋糕被端上桌。CATHERINE: ¡Sorpresa!...」
 *      → 一行內前段是場景敘述,後段才是對話
 *   ❌ 「全景: 餐桌上一片死寂。BRUCE(丈夫)盯着平板...沒人看蛋糕一眼」
 *      → 一行內全是敘述沒真對話(BRUCE 後面是定語不是冒號)
 *   ❌ 「编号3 TOBY 戴着大耳机...」
 *      → 「TOBY」雖是角色名但這裡是「關於 TOBY 的描述」非「TOBY 說的話」
 *   ✅ 「TOBY: Mamá, estás tapando la luz...」
 *      → 標準說話者:對話
 *
 * 抽法 v2 — match-all + 場景詞 denylist:
 *   1. 全文 regex 找出所有 `<說話者>:<內容>` segment(可在一行內多個)
 *   2. 說話者必須是「全大寫拉丁字母 ≥ 2」或「短中文(1-4 字)且不在場景詞 denylist」
 *   3. 抽出後重組為 `說話者: 內容` 換行串接
 *   4. 整段沒命中 → null(留空對話框,讓 user 手動補)
 */
const SCENE_KEYWORDS = new Set<string>([
  '特写', '特寫', '大特写', '大特寫',
  '近景', '中近景', '中景', '全景', '远景', '遠景',
  '空镜', '空鏡', '空镜头', '空鏡頭',
  '俯视', '俯視', '仰视', '仰視', '平视', '平視',
  '正反打', '反打', '过肩', '過肩',
  '航拍', '推拉', '运镜', '運鏡',
  '蒙太奇', '蒙太奇',
  '场景', '場景', '镜头', '鏡頭',
  '描述', '动作', '動作', '画外', '畫外', '画外音', '畫外音',
  '编号', '編號',
])

function isLikelyScenePrefix(speaker: string): boolean {
  const trimmed = speaker.trim()
  if (!trimmed) return true
  // Scene type literal
  if (SCENE_KEYWORDS.has(trimmed)) return true
  // "编号3" / "鏡頭5" / "Shot 7" / "Panel 12"
  if (/^(编号|編號|镜头|鏡頭|场景|場景|Shot|Panel|Scene)\s*\d+/i.test(trimmed)) return true
  // Pure digits like "1" / "01"
  if (/^\d+$/.test(trimmed)) return true
  return false
}

export function extractDialogueFromSourceText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Match candidate `<NAME>:<content>` segments anywhere in the text.
  // NAME = ALL-CAPS Latin (>=2 chars, allows accented chars + spaces) OR
  //        short Chinese block (1-4 chars).
  // Content captured up to the next NAME: or end of string.
  // The 'gus' flags let . cross newlines and a global match find every
  // occurrence so we catch panels with multiple speakers concatenated.
  const SEGMENT_RE = /([A-ZÁÉÍÓÚÑÄÖÜ][A-ZÁÉÍÓÚÑÄÖÜa-zá-ÿ\s']{1,30}|[一-鿿]{1,4})\s*[:：]\s*([\s\S]+?)(?=(?:[A-ZÁÉÍÓÚÑÄÖÜ][A-ZÁÉÍÓÚÑÄÖÜa-zá-ÿ\s']{1,30}|[一-鿿]{1,4})\s*[:：]|$)/gu

  const dialogues: string[] = []
  let m: RegExpExecArray | null
  while ((m = SEGMENT_RE.exec(trimmed)) !== null) {
    const speaker = m[1].trim()
    const content = m[2].trim()
    if (isLikelyScenePrefix(speaker)) continue
    if (!content) continue
    dialogues.push(`${speaker}: ${content}`)
  }
  if (dialogues.length === 0) return null
  return dialogues.join('\n')
}

export function parseEffort(value: unknown): 'minimal' | 'low' | 'medium' | 'high' | null {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') return value
  return null
}

export function parseTemperature(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.7
  return Math.max(0, Math.min(2, value))
}

export function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const n = Math.floor(value)
  return n >= 0 ? n : null
}

function parsePanelCharacters(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 2026-05-04 — Root-cause fix for "panel.characters left empty by LLM".
 *
 * iangyc reported a panel with description `镜头切回洞府内,王玄紧闭着双眼`
 * having panel.characters = [] in DB. trace showed the LLM
 * (agent_storyboard_plan) silently dropped the structured field even
 * though the prompt asks for it. The image-gen worker then had no
 * character ref → AI invented a face → user-uploaded character photo
 * never used.
 *
 * Defensive fallback in collectPanelReferenceImages handles runtime
 * resolution, but every caller path (plus the junction sync loop)
 * also needs the data to be CORRECT in DB so the UI CAST chip rail,
 * EpisodeCharacter junction, downstream variant generation, and any
 * future feature reading panel.characters all see the truth.
 *
 * This helper runs synchronously between LLM output and DB write:
 *
 *   1. Normalize whatever shape the LLM returned (string[],
 *      {name}[], or mixed) into a consistent {name, appearance?}[]
 *   2. Walk the project character roster; for each name not already
 *      present in the list, scan panel.description for a hit (alias-
 *      aware via slash-split). When found, append { name } so the
 *      character makes it into the persisted record.
 *
 * Bounded by 8 to avoid blowing up on dense ensemble novels — that
 * many characters in one shot exceeds Kling's 3-slot cap anyway,
 * so capping here doesn't lose useful refs and keeps the field
 * readable in the UI.
 */
export function enrichPanelCharacters(
  rawCharacters: unknown,
  description: string | null | undefined,
  characterRoster: ReadonlyArray<{ name: string }>,
): Array<{ name: string; appearance?: string }> {
  const normalized: Array<{ name: string; appearance?: string }> = []
  if (Array.isArray(rawCharacters)) {
    for (const item of rawCharacters) {
      if (typeof item === 'string' && item.trim()) {
        normalized.push({ name: item.trim() })
      } else if (item && typeof item === 'object') {
        const candidate = item as { name?: unknown; appearance?: unknown }
        if (typeof candidate.name === 'string' && candidate.name.trim()) {
          normalized.push({
            name: candidate.name.trim(),
            appearance:
              typeof candidate.appearance === 'string' && candidate.appearance.trim()
                ? candidate.appearance.trim()
                : undefined,
          })
        }
      }
    }
  }

  const desc = (description ?? '').trim()
  if (!desc || characterRoster.length === 0) return normalized

  const seen = new Set(normalized.map((c) => c.name))
  for (const character of characterRoster) {
    if (normalized.length >= 8) break
    if (!character.name) continue
    if (seen.has(character.name)) continue
    const aliases = character.name
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
    if (aliases.some((alias) => desc.includes(alias))) {
      normalized.push({ name: character.name })
      seen.add(character.name)
    }
  }
  return normalized
}

export function parseVoiceLinesJson(responseText: string): JsonRecord[] {
  let jsonText = responseText.trim()
  jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
  const firstBracket = jsonText.indexOf('[')
  const lastBracket = jsonText.lastIndexOf(']')
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new Error('voice_analyze: invalid JSON array')
  }
  const parsed = JSON.parse(jsonText.slice(firstBracket, lastBracket + 1))
  if (!Array.isArray(parsed)) {
    throw new Error('voice_analyze: invalid payload')
  }
  return parsed.filter((item): item is JsonRecord => typeof item === 'object' && item !== null)
}

export function asJsonRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null
}

export function buildStoryboardJson(storyboards: PersistedStoryboard[]) {
  const rows: Array<{
    storyboardId: string
    panelIndex: number
    text_segment: string
    description: string
    characters: string[]
  }> = []

  for (const storyboard of storyboards) {
    for (const panel of storyboard.panels) {
      rows.push({
        storyboardId: storyboard.storyboardId,
        panelIndex: panel.panelIndex,
        text_segment: panel.srtSegment || '',
        description: panel.description || '',
        characters: parsePanelCharacters(panel.characters),
      })
    }
  }

  if (rows.length === 0) return '无分镜数据'
  return JSON.stringify(rows, null, 2)
}

export async function persistSingleClipStoryboard(
  projectId: string,
  episodeId: string,
  clipEntry: ClipPanelsResult,
): Promise<PersistedStoryboard | null> {
  return await prisma.$transaction(async (tx) => {
    // 2026-05-01: race-safe atomic replace. Three guarantees:
    //
    // 1) Verify the clip still exists. clips_build may have run in
    //    parallel and replaced the row by the time we get here —
    //    inserting against a missing FK would `Foreign key constraint
    //    violated on (clipId)` (user reported as panels disappearing).
    // 2) Drop the existing storyboard for this clipId so the unique
    //    constraint on clipId doesn't error on insert. Cascade
    //    deletes the panels, multiShotGroup links, etc.
    // 3) Wrap (1)+(2)+create in one transaction so any failure leaves
    //    the previous storyboard intact instead of half-wiped.
    const clipExists = await tx.novelPromotionClip.findUnique({
      where: { id: clipEntry.clipId },
      select: { id: true },
    })
    if (!clipExists) {
      // Skip silently — orchestrator keeps going on other clips; the
      // missing clip's storyboard stays as-is rather than vanishing.
      return null
    }
    await tx.novelPromotionStoryboard.deleteMany({
      where: { clipId: clipEntry.clipId },
    })
    const storyboard = await tx.novelPromotionStoryboard.create({
      data: {
        clipId: clipEntry.clipId,
        episodeId,
        panelCount: clipEntry.finalPanels.length,
      },
      select: { id: true, clipId: true },
    })

    // 2026-05-04 — fetch character roster once per clip so each panel
    // can have description-based name enrichment applied before the
    // DB write. See enrichPanelCharacters for rationale.
    const projectCharacterRoster = await tx.novelPromotionCharacter.findMany({
      where: { novelPromotionProject: { projectId } },
      select: { name: true },
    })

    const persistedPanels: PersistedStoryboard['panels'] = []
    // Phase 11.2: collect names across all panels in this clip for one-shot junction sync.
    const allCharacterNames: string[] = []
    const allLocationNames: string[] = []

    for (let i = 0; i < clipEntry.finalPanels.length; i += 1) {
      const panel = clipEntry.finalPanels[i]
      const enrichedCharacters = enrichPanelCharacters(
        panel.characters,
        typeof panel.description === 'string' ? panel.description : null,
        projectCharacterRoster,
      )
      const created = await tx.novelPromotionPanel.create({
        data: {
          storyboardId: storyboard.id,
          panelIndex: i,
          panelNumber: panel.panel_number || i + 1,
          shotType: panel.shot_type || '中景',
          cameraMove: panel.camera_move || '固定',
          description: panel.description || null,
          videoPrompt: panel.video_prompt || null,
          location: panel.location || null,
          // Always write structured form { name, appearance? }[] so
          // every reader (worker + UI + future features) sees the same
          // shape. Empty array is preserved as null to keep the legacy
          // "no characters" sentinel unchanged.
          characters: enrichedCharacters.length > 0 ? JSON.stringify(enrichedCharacters) : null,
          srtSegment: extractDialogueFromSourceText(panel.source_text || null),
          photographyRules: panel.photographyPlan ? JSON.stringify(panel.photographyPlan) : null,
          actingNotes: panel.actingNotes ? JSON.stringify(panel.actingNotes) : null,
          duration: panel.duration || null,
        },
        select: {
          id: true,
          panelIndex: true,
          description: true,
          srtSegment: true,
          characters: true,
        },
      })
      persistedPanels.push(created)

      // Phase 11.2 junction sync — collect names from the enriched
      // (structured) record so junction creation matches what's
      // actually persisted. Pre-2026-05-04 this loop only handled
      // string[] form and silently skipped {name}[] objects, leaving
      // EpisodeCharacter empty when the LLM returned the structured
      // shape (the documented prompt format).
      for (const c of enrichedCharacters) {
        if (c.name) allCharacterNames.push(c.name)
      }
      if (typeof panel.location === 'string' && panel.location.trim()) {
        allLocationNames.push(panel.location.trim())
      }
    }

    // Phase 11.2: sync junction tables. role='auto-from-panel' so manual rows are not overwritten.
    if (allCharacterNames.length > 0) {
      const uniqueNames = Array.from(new Set(allCharacterNames))
      try {
        await linkEpisodeCharactersFromPanel(tx, {
          projectId,
          episodeId,
          panelCharacterNames: uniqueNames,
          role: 'auto-from-panel',
        })
      } catch (err) {
        logError('[persistSingleClipStoryboard] linkEpisodeCharactersFromPanel failed', {
          projectId,
          episodeId,
          error: err,
        })
        throw err
      }
    }
    for (const locName of Array.from(new Set(allLocationNames))) {
      try {
        await linkEpisodeLocationFromPanel(tx, {
          projectId,
          episodeId,
          locationName: locName,
          role: 'auto-from-panel',
        })
      } catch (err) {
        logError('[persistSingleClipStoryboard] linkEpisodeLocationFromPanel failed', {
          projectId,
          episodeId,
          locationName: locName,
          error: err,
        })
        throw err
      }
    }

    return {
      storyboardId: storyboard.id,
      clipId: storyboard.clipId,
      panels: persistedPanels,
    }
  }, { timeout: 30000 })
}

export async function persistStoryboardsAndPanels(params: {
  projectId: string
  episodeId: string
  clipPanels: ClipPanelsResult[]
}) {
  const { projectId, episodeId, clipPanels } = params
  return await prisma.$transaction(async (tx) => {
    await tx.novelPromotionStoryboard.deleteMany({
      where: { episodeId },
    })

    const persisted: PersistedStoryboard[] = []
    // Phase 11.2: collect names across all panels in all clips for one-shot junction sync per episode.
    const allCharacterNames: string[] = []
    const allLocationNames: string[] = []

    // 2026-05-04 — same roster fetch as persistSingleClipStoryboard so
    // each panel gets description-based name enrichment before write.
    const projectCharacterRoster = await tx.novelPromotionCharacter.findMany({
      where: { novelPromotionProject: { projectId } },
      select: { name: true },
    })

    for (const clipEntry of clipPanels) {
      const storyboard = await tx.novelPromotionStoryboard.create({
        data: {
          clipId: clipEntry.clipId,
          episodeId,
          panelCount: clipEntry.finalPanels.length,
        },
        select: { id: true, clipId: true },
      })

      const persistedPanels: PersistedStoryboard['panels'] = []
      for (let i = 0; i < clipEntry.finalPanels.length; i += 1) {
        const panel = clipEntry.finalPanels[i]
        const enrichedCharacters = enrichPanelCharacters(
          panel.characters,
          typeof panel.description === 'string' ? panel.description : null,
          projectCharacterRoster,
        )
        const created = await tx.novelPromotionPanel.create({
          data: {
            storyboardId: storyboard.id,
            panelIndex: i,
            panelNumber: panel.panel_number || i + 1,
            shotType: panel.shot_type || '中景',
            cameraMove: panel.camera_move || '固定',
            description: panel.description || null,
            videoPrompt: panel.video_prompt || null,
            location: panel.location || null,
            characters: enrichedCharacters.length > 0 ? JSON.stringify(enrichedCharacters) : null,
            srtSegment: extractDialogueFromSourceText(panel.source_text || null),
            photographyRules: panel.photographyPlan ? JSON.stringify(panel.photographyPlan) : null,
            actingNotes: panel.actingNotes ? JSON.stringify(panel.actingNotes) : null,
            duration: panel.duration || null,
          },
          select: {
            id: true,
            panelIndex: true,
            description: true,
            srtSegment: true,
            characters: true,
          },
        })
        persistedPanels.push(created)

        // Same junction-sync fix as persistSingleClipStoryboard:
        // collect from the enriched structured record, not the
        // raw LLM output that may be {name}[] which the old
        // string-only loop silently skipped.
        for (const c of enrichedCharacters) {
          if (c.name) allCharacterNames.push(c.name)
        }
        if (typeof panel.location === 'string' && panel.location.trim()) {
          allLocationNames.push(panel.location.trim())
        }
      }

      persisted.push({
        storyboardId: storyboard.id,
        clipId: storyboard.clipId,
        panels: persistedPanels,
      })
    }

    // Phase 11.2: sync junction tables.
    if (allCharacterNames.length > 0) {
      const uniqueNames = Array.from(new Set(allCharacterNames))
      try {
        await linkEpisodeCharactersFromPanel(tx, {
          projectId,
          episodeId,
          panelCharacterNames: uniqueNames,
          role: 'auto-from-panel',
        })
      } catch (err) {
        logError('[persistStoryboardsAndPanels] linkEpisodeCharactersFromPanel failed', {
          projectId,
          episodeId,
          error: err,
        })
        throw err
      }
    }
    for (const locName of Array.from(new Set(allLocationNames))) {
      try {
        await linkEpisodeLocationFromPanel(tx, {
          projectId,
          episodeId,
          locationName: locName,
          role: 'auto-from-panel',
        })
      } catch (err) {
        logError('[persistStoryboardsAndPanels] linkEpisodeLocationFromPanel failed', {
          projectId,
          episodeId,
          locationName: locName,
          error: err,
        })
        throw err
      }
    }

    return persisted
  }, { timeout: 60000 })
}

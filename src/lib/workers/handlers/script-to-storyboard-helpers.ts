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
): Promise<PersistedStoryboard> {
  return await prisma.$transaction(async (tx) => {
    const storyboard = await tx.novelPromotionStoryboard.create({
      data: {
        clipId: clipEntry.clipId,
        episodeId,
        panelCount: clipEntry.finalPanels.length,
      },
      select: { id: true, clipId: true },
    })

    const persistedPanels: PersistedStoryboard['panels'] = []
    // Phase 11.2: collect names across all panels in this clip for one-shot junction sync.
    const allCharacterNames: string[] = []
    const allLocationNames: string[] = []

    for (let i = 0; i < clipEntry.finalPanels.length; i += 1) {
      const panel = clipEntry.finalPanels[i]
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
          characters: panel.characters ? JSON.stringify(panel.characters) : null,
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

      // Collect for junction sync (Phase 11.2). panel.characters is already a string[] here.
      if (Array.isArray(panel.characters)) {
        for (const name of panel.characters) {
          if (typeof name === 'string' && name.trim()) allCharacterNames.push(name.trim())
        }
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
            characters: panel.characters ? JSON.stringify(panel.characters) : null,
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

        if (Array.isArray(panel.characters)) {
          for (const name of panel.characters) {
            if (typeof name === 'string' && name.trim()) allCharacterNames.push(name.trim())
          }
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

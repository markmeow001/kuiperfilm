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
 * (對應原文片段),所以 LLM 把場景描述如「编号1 特写: 一个插着...」也塞進
 * 這個欄位。我們把整個 source_text 寫進 srtSegment 後,UI 上 SHOT 01 對話框
 * 就出現了「编号1 特写: ...」這種敘述,user 抗議「這不是對話」。
 *
 * 觀察到的兩種模式:
 *   ❌ 描述行:以「编号N」/「鏡頭N」開頭 + 含 \t scene header
 *   ✅ 對話行:以說話者名字 + 「:」開頭(NAME: / 中文角色名:)
 *
 * 抽法:
 *   1. 拆 newlines
 *   2. 找出符合「<說話者>: <內容>」格式的行
 *   3. 全部都符合或都不符合 → 整段傳回 / null
 *   4. 部分符合 → 只保留對話行(混合 description+dialogue 的 panel)
 *
 * 嚴格 conservative — 寧可漏抽留 null 讓 user 手動補對話,也不要把場景敘述
 * 當成對話塞進 srtSegment 干擾 voice analyze TTS。
 */
export function extractDialogueFromSourceText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const SPEAKER_PREFIX = /^([A-ZÁÉÍÓÚÑÄÖÜ一-鿿][A-Za-zÁ-ÿ一-鿿·\s']{0,30})\s*[:：](.+)$/u
  const dialogueLines = lines.filter((line) => SPEAKER_PREFIX.test(line))
  if (dialogueLines.length === 0) return null
  // Strip "编号N" or "鏡頭N" / scene-header artefacts from the captured
  // dialogue lines just in case the LLM concatenated them onto the same
  // line (e.g. "编号3 TOBY: ..." — keep only the TOBY: bit).
  const cleaned = dialogueLines.map((line) => {
    const match = line.match(SPEAKER_PREFIX)
    if (!match) return line
    const speaker = match[1].replace(/^(编号|編號|镜头|鏡頭|Shot|Panel)\s*\d+\s*/i, '').trim()
    const content = match[2].trim()
    return speaker ? `${speaker}: ${content}` : content
  })
  return cleaned.join('\n')
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

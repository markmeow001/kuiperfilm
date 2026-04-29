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
          srtSegment: panel.source_text || null,
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
            srtSegment: panel.source_text || null,
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

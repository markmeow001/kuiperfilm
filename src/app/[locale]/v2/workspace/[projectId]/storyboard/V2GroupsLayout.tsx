'use client'

/**
 * Phase 12.5.4 — Groups layout for the multi-shot B-path workflow.
 *
 * The gallery / timeline layouts are panel-centric: each card shows a
 * generated panel image and lets the user iterate on it. That mental
 * model makes sense when the video model is image-to-video (KieAI,
 * Kling-2.x i2v) — the panel image IS the first frame.
 *
 * Kling-3 / Kling-Omni / Kling-O1 are text-to-video with
 * SubjectInfos.N strong identity binding. There is no panel-level
 * image at all — the model generates a 5-15s multi-shot video per
 * group directly from the script + character/scene reference images.
 * Showing empty 9:16 image placeholders in that mode is misleading
 * and the per-panel "regenerate image" affordance is meaningless.
 *
 * This layout flips the unit from panel → group:
 *   - One card per multiShotGroup
 *   - Each card embeds the multi-shot video player + binding chips
 *   - Per-panel descriptions stack inside the card (read-only in
 *     commit 1; editable in commit 2; with character/scene override
 *     pickers in commit 3)
 *
 * It only ships behind a layoutMode toggle. The parent decides when
 * to default to 'groups' (currently: when videoModel matches the
 * B-path regex) but the user can flip back to gallery / timeline.
 */

import { useMemo } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { GroupCard, type GroupRegenOverrides } from './GroupCard'
import type { UseMutationResult } from '@tanstack/react-query'

interface PanelCharacterRef {
  name: string
  appearance?: string
}

interface PanelLike {
  id: string
  panelIndex?: number | null
  description?: string | null
  prompt?: string | null
  srtSegment?: string | null
  // Decoded server-side; see storyboards API route.
  characters?: PanelCharacterRef[] | null
  location?: string | null
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
}

type UpdatePanelTextMutation = UseMutationResult<
  unknown,
  Error,
  {
    panelId: string
    description?: string
    srtSegment?: string
    /** See useUpdatePanelText — used by the chip × remove flow. */
    characters?: Array<{ name: string; appearance?: string }> | string | null
    /** Used by the 場景 chip × remove flow. */
    location?: string | null
  }
>

interface CharacterRosterEntry {
  id: string
  name: string
  appearances?: Array<{
    id: string
    appearanceIndex?: number
    changeReason?: string | null
    description?: string | null
    imageUrl?: string | null
  }>
}

interface LocationRosterEntry {
  id: string
  name: string
  images?: Array<{
    id: string
    imageIndex?: number
    description?: string | null
    imageUrl?: string | null
    viewName?: string | null
  }>
}

interface V2GroupsLayoutProps {
  projectId: string
  panels: PanelLike[]
  orderedGroupIds: string[]
  taskByGroup: Record<string, string>
  toolbarNode: React.ReactNode
  emptyHint?: React.ReactNode
  updatePanelText: UpdatePanelTextMutation
  characterRoster?: CharacterRosterEntry[]
  locationRoster?: LocationRosterEntry[]
  /**
   * Per-episode character → appearance binding. The worker uses this to
   * override panel.characters[i].appearance, so the chip rail must mirror
   * the same resolution priority or 出場角色 and 演員綁定 visibly diverge
   * (user-reported 2026-05-13).
   */
  episodeBindings?: Array<{ characterId: string; appearanceId: string | null }>
  /** Used for download filename naming (`ep{N}_group{NN}.mp4`). */
  episodeNumber?: number | null
  onRegenerateGroup: (
    groupId: string,
    panelIds: string[],
    overrides: GroupRegenOverrides,
  ) => Promise<{ taskId: string | null; error?: string }>
}

const GROUP_ACCENTS = [
  'border-l-amber-500',
  'border-l-rose-500',
  'border-l-emerald-500',
  'border-l-sky-500',
  'border-l-violet-500',
  'border-l-orange-500',
] as const

function accentForOrdinal(ordinal: number): string {
  return GROUP_ACCENTS[ordinal % GROUP_ACCENTS.length]
}

export function V2GroupsLayout({
  projectId,
  panels,
  orderedGroupIds,
  taskByGroup,
  toolbarNode,
  emptyHint,
  updatePanelText,
  characterRoster,
  locationRoster,
  episodeBindings,
  episodeNumber,
  onRegenerateGroup,
}: V2GroupsLayoutProps) {
  const groups = useMemo(() => {
    const byGroupId = new Map<string, PanelLike[]>()
    const ungrouped: PanelLike[] = []
    for (const p of panels) {
      if (p.multiShotGroupId) {
        const list = byGroupId.get(p.multiShotGroupId) ?? []
        list.push(p)
        byGroupId.set(p.multiShotGroupId, list)
      } else {
        ungrouped.push(p)
      }
    }
    const ordered = orderedGroupIds
      .map((groupId) => ({
        groupId,
        panels: (byGroupId.get(groupId) ?? [])
          .slice()
          .sort((a, b) => (a.multiShotGroupOrder ?? 0) - (b.multiShotGroupOrder ?? 0)),
      }))
      .filter((g) => g.panels.length > 0)
    return { ordered, ungrouped }
  }, [panels, orderedGroupIds])

  const hasNoGroups = groups.ordered.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-amber-900/15 px-8 pb-3 pt-5">
        {toolbarNode}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {hasNoGroups ? (
          <div className="rounded-sm border border-amber-500/20 bg-amber-500/5 px-6 py-8 text-center">
            <p className="font-fraunces text-base italic text-amber-400">
              還沒有切組 — 先點上方「自動切組」讓 LLM 把分鏡分成多鏡頭群,然後就能一次出影片
            </p>
            {emptyHint ? <div className="mt-4">{emptyHint}</div> : null}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.ordered.map((g, idx) => {
              const taskId = taskByGroup[g.groupId] ?? null
              const ordinal = idx + 1
              const accent = accentForOrdinal(idx)
              const groupLabel = `GROUP ${String(ordinal).padStart(2, '0')}`
              return (
                <GroupCard
                  key={g.groupId}
                  groupId={g.groupId}
                  groupOrdinal={ordinal}
                  groupLabel={groupLabel}
                  accentClass={accent}
                  panels={g.panels}
                  taskId={taskId}
                  projectId={projectId}
                  updatePanelText={updatePanelText}
                  characterRoster={characterRoster}
                  locationRoster={locationRoster}
                  episodeBindings={episodeBindings}
                  episodeNumber={episodeNumber}
                  onRegenerate={(panelIds, overrides) =>
                    onRegenerateGroup(g.groupId, panelIds, overrides)
                  }
                />
              )
            })}

            {groups.ungrouped.length > 0 ? (
              <div className="rounded-sm border border-stone-800/60 bg-stone-900/20 px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <AppIcon name="sparklesAlt" className="h-3 w-3 text-stone-500" />
                  <div className="font-mono text-[12px] uppercase tracking-wider text-stone-500">
                    未切組 · {groups.ungrouped.length} 鏡
                  </div>
                </div>
                <p className="font-serif-cn text-[11px] italic text-stone-500">
                  這些分鏡尚未指派到 multi-shot group。再跑一次「自動切組」可以把它們納入。
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

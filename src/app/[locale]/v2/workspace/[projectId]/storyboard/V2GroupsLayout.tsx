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
import { computeGroupRecommendedDurationSec } from '@/lib/workers/handlers/speech-duration-estimator'
import type { UseMutationResult } from '@tanstack/react-query'
import type { VideoFamily, PanelLike } from './storyboard-client-helpers'

// PanelLike + PanelCharacterRef now live in storyboard-client-helpers as the
// single shared declaration (2026-07-01 — three-way unification; GroupCard's
// voiceLines field was lifted up so all three consumers share one type).

export type UpdatePanelTextMutation = UseMutationResult<
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
    /** Group narrative draft on the FIRST panel — 保存敘事 real persistence (2026-07-13). */
    groupNarrative?: string | null
    /** 時長 pick for the group (null = Auto, 2026-07-13). */
    groupDurationSec?: number | null
  }
>

export interface CharacterRosterEntry {
  id: string
  name: string
  // LLM-authored dubbing voice/timbre (gender + voice qualities), surfaced
  // from profileData.voice_description by the assets API. Threaded to
  // GroupCard so the Seedance narrative can characterize each speaker's TTS.
  voiceDescription?: string | null
  appearances?: Array<{
    id: string
    appearanceIndex?: number
    changeReason?: string | null
    description?: string | null
    imageUrl?: string | null
  }>
}

export interface LocationRosterEntry {
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
  /** Threads the project-level capability gate down to each GroupCard
   *  so the per-group CTAs grey out in sync with the picker. */
  canMultiShot?: boolean
  /** 2026-05-17 — Family-aware CTA wording. Kling = batch multi-shot
   *  (N stitched clips), Seedance = composite (1 video, 9-ref @N). The
   *  GroupCard CTA label must match what the worker produces. */
  videoFamily?: VideoFamily
  /**
   * 2026-05-18 — pass-through of NovelPromotionProject.visualStyleId.
   * GroupCard's Seedance narrative builder uses it to inject styleAnchor +
   * visualModifiers (and feeds the negativePrompt path on the worker side).
   * Per-group picker overrides this.
   */
  projectVisualStyleId?: string | null
  /** Phase 12.5 — passed through to GroupCard so viewer-role users see
   *  disabled mutation buttons in each group card. */
  canEdit?: boolean
  viewerTip?: string
  /**
   * 2026-05-22 — project.targetDuration in seconds, threaded down so the
   * cumulative time-range badge + each group's "Auto (推薦 Ns)" hint know
   * how to allocate per-group share. Without this, silent groups default
   * to 10s and undershoot the project target by ~50% (《迁徙》ep3 hit
   * 95s for a 180s target). When null, callers preserve legacy behavior.
   */
  targetDurationSec?: number | null
  /** Phase S (2026-05-27) — storyboardId → already-signed referenceVideoUrl
   *  lookup. GroupCard uses `panels[0]?.storyboardId` to derive which entry
   *  to consume. Each group has its own reference video; this map covers
   *  every storyboard in the current episode. */
  referenceVideoByStoryboardId?: Record<string, string | null>
  /** Phase S — used by the upload mutation + cache invalidation. */
  episodeId?: string | null
  onRegenerateGroup: (
    groupId: string,
    panelIds: string[],
    overrides: GroupRegenOverrides,
  ) => Promise<GroupRegenSubmitResult>
}

// Phase 1 step 3 (2026-06-21) — extracted to a named export so the
// layout sibling (V2StoryboardGroupsView) can use the real type
// instead of mirroring its own SubmitResult interface.
export type GroupRegenSubmitResult = {
  taskId: string | null
  error?: string
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
  canMultiShot = true,
  videoFamily = null,
  projectVisualStyleId = null,
  canEdit = true,
  viewerTip,
  targetDurationSec = null,
  referenceVideoByStoryboardId,
  episodeId = null,
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

  // Per-group recommended duration + cumulative start offset for the
  // time-range badge in each GroupCard header. Calling the shared
  // helper here keeps a single source of truth — GroupCard's own
  // "Auto (推薦 Ns)" hint uses the same function, so the badge,
  // the dropdown hint, and the worker's actual output all agree.
  //
  // Cumulative start = sum of previous groups' durations. Each group
  // gets `segmentStartSec` (its own absolute offset) +
  // `segmentDurationSeconds` (its own recommended length). GroupCard
  // renders `formatTimeRange(start, start + duration)` from these.
  //
  // Phase Q follow-up: when a group has been manually overridden
  // (totalDurationDraft > 0, currently local state) the badge here
  // can drift. The header label is read-only and far from the
  // dropdown so the drift isn't disorienting; lifting that state
  // up is a separate change.
  // 2026-05-22 — when projectVisualStyleId carries a targetDuration, split
  // it evenly across visible groups as a per-group floor. Silent groups
  // then default to the user's intended share instead of a flat 10s; dense
  // groups still grow via the panel*2.5 floor inside the helper. Both
  // floors stay capped at 15s for Seedance per-call limits.
  const targetSecPerGroup = useMemo<number | null>(() => {
    if (typeof targetDurationSec !== 'number' || !Number.isFinite(targetDurationSec)) return null
    if (groups.ordered.length === 0) return null
    return targetDurationSec / groups.ordered.length
  }, [targetDurationSec, groups.ordered.length])

  const groupTimings = useMemo(() => {
    const FALLBACK = 15
    const result: Array<{ groupId: string; startSec: number; durationSec: number }> = []
    let cursor = 0
    for (const g of groups.ordered) {
      const durationSec =
        computeGroupRecommendedDurationSec(g.panels, { targetSecPerGroup }) ?? FALLBACK
      result.push({ groupId: g.groupId, startSec: cursor, durationSec })
      cursor += durationSec
    }
    return result
  }, [groups.ordered, targetSecPerGroup])

  // 2026-05-22 — total recommended duration across all groups. When it
  // undershoots the project target by >15% surface an amber banner so
  // the user knows to either add more panels (重新分析) or raise per-group
  // sec manually. Without this, users see a 95s storyboard for a 180s
  // target with no signal that something's off.
  const cumulativeDurationSec = useMemo(
    () => groupTimings.reduce((sum, g) => sum + g.durationSec, 0),
    [groupTimings],
  )
  const durationShortfall = useMemo(() => {
    if (typeof targetDurationSec !== 'number' || !Number.isFinite(targetDurationSec)) return null
    if (targetDurationSec <= 0) return null
    if (cumulativeDurationSec <= 0) return null
    const ratio = cumulativeDurationSec / targetDurationSec
    if (ratio >= 0.85) return null
    return {
      cumulativeSec: cumulativeDurationSec,
      targetSec: targetDurationSec,
      ratio,
    }
  }, [cumulativeDurationSec, targetDurationSec])

  const hasNoGroups = groups.ordered.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-amber-900/15 px-8 pb-3 pt-5">
        {toolbarNode}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {durationShortfall ? (
          <div className="mb-4 rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <p className="font-fraunces text-sm text-amber-300">
              ⚠ 總時長 {Math.round(durationShortfall.cumulativeSec)}s / 目標{' '}
              {Math.round(durationShortfall.targetSec)}s（
              {Math.round(durationShortfall.ratio * 100)}%）— 多鏡頭合成出來會比劇本短。
            </p>
            <p className="mt-1 text-xs text-amber-200/80">
              修法選一：(a) 點「重新分析」讓分鏡 LLM 給出更多 panel；(b) 手動拉開每組「時長」下拉到 15s；(c) 把專案目標時長改短。
            </p>
          </div>
        ) : null}
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
              const timing = groupTimings[idx]
              const groupStoryboardId = g.panels[0]?.storyboardId ?? null
              const groupReferenceVideoUrl =
                groupStoryboardId && referenceVideoByStoryboardId
                  ? referenceVideoByStoryboardId[groupStoryboardId] ?? null
                  : null
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
                  segmentStartSec={timing?.startSec}
                  segmentDurationSeconds={timing?.durationSec}
                  targetSecPerGroup={targetSecPerGroup}
                  episodeNumber={episodeNumber}
                  canMultiShot={canMultiShot}
                  videoFamily={videoFamily}
                  projectVisualStyleId={projectVisualStyleId}
                  canEdit={canEdit}
                  viewerTip={viewerTip}
                  groupStoryboardId={groupStoryboardId}
                  groupReferenceVideoUrl={groupReferenceVideoUrl}
                  episodeId={episodeId}
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

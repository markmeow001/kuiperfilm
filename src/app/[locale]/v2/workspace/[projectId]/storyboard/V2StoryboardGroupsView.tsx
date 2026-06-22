'use client'

/**
 * Phase 1 step 2 (2026-06-21) — Groups-layout view extracted out of
 * V2StoryboardClient.
 *
 * Step 1 hoisted pure leaves (helpers, types, PromptChipGroup). Step 2
 * starts on the state-coupled extractions the step-1 commit explicitly
 * deferred. The Groups branch is the smallest of the three layout
 * branches (~245 lines vs Gallery ~380 / Timeline ~950) and is the
 * lowest-risk first cut for the state-coupled phase.
 *
 * Boundary:
 *   - This file OWNS the 3-row groups toolbar JSX + the wrapper around
 *     V2GroupsLayout (already a sibling).
 *   - It owns the per-group async submit callback (`onRegenerateGroup`-
 *     equivalent) so V2StoryboardClient no longer carries that inline.
 *   - Parent (V2StoryboardClient) owns shared state + handlers and
 *     hands them in via the props interface below.
 *
 * Behavior must be 100% unchanged from the inline branch. Verified by
 * tsc + a manual UI check (switch layoutMode to 'groups' and confirm
 * the toolbar + grid + multi-shot flow look + behave identically).
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  V2GroupsLayout,
  type UpdatePanelTextMutation,
  type CharacterRosterEntry,
  type LocationRosterEntry,
} from './V2GroupsLayout'
import { isMultiShotCapable } from '@/lib/video-models/variants'
import type { PanelLike, MultiShotState } from './storyboard-client-helpers'
import type { AutoGroupResult } from '@/lib/query/mutations/auto-group-multi-shot-mutation'
import type { GroupRegenOverrides } from './GroupCard'

// Phase 1 step 3 (2026-06-21) — type-import convention applied.
// Siblings NEVER re-declare types; they import from the owner module.
// Replaced step 2's placeholder `AutoGroupMutationLike` / `OverridesPayload` /
// `SubmitResult` with the real types from the source modules.

// Mirrors V2GroupsLayout's `videoFamily` typing exactly so the prop
// forwards cleanly (V2GroupsLayout's own field is inlined as a union;
// shared declaration would need a fresh shared types module — not worth
// it for two call sites, so we declare it parallel-shaped here).
type VideoFamily = 'kling' | 'seedance' | null

// Per-episode character → appearance binding type matches V2GroupsLayout.
interface EpisodeBinding {
  characterId: string
  appearanceId: string | null
}

export interface V2StoryboardGroupsViewProps {
  // ── Identity / project shape ──
  projectId: string
  currentEpisodeId: string | null
  episodeNumber: number | null
  projectVideoModel: string
  projectVideoRatio: string
  projectVideoResolution: '480p' | '720p' | '1080p'
  projectVisualStyleId: string | null
  targetDurationSec: number | null
  canMultiShot: boolean
  videoFamily: VideoFamily

  // ── Permission / hint ──
  canEdit: boolean
  viewerTip: string | undefined

  // ── Shared overlay (modals + cleanup dialog rendered in parent) ──
  globalOverlaysNode: ReactNode

  // ── Toolbar shared nodes (computed in parent so all 3 layouts reuse) ──
  layoutToggleNode: ReactNode
  videoModelPickerNode: ReactNode

  // ── Toolbar state + handlers ──
  manualPanelSubmitting: boolean
  onManualPanelOpen: () => void
  analyzeBusy: boolean
  analyzeBusyLabel: string
  onAnalyzeStoryboard: () => void
  onStaleCleanupOpen: () => void
  autoGroup: UseMutationResult<AutoGroupResult, Error, { episodeId: string }>
  multiShotState: MultiShotState
  onSubmitMultiShot: () => void

  // ── Panel + group data ──
  allPanels: PanelLike[]
  orderedGroupIds: string[]
  groupedPanelCount: number
  hasGroups: boolean

  // ── Per-group regen state ──
  taskByGroup: Record<string, string>
  setTaskByGroup: Dispatch<SetStateAction<Record<string, string>>>
  referenceVideoByStoryboardId: Record<string, string | null>

  // ── Forwarded directly to V2GroupsLayout ──
  updatePanelText: UpdatePanelTextMutation
  characterRoster: CharacterRosterEntry[]
  locationRoster: LocationRosterEntry[]
  episodeBindings: EpisodeBinding[]

  // ── Multi-shot submit toggle ──
  soundEnabled: boolean
}

export function V2StoryboardGroupsView(props: V2StoryboardGroupsViewProps) {
  const t = useTranslations('v2Storyboard')
  const {
    projectId,
    currentEpisodeId,
    episodeNumber,
    projectVideoModel,
    projectVideoRatio,
    projectVideoResolution,
    projectVisualStyleId,
    targetDurationSec,
    canMultiShot,
    videoFamily,
    canEdit,
    viewerTip,
    globalOverlaysNode,
    layoutToggleNode,
    videoModelPickerNode,
    manualPanelSubmitting,
    onManualPanelOpen,
    analyzeBusy,
    analyzeBusyLabel,
    onAnalyzeStoryboard,
    onStaleCleanupOpen,
    autoGroup,
    multiShotState,
    onSubmitMultiShot,
    allPanels,
    orderedGroupIds,
    groupedPanelCount,
    hasGroups,
    taskByGroup,
    setTaskByGroup,
    referenceVideoByStoryboardId,
    updatePanelText,
    characterRoster,
    locationRoster,
    episodeBindings,
    soundEnabled,
  } = props

  // 2026-05-18 — toolbar reorganized into 3 rows so 16+ elements aren't
  // crammed into one line. Old layout was visually exhausting + the
  // primary CTA (多鏡頭合成) competed for attention with secondary
  // affordances. New rows:
  //   1. Layout toggle  (right-aligned, identity only)
  //   2. State + video model picker (state row, no actions here)
  //   3. Actions split into two clusters:
  //        LEFT  — data ops (new / re-analyse / cleanup) — muted stone
  //        RIGHT — workflow ops (auto-group / composite) — accent
  //        Primary CTA "多鏡頭合成" sits at the far right with stronger
  //        visual weight (filled bg, brighter border) so the eye lands
  //        on the next step.
  const groupsToolbar = (
    <div className="flex flex-col gap-3">
      {/* Row 1: layout toggle */}
      <div className="flex justify-end">{layoutToggleNode}</div>

      {/* Row 2: state badge + video model picker (wraps on narrow screens) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {hasGroups ? (
          <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-emerald-400">
            ◷ {t('header.groupSummary', { groups: orderedGroupIds.length, grouped: groupedPanelCount, total: allPanels.length })}
          </span>
        ) : null}
        {videoModelPickerNode}
      </div>

      {/* Row 3: actions, split into data ops (left) + workflow ops (right) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* LEFT cluster — data ops (muted stone style, secondary) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!currentEpisodeId || manualPanelSubmitting}
            onClick={onManualPanelOpen}
            title={t('buttons.manualAddTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-stone-700 bg-stone-900/50 px-3 py-1.5 font-mono text-[13px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="plus" className="h-3 w-3" />
            {t('buttons.manualAdd')}
          </button>
          <button
            type="button"
            disabled={analyzeBusy || !currentEpisodeId || !canEdit}
            onClick={onAnalyzeStoryboard}
            title={t('buttons.regenerateStoryboardTitle')}
            className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-mono text-[13px] tracking-wider transition-all disabled:cursor-not-allowed ${
              analyzeBusy
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                : 'border-stone-700 bg-stone-900/50 text-stone-300 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300 disabled:opacity-50'
            }`}
          >
            <AppIcon name="sparklesAlt" className={`h-3 w-3 ${analyzeBusy ? 'animate-pulse' : ''}`} />
            {analyzeBusyLabel}
          </button>
          <button
            type="button"
            disabled={!currentEpisodeId}
            onClick={onStaleCleanupOpen}
            title={t('buttons.cleanupSourceTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-stone-700 bg-stone-900/50 px-3 py-1.5 font-mono text-[13px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('buttons.cleanupSource')}
          </button>
        </div>

        {/* RIGHT cluster — workflow ops; 自動切組 violet (prep), 多鏡頭合成 amber filled (primary CTA) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            // 2026-05-21 — also disable while analyzeBusy so user doesn't
            // trigger 自動切組 against an incomplete panel list (script
            // analysis at 65% means more panels are still arriving — LLM
            // would group only the ones persisted so far → user has to
            // re-group after analysis finishes anyway).
            disabled={autoGroup.isPending || !currentEpisodeId || allPanels.length < 2 || analyzeBusy || !canEdit}
            onClick={() => autoGroup.mutate({ episodeId: currentEpisodeId! })}
            title={
              analyzeBusy
                ? t('multiShot.tipScriptAnalyzing')
                : autoGroup.isPending
                  ? t('buttons.splitting')
                  : t('multiShot.tipSplitDetail')
            }
            className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[13px] tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className="h-3 w-3" />
            {autoGroup.isPending ? t('buttons.splitting') : analyzeBusy ? t('buttons.splitWhileAnalyzing') : t('buttons.autoSplit')}
          </button>
          <button
            type="button"
            disabled={multiShotState.status === 'submitting' || !canMultiShot}
            onClick={onSubmitMultiShot}
            title={
              !canMultiShot
                ? t('multiShot.tipCurrentModelNotMultiShot')
                : videoFamily === 'seedance'
                  ? t('multiShot.tipSeedancePerGroup')
                  : t('multiShot.tipKlingMultiShot')
            }
            className="flex items-center gap-1.5 rounded-sm border border-amber-500/60 bg-amber-500/25 px-3.5 py-1.5 font-mono text-[14px] font-semibold tracking-wider text-amber-100 shadow-sm shadow-amber-500/10 transition-all hover:border-amber-400 hover:bg-amber-500/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
            {multiShotState.status === 'submitting'
              ? t('buttons.sendingMultiShot', { sent: multiShotState.sent, total: multiShotState.total })
              : videoFamily === 'seedance'
                ? t('buttons.multiShotComposite')
                : t('buttons.smartMultiShot')}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {globalOverlaysNode}
      <V2GroupsLayout
        projectId={projectId}
        panels={allPanels}
        orderedGroupIds={orderedGroupIds}
        taskByGroup={taskByGroup}
        toolbarNode={groupsToolbar}
        updatePanelText={updatePanelText}
        characterRoster={characterRoster}
        locationRoster={locationRoster}
        episodeBindings={episodeBindings}
        episodeNumber={episodeNumber}
        canMultiShot={canMultiShot}
        videoFamily={videoFamily}
        projectVisualStyleId={projectVisualStyleId}
        canEdit={canEdit}
        viewerTip={viewerTip}
        targetDurationSec={targetDurationSec}
        episodeId={currentEpisodeId}
        referenceVideoByStoryboardId={referenceVideoByStoryboardId}
        onRegenerateGroup={async (groupId, panelIds, overrides: GroupRegenOverrides) => {
          if (!projectVideoModel) {
            return { taskId: null, error: t('errors.modelNotMultiShotShort') }
          }
          // 2026-05-17 — use the variant registry's capability bit so this
          // gate stays in sync with the inline picker + handleSubmitMultiShot.
          // Fails closed for unknown ids (legacy DB rows).
          if (!isMultiShotCapable(projectVideoModel)) {
            return {
              taskId: null,
              error: t('errors.modelNotMultiShot', { model: projectVideoModel }),
            }
          }
          try {
            const body: Record<string, unknown> = {
              panelIds,
              videoModel: projectVideoModel,
              aspectRatio: projectVideoRatio,
              resolution: projectVideoResolution,
              sound: soundEnabled,
              async: true,
              meta: { locale: 'zh-TW' },
            }
            if (overrides.characterOverrides.length > 0) {
              body.characterOverrides = overrides.characterOverrides
            }
            if (overrides.locationOverrides.length > 0) {
              body.locationOverrides = overrides.locationOverrides
            }
            // Phase 2 segment-level overrides — flow through to the
            // multi-shot API contract Session A defined.
            if (overrides.rawPrompt && overrides.rawPrompt.length > 0) {
              body.rawPrompt = overrides.rawPrompt
            }
            if (
              Array.isArray(overrides.panelDurations)
              && overrides.panelDurations.length === panelIds.length
            ) {
              body.panelDurations = overrides.panelDurations
            }
            // Phase P (2026-05-21) — totalDurationSeconds atomic field.
            // Forwarded EVEN WHEN panelDurations is omitted (sendRaw path).
            // Workers use as tier-1.5 fallback so user's 15s pick survives
            // the narrative-edit gate.
            if (
              typeof overrides.totalDurationSeconds === 'number'
              && Number.isFinite(overrides.totalDurationSeconds)
              && overrides.totalDurationSeconds > 0
            ) {
              body.totalDurationSeconds = overrides.totalDurationSeconds
            }
            // 2026-05-13 — Option B 首幀鎖定. When set, worker switches
            // to Kling 3.0 i2v single-shot path and drops multi_shot.
            if (overrides.firstFrameImageUrl) {
              body.firstFrameImageUrl = overrides.firstFrameImageUrl
            }
            if (overrides.lastFrameImageUrl) {
              body.lastFrameImageUrl = overrides.lastFrameImageUrl
            }
            const res = await fetch(
              `/api/novel-promotion/${projectId}/generate-multi-shot-video`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              },
            )
            if (!res.ok) {
              let errMessage = t('errors.sendFailedHttp', { status: res.status })
              try {
                const errBody = await res.json()
                if (errBody && typeof errBody.message === 'string') errMessage = errBody.message
                else if (errBody?.error?.code) errMessage = t('errors.sendFailedCode', { code: errBody.error.code })
              } catch {
                // body not JSON — keep status fallback
              }
              return { taskId: null, error: errMessage }
            }
            const respBody = (await res.json()) as { taskId?: unknown }
            const taskId = typeof respBody?.taskId === 'string' && respBody.taskId.length > 0
              ? respBody.taskId
              : null
            if (taskId) {
              setTaskByGroup((prev) => ({ ...prev, [groupId]: taskId }))
            }
            return { taskId }
          } catch (err) {
            return {
              taskId: null,
              error: err instanceof Error ? err.message : t('errors.submitFailedGeneric'),
            }
          }
        }}
      />
    </>
  )
}

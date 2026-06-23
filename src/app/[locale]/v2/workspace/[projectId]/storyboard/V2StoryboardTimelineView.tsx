'use client'

/**
 * Phase 1 step 4 (2026-06-22) — Timeline-layout view: outer shell.
 *
 * Third of three layout-branch extractions (Groups shipped in step 2,
 * Gallery in step 3). Timeline's shape isn't linear like the other
 * two — it has 4 distinct UI areas + a zoom modal overlay. Rather
 * than mirror step 2/3's "one monolith sibling" pattern (which would
 * have produced a 60-70 prop sibling, per PR #16 reviewer L-1
 * warning), this view orchestrates 4 flat sub-views:
 *
 *   - V2StoryboardTimelineStrip      (top: toolbar + panel strip)
 *   - V2StoryboardTimelineText       (middle: text/dialogue editors)
 *   - V2StoryboardTimelineShot       (left: selected shot preview + CTAs)
 *   - V2StoryboardTimelineInspector  (right: cast / notes / multi-shot rail)
 *
 * THIS file is PLUMBING ONLY (reviewer Q1 qualify). No derived
 * computations — all derived values (eligibleForVideo, missingImages,
 * failedPanelImageIds, selectedIndex, selectedMediaDisplayMode, etc.)
 * are computed in V2StoryboardClient and flow down as already-resolved
 * props. This view's job is just to pick which sub-view gets which
 * slice of props.
 *
 * Zoom modal stays in this outer view because it's a portal-style
 * sibling of the 3-column grid, not part of any column.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import {
  V2StoryboardTimelineStrip,
} from './V2StoryboardTimelineStrip'
import {
  V2StoryboardTimelineText,
} from './V2StoryboardTimelineText'
import {
  V2StoryboardTimelineShot,
} from './V2StoryboardTimelineShot'
import {
  V2StoryboardTimelineInspector,
} from './V2StoryboardTimelineInspector'
import type {
  PanelLike,
  ProjectLikeFull,
  MultiShotState,
  AnalyzeState,
  MediaDisplayMode,
  VideoFamily,
  FailedTaskMeta,
  EpisodeBinding,
  EpisodeWithNumber,
} from './storyboard-client-helpers'
import type {
  UpdatePanelTextMutation,
  CharacterRosterEntry,
} from './V2GroupsLayout'
import type { AutoGroupResult } from '@/lib/query/mutations/auto-group-multi-shot-mutation'
import type {
  useRegenerateProjectPanelImage,
  useUpdateProjectPanel,
} from '@/lib/query/mutations/storyboard-panel-mutations'
import type { useGenerateVideo } from '@/lib/query/hooks/useStoryboards'
import type { useActiveTasks } from '@/lib/query/hooks/useTaskStatus'

export interface V2StoryboardTimelineViewProps {
  // ── identity / project shape ──
  projectId: string
  project: ProjectLikeFull | undefined
  currentEpisodeId: string | null
  currentEpisode: EpisodeWithNumber | null
  projectVideoRatio: string
  isPortraitRatio: boolean
  thumbHeightClass: string
  canMultiShot: boolean
  videoFamily: VideoFamily
  canEdit: boolean

  // ── shared overlays ──
  globalOverlaysNode: ReactNode
  layoutToggleNode: ReactNode
  videoModelPickerNode: ReactNode

  // ── panel data ──
  allPanels: PanelLike[]
  orderedGroupIds: string[]
  hasGroups: boolean
  groupedPanelCount: number

  // ── selection ──
  selected: PanelLike | null
  selectedId: string | null
  selectedIndex: number
  setSelectedId: (id: string) => void
  selectedGroupTaskId: string | null
  selectedGroupLabel: string | null
  selectedMediaDisplayMode: MediaDisplayMode | null
  setMediaDisplayOverride: Dispatch<SetStateAction<Record<string, MediaDisplayMode>>>

  // ── analyze + autogroup ──
  analyzeBusy: boolean
  analyzeBusyLabel: string
  analyzeBannerLabel: string
  analyzePhase: 'idle' | 'submitting' | 'queued' | 'processing' | 'done'
  analyzeProgress: number
  analyzeState: AnalyzeState
  onAnalyzeStoryboard: () => void
  onStaleCleanupOpen: () => void
  autoGroup: UseMutationResult<AutoGroupResult, Error, { episodeId: string }>
  onAutoGroup: () => void

  // ── multi-shot ──
  multiShotState: MultiShotState
  onSubmitMultiShot: () => void

  // ── batch ──
  batchImageState: { submitted: number; total: number } | null
  batchVideoState: { submitted: number; total: number } | null
  onBatchGenerateImages: () => void
  onBatchGenerateVideos: () => void

  // ── per-panel inflight + failure ──
  imageInFlight: Set<string>
  setImageInFlight: Dispatch<SetStateAction<Set<string>>>
  videoInFlight: Set<string>
  serverInflightPanelImageIds: Set<string>
  serverInflightPanelVideoIds: Set<string>
  failedPanelImageIds: Map<string, FailedTaskMeta>
  failedPanelVideoIds: Map<string, FailedTaskMeta>
  isCurrentPanelImageInFlight: boolean
  isCurrentPanelVideoInFlight: boolean

  // ── mutation hooks (forwarded) ──
  regenPanel: ReturnType<typeof useRegenerateProjectPanelImage>
  generateVideo: ReturnType<typeof useGenerateVideo>
  updatePanelText: UpdatePanelTextMutation
  updatePanel: ReturnType<typeof useUpdateProjectPanel>
  activePanelImageTasks: ReturnType<typeof useActiveTasks>
  onGenerateVideo: (modelOverride?: string) => void

  // ── text editors ──
  descDraft: string
  setDescDraft: Dispatch<SetStateAction<string>>
  descChanged: boolean
  onSaveDescription: () => void
  dialogueDraft: string
  setDialogueDraft: Dispatch<SetStateAction<string>>
  dialogueChanged: boolean
  onSaveDialogue: () => void

  // ── inspector ──
  characterRoster: CharacterRosterEntry[]
  episodeBindings: EpisodeBinding[]

  // ── zoom modal ──
  zoomImageUrl: string | null
  setZoomImageUrl: Dispatch<SetStateAction<string | null>>
}

export function V2StoryboardTimelineView(props: V2StoryboardTimelineViewProps) {
  return (
    <div className="flex h-full flex-col">
      <V2StoryboardTimelineStrip
        allPanels={props.allPanels}
        selectedId={props.selectedId}
        setSelectedId={props.setSelectedId}
        orderedGroupIds={props.orderedGroupIds}
        hasGroups={props.hasGroups}
        groupedPanelCount={props.groupedPanelCount}
        projectVideoRatio={props.projectVideoRatio}
        thumbHeightClass={props.thumbHeightClass}
        layoutToggleNode={props.layoutToggleNode}
        videoModelPickerNode={props.videoModelPickerNode}
        analyzeBusy={props.analyzeBusy}
        analyzeBusyLabel={props.analyzeBusyLabel}
        analyzeBannerLabel={props.analyzeBannerLabel}
        analyzePhase={props.analyzePhase}
        analyzeProgress={props.analyzeProgress}
        analyzeState={props.analyzeState}
        onAnalyzeStoryboard={props.onAnalyzeStoryboard}
        onStaleCleanupOpen={props.onStaleCleanupOpen}
        currentEpisodeId={props.currentEpisodeId}
        canEdit={props.canEdit}
        autoGroup={props.autoGroup}
        onAutoGroup={props.onAutoGroup}
        batchImageState={props.batchImageState}
        batchVideoState={props.batchVideoState}
        onBatchGenerateImages={props.onBatchGenerateImages}
        onBatchGenerateVideos={props.onBatchGenerateVideos}
        regenPanelPending={props.regenPanel.isPending}
        generateVideoPending={props.generateVideo.isPending}
        imageInFlight={props.imageInFlight}
        videoInFlight={props.videoInFlight}
        serverInflightPanelImageIds={props.serverInflightPanelImageIds}
        serverInflightPanelVideoIds={props.serverInflightPanelVideoIds}
        failedPanelImageIds={props.failedPanelImageIds}
        failedPanelVideoIds={props.failedPanelVideoIds}
      />

      {/*
        3-column body. Originally text-LEFT / image-CENTER / inspector-RIGHT.
        User asked 2026-05-02 to put Selected Shot on the leftmost so the
        9:16 image anchors the eye, and to push every text/chip/binding
        column to the right. We use `order-N` Tailwind classes to swap
        the visual order without cutting/pasting the JSX blocks (each
        block is large and tightly tied to surrounding state). Result:
        Selected Shot first (order-1), text-fields second (order-2),
        bindings/cast/notes third (order-3) — but they remain in the
        DOM in their original order so React keys / refs stay stable.
      */}
      <div className="grid flex-1 grid-cols-12 gap-5 overflow-y-auto px-6 py-6">
        {/* Text column — visually middle, was leftmost.
            Widened to col-span-5 because the 視角 / 景別 / 運鏡 chip
            grids and the 描述詞 / 對話 textareas were getting pinched
            at col-span-3 on a 14" laptop, while the Selected Shot
            column had ~50% empty whitespace around a 260px image. */}
        <V2StoryboardTimelineText
          selected={props.selected}
          selectedIndex={props.selectedIndex}
          descDraft={props.descDraft}
          setDescDraft={props.setDescDraft}
          descChanged={props.descChanged}
          onSaveDescription={props.onSaveDescription}
          dialogueDraft={props.dialogueDraft}
          setDialogueDraft={props.setDialogueDraft}
          dialogueChanged={props.dialogueChanged}
          onSaveDialogue={props.onSaveDialogue}
          updatePanelText={props.updatePanelText}
          updatePanel={props.updatePanel}
          canEdit={props.canEdit}
        />

        {/* Selected Shot — visually leftmost (order-1).
            Shrunk to col-span-3 so the 9:16 still doesn't sit inside
            a wide empty container that read as "16:9 frame around
            a 9:16 image" — the user-reported visual confusion when
            the shot was col-span-6. The image's own max-w-[260px]
            already prevents it from blowing up at this width. */}
        <V2StoryboardTimelineShot
          selected={props.selected}
          selectedIndex={props.selectedIndex}
          project={props.project}
          projectVideoRatio={props.projectVideoRatio}
          isPortraitRatio={props.isPortraitRatio}
          selectedMediaDisplayMode={props.selectedMediaDisplayMode}
          setMediaDisplayOverride={props.setMediaDisplayOverride}
          multiShotState={props.multiShotState}
          canMultiShot={props.canMultiShot}
          videoFamily={props.videoFamily}
          onSubmitMultiShot={props.onSubmitMultiShot}
          regenPanel={props.regenPanel}
          generateVideo={props.generateVideo}
          onGenerateVideo={props.onGenerateVideo}
          isCurrentPanelImageInFlight={props.isCurrentPanelImageInFlight}
          isCurrentPanelVideoInFlight={props.isCurrentPanelVideoInFlight}
          activePanelImageTasks={props.activePanelImageTasks}
          setImageInFlight={props.setImageInFlight}
          failedPanelImageIds={props.failedPanelImageIds}
          failedPanelVideoIds={props.failedPanelVideoIds}
          setZoomImageUrl={props.setZoomImageUrl}
          canEdit={props.canEdit}
        />

        {/* Inspector (cast / notes / multi-shot bindings) — rightmost (order-3).
            Widened to col-span-4 so the 9:16 multi-shot bindings player
            (180×320) plus its CAST / SCENES chip rows fit without
            horizontal scrolling. Plus user-reported clipping at the
            right edge — this gives the column real estate the rail
            actually needs. 3 + 5 + 4 = 12. */}
        <V2StoryboardTimelineInspector
          projectId={props.projectId}
          selected={props.selected}
          selectedGroupTaskId={props.selectedGroupTaskId}
          selectedGroupLabel={props.selectedGroupLabel}
          currentEpisode={props.currentEpisode}
          characterRoster={props.characterRoster}
          episodeBindings={props.episodeBindings}
        />
      </div>
      {/*
        Click-to-zoom lightbox for the Selected Shot. Renders only when
        the user has tapped the thumbnail-sized preview. Click anywhere
        (or hit Esc) to dismiss. Image is fit-contain so a 9:16 still
        stays inside the viewport without cropping.
      */}
      {props.zoomImageUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => props.setZoomImageUrl(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') props.setZoomImageUrl(null)
          }}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-stone-950/95 p-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={props.zoomImageUrl}
            alt="Zoomed"
            className="max-h-full max-w-full object-contain"
          />
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[14px] uppercase tracking-wider text-stone-400">
            click anywhere or press esc to close
          </div>
        </div>
      ) : null}

      {props.globalOverlaysNode}
    </div>
  )
}

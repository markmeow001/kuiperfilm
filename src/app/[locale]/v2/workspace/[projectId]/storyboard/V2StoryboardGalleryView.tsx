'use client'

/**
 * Phase 1 step 3 (2026-06-21) — Gallery-layout view extracted out of
 * V2StoryboardClient.
 *
 * Second of three layout-branch extractions (Groups already shipped
 * in step 2, Timeline pending in step 4). Gallery is the 60/40 grid
 * + inspector layout — biggest of the two so far (~380 inline lines
 * → this file's ~400 + a 50-line call site in the parent).
 *
 * Convention from step 3 commit A: NEVER re-declare prop types that
 * exist in an owner module. All mutation / query result types come
 * via `ReturnType<typeof useX>` against the actual hooks; all
 * upstream component types come via re-imports of the owner's exports.
 *
 * Boundary:
 *   - This file OWNS the gallery toolbar JSX + 2-column grid + the
 *     selected-shot inspector aside (preview / regen buttons / fal
 *     per-shot row / description+dialogue editors / multi-shot rail /
 *     download row).
 *   - Parent (V2StoryboardClient) owns shared state + handlers and
 *     hands them in via the props interface below.
 *
 * Behavior must be 100% unchanged from the inline branch. Verified by
 * tsc + UI verification (switch layoutMode to 'gallery').
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { MultiShotBindingsRail } from './MultiShotBindingsRail'
import type { UpdatePanelTextMutation } from './V2GroupsLayout'
import {
  accentForGroupId,
  type PanelLike,
  type MultiShotState,
  type VideoFamily,
} from './storyboard-client-helpers'
import type { useGenerateVideo } from '@/lib/query/hooks/useStoryboards'
import type { useActiveTasks } from '@/lib/query/hooks/useTaskStatus'
import type { useRegenerateProjectPanelImage } from '@/lib/query/mutations/storyboard-panel-mutations'
import type { useAutoGroupMultiShot, AutoGroupResult } from '@/lib/query/mutations/auto-group-multi-shot-mutation'

// Phase 1 step 4 prep (2026-06-22) — `VideoFamily` consolidated to
// storyboard-client-helpers (single source of truth). Was previously
// parallel-declared in 3 places (V2GroupsLayout inline union, both
// sibling views).

export interface V2StoryboardGalleryViewProps {
  // ── Identity / project shape ──
  projectId: string
  currentEpisodeId: string | null
  projectVideoRatio: string
  aspectClass: string
  canMultiShot: boolean
  videoFamily: VideoFamily

  // ── Permission ──
  canEdit: boolean

  // ── Shared overlay (modals + cleanup dialog rendered in parent) ──
  globalOverlaysNode: ReactNode

  // ── Toolbar shared nodes ──
  layoutToggleNode: ReactNode
  videoModelPickerNode: ReactNode

  // ── Toolbar state + handlers ──
  analyzeBusy: boolean
  analyzeBusyLabel: string
  analyzeBannerLabel: string
  analyzePhase: 'idle' | 'submitting' | 'queued' | 'processing' | 'done'
  analyzeProgress: number
  onAnalyzeStoryboard: () => void
  onStaleCleanupOpen: () => void
  autoGroup: UseMutationResult<AutoGroupResult, Error, { episodeId: string }>
  onAutoGroup: () => void
  multiShotState: MultiShotState
  onSubmitMultiShot: () => void

  // ── Panel + group data ──
  allPanels: PanelLike[]
  hasGroups: boolean
  orderedGroupIds: string[]
  groupedPanelCount: number

  // ── Selection state ──
  selected: PanelLike | null
  setSelectedId: (id: string) => void
  selectedGroupTaskId: string | null
  selectedGroupLabel: string | null

  // ── In-flight tracking (per-panel image/video generation) ──
  imageInFlight: Set<string>
  setImageInFlight: Dispatch<SetStateAction<Set<string>>>
  videoInFlight: Set<string>
  serverInflightPanelImageIds: Set<string>
  serverInflightPanelVideoIds: Set<string>
  isCurrentPanelImageInFlight: boolean
  isCurrentPanelVideoInFlight: boolean

  // ── Mutation hooks (forwarded; types via ReturnType for drift safety) ──
  regenPanel: ReturnType<typeof useRegenerateProjectPanelImage>
  generateVideo: ReturnType<typeof useGenerateVideo>
  updatePanelText: UpdatePanelTextMutation
  activePanelImageTasks: ReturnType<typeof useActiveTasks>
  onGenerateVideo: (modelOverride?: string) => void

  // ── Text editor state ──
  descDraft: string
  setDescDraft: Dispatch<SetStateAction<string>>
  descChanged: boolean
  onSaveDescription: () => void
  dialogueDraft: string
  setDialogueDraft: Dispatch<SetStateAction<string>>
  dialogueChanged: boolean
  onSaveDialogue: () => void
}

export function V2StoryboardGalleryView(props: V2StoryboardGalleryViewProps) {
  const t = useTranslations('v2Storyboard')
  const {
    projectId,
    currentEpisodeId,
    projectVideoRatio,
    aspectClass,
    canMultiShot,
    videoFamily,
    canEdit,
    globalOverlaysNode,
    layoutToggleNode,
    videoModelPickerNode,
    analyzeBusy,
    analyzeBusyLabel,
    analyzeBannerLabel,
    analyzePhase,
    analyzeProgress,
    onAnalyzeStoryboard,
    onStaleCleanupOpen,
    autoGroup,
    onAutoGroup,
    multiShotState,
    onSubmitMultiShot,
    allPanels,
    hasGroups,
    orderedGroupIds,
    groupedPanelCount,
    selected,
    setSelectedId,
    selectedGroupTaskId,
    selectedGroupLabel,
    imageInFlight,
    setImageInFlight,
    videoInFlight,
    serverInflightPanelImageIds,
    serverInflightPanelVideoIds,
    isCurrentPanelImageInFlight,
    isCurrentPanelVideoInFlight,
    regenPanel,
    generateVideo,
    updatePanelText,
    activePanelImageTasks,
    onGenerateVideo,
    descDraft,
    setDescDraft,
    descChanged,
    onSaveDescription,
    dialogueDraft,
    setDialogueDraft,
    dialogueChanged,
    onSaveDialogue,
  } = props

  const selectedIdxForGallery = allPanels.findIndex((p) => p.id === selected?.id)

  return (
    <>
      {globalOverlaysNode}
      <div className="kuiper-storyboard-shell flex flex-col">
        {/* Top toolbar — analyze + autogroup + layout toggle
            (2026-05-12: split into two rows — view toggle on top,
            title + action cluster below — same as Groups layout) */}
        <div className="border-b border-border-soft px-[var(--workspace-gutter)] pb-4 pt-5">
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">{layoutToggleNode}</div>
            {/* 2026-05-19 — picker mirrored from groups toolbar so gallery
                users can see/change the current video model without
                switching layouts. Wrap-aware; sits on its own row to
                avoid crowding the existing title+actions row below. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {videoModelPickerNode}
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div className="font-heading text-lg font-semibold text-text-primary">{t('header.panelsHeader')}</div>
                {hasGroups ? (
                  <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-emerald-400">
                    {t('header.groupSummary', { groups: orderedGroupIds.length, grouped: groupedPanelCount, total: allPanels.length })}
                  </span>
                ) : null}
                <div className="font-mono text-[14px] tracking-wider text-text-tertiary">
                  {t('header.shotsAndRatio', { total: allPanels.length, ratio: projectVideoRatio })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={analyzeBusy || !currentEpisodeId || !canEdit}
                onClick={onAnalyzeStoryboard}
                title={t('buttons.regenerateStoryboardTitleOverwrite')}
                className="flex items-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className={`h-3 w-3 ${analyzeBusy ? 'animate-pulse' : ''}`} />
                {analyzeBusy ? analyzeBusyLabel : t('buttons.regenerateStoryboardArrow')}
              </button>
              <button
                type="button"
                disabled={!currentEpisodeId}
                onClick={onStaleCleanupOpen}
                title={t('buttons.cleanupSourceTitle')}
                className="flex items-center gap-1.5 rounded-sm border border-border-strong bg-raised/40 px-3 py-1.5 font-mono text-[14px] tracking-wider text-text-secondary transition-all hover:border-border-strong hover:bg-overlay/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('buttons.cleanupSourceFull')}
              </button>
              <button
                type="button"
                disabled={autoGroup.isPending || allPanels.length < 2 || analyzeBusy || !canEdit}
                onClick={onAutoGroup}
                title={
                  analyzeBusy
                    ? t('multiShot.tipScriptAnalyzing')
                    : t('multiShot.tipSplitDetailLLM')
                }
                className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {autoGroup.isPending ? t('buttons.splitting') : analyzeBusy ? t('buttons.splitWhileAnalyzing') : hasGroups ? t('buttons.resplit') : t('buttons.smartSplit')}
              </button>
              <button
                type="button"
                onClick={() => onSubmitMultiShot()}
                disabled={multiShotState.status === 'submitting' || !canMultiShot}
                title={
                  !canMultiShot
                    ? t('multiShot.tipCurrentModelNotMultiShot')
                    : videoFamily === 'seedance'
                      ? t('multiShot.tipSeedancePerGroup')
                      : t('multiShot.tipKlingPerGroup')
                }
                className="flex items-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {multiShotState.status === 'submitting'
                  ? t('buttons.sendingMultiShot', { sent: multiShotState.sent, total: multiShotState.total })
                  : videoFamily === 'seedance'
                    ? t('buttons.multiShotComposite')
                    : t('buttons.smartMultiShot')}
              </button>
              </div>
            </div>
          </div>
          {analyzeBusy ? (
            <div className="mt-2 flex items-center gap-2 rounded-sm border border-primary-500/40 bg-primary-500/15 px-3 py-2 text-sm text-primary-200">
              <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-primary-400" />
              <span>{analyzeBannerLabel}</span>
              {analyzePhase === 'processing' ? (
                <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-raised/60">
                  <div
                    className="h-full bg-primary-400 transition-all duration-500"
                    style={{ width: `${Math.max(2, Math.min(100, analyzeProgress))}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {multiShotState.status === 'done' ? (
            <div className="mt-2 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
              {t('multiShotSubmitted.doneTemplate', { count: multiShotState.sent })}
              {multiShotState.failures > 0 ? t('multiShotSubmitted.failuresSuffix', { count: multiShotState.failures }) : ''}
            </div>
          ) : null}
          {multiShotState.status === 'error' ? (
            <div className="mt-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
              {multiShotState.message}
            </div>
          ) : null}
        </div>

        {/* Main 60/40 split */}
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
          {/* Left: gallery grid */}
          <div className="overflow-y-auto px-[var(--workspace-gutter)] py-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {allPanels.map((p, i) => {
                const active = p.id === selected?.id
                const accent = accentForGroupId(p.multiShotGroupId, orderedGroupIds)
                const localImg = imageInFlight.has(p.id)
                const localVid = videoInFlight.has(p.id)
                const remoteImg = serverInflightPanelImageIds.has(p.id)
                const remoteVid = serverInflightPanelVideoIds.has(p.id)
                const isImg = localImg || remoteImg
                const isVid = localVid || remoteVid
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`kuiper-surface-card group flex flex-col border-l-4 text-left ${accent} ${
                      active
                        ? 'border-primary-500/60 ring-2 ring-primary-500/20'
                        : 'border-border-soft/60 hover:border-primary-500/40'
                    }`}
                  >
                    <div className={`relative ${aspectClass} bg-gradient-to-br from-overlay to-raised`}>
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={`#${i + 1}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <AppIcon name="image" className="h-7 w-7 text-text-tertiary" />
                        </div>
                      )}
                      <div className="absolute left-2 top-2 rounded bg-canvas/60 px-2 py-0.5 font-mono text-[14px] text-text-primary backdrop-blur-sm">
                        #{String(i + 1).padStart(2, '0')}
                      </div>
                      {p.videoUrl ? (
                        <div className="absolute bottom-2 right-2 rounded bg-primary-500/90 px-1.5 py-0.5 font-mono text-[12px] text-canvas backdrop-blur-sm">
                          {t('gallery.videoBadge')}
                        </div>
                      ) : null}
                      {isImg || isVid ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-canvas/75 backdrop-blur-sm">
                          <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-primary-400" />
                          <div className="font-mono text-[12px] tracking-wider text-primary-300">
                            {isVid ? t('gallery.videoGenerating') : t('gallery.imageGenerating')}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="bg-raised/40 px-3 py-2">
                      <div className="line-clamp-2 font-serif-cn text-xs leading-snug text-text-primary">
                        {p.description?.slice(0, 60) ?? t('gallery.panelPlaceholder', { n: i + 1 })}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right: selected shot detail */}
          <aside className="overflow-y-auto border-t border-border-soft bg-raised/45 px-[var(--workspace-gutter)] py-6 xl:border-l xl:border-t-0 xl:px-6">
            {selected ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-fraunces text-base italic text-primary-500/80">
                    {t('gallery.shotLabel', { n: String(selectedIdxForGallery + 1).padStart(2, '0') })}
                  </div>
                  <div className="font-mono text-[14px] tracking-wider text-text-tertiary">
                    {selected.videoUrl ? t('gallery.videoGenerated') : selected.imageUrl ? t('gallery.imageGeneratedBadge') : t('gallery.notGenerated')}
                  </div>
                </div>
                <div className={`relative mx-auto max-h-[480px] max-w-[280px] overflow-hidden rounded-sm border border-border-soft ${aspectClass} bg-gradient-to-br from-overlay to-raised`}>
                  {selected.videoUrl ? (
                    <video
                      key={selected.id + ':' + selected.videoUrl}
                      src={selected.videoUrl}
                      poster={selected.imageUrl ?? undefined}
                      controls
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : selected.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.imageUrl} alt="selected" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <AppIcon name="image" className="h-8 w-8 text-text-tertiary" />
                    </div>
                  )}
                  {isCurrentPanelVideoInFlight || isCurrentPanelImageInFlight ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/75 backdrop-blur-sm">
                      <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-primary-400" />
                      <div className="font-fraunces text-sm italic text-primary-300">
                        {isCurrentPanelVideoInFlight ? t('gallery.videoGeneratingFull') : t('gallery.imageGeneratingFull')}
                      </div>
                      <div className="px-3 text-center font-serif-cn text-[14px] text-text-secondary">
                        {t('gallery.autoUpdateHint')}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!selected || regenPanel.isPending || !canEdit}
                    onClick={() => {
                      if (!selected) return
                      const panelIdAtSubmit = selected.id
                      regenPanel.mutate(
                        { panelId: panelIdAtSubmit },
                        {
                          onSuccess: () => {
                            setImageInFlight((prev) => {
                              const next = new Set(prev)
                              next.add(panelIdAtSubmit)
                              return next
                            })
                            void activePanelImageTasks.refetch()
                          },
                        },
                      )
                    }}
                    className="rounded-sm border border-border-soft bg-raised/50 py-2 font-serif-cn text-xs text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:opacity-50"
                  >
                    {regenPanel.isPending
                      ? t('gallery.submitting')
                      : selected?.imageUrl
                        ? t('gallery.regenImage')
                        : t('gallery.generateImage')}
                  </button>
                  <button
                    type="button"
                    disabled={!selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
                    onClick={() => onGenerateVideo()}
                    className="rounded-sm border border-primary-500/40 bg-primary-500/10 py-2 font-serif-cn text-xs text-primary-300 transition-all hover:bg-primary-500/20 disabled:opacity-50"
                  >
                    {generateVideo.isPending
                      ? t('gallery.submitting')
                      : isCurrentPanelVideoInFlight
                        ? t('gallery.generating')
                        : selected.videoUrl
                          ? t('gallery.regenVideoArrow')
                          : t('gallery.generateVideo')}
                  </button>
                </div>

                {/* 2026-05-17 — fal Seedance per-shot override row (mini).
                    Mirrors the Selected Shot card's secondary row below
                    the main 生成視頻 CTA. Compact labels (Seedance / Fast)
                    because the panel-card mini area is narrow. */}
                <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-text-tertiary">
                  <span className="shrink-0">{t('gallery.fal.label')}</span>
                  <button
                    type="button"
                    disabled={!selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
                    onClick={() => onGenerateVideo('fal::bytedance/seedance-2.0/image-to-video')}
                    title={t('gallery.fal.seedanceTitle')}
                    className="flex flex-1 items-center justify-center rounded-sm border border-border-strong bg-raised/40 py-1 font-serif-cn text-[11px] text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:opacity-50"
                  >
                    {t('gallery.fal.seedance')}
                  </button>
                  <button
                    type="button"
                    disabled={!selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
                    onClick={() => onGenerateVideo('fal::bytedance/seedance-2.0/fast/image-to-video')}
                    title={t('gallery.fal.fastTitle')}
                    className="flex flex-1 items-center justify-center rounded-sm border border-border-strong bg-raised/40 py-1 font-serif-cn text-[11px] text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:opacity-50"
                  >
                    {t('gallery.fal.fast')}
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="font-mono text-[14px] tracking-wider text-primary-600">{t('gallery.fields.descriptionLabel')}</div>
                      <button
                        type="button"
                        onClick={onSaveDescription}
                        disabled={!descChanged || updatePanelText.isPending || !selected || !canEdit}
                        className="rounded-sm border border-primary-500/40 px-2 py-0.5 font-mono text-[12px] tracking-wider text-primary-300 hover:bg-primary-500/10 disabled:opacity-40"
                      >
                        {updatePanelText.isPending ? t('gallery.fields.savingButton') : t('gallery.fields.save')}
                      </button>
                    </div>
                    <textarea
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      rows={4}
                      className="w-full rounded-sm border border-border-soft bg-raised/50 p-2 font-body text-xs text-text-primary outline-none focus:border-primary-500/50"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="font-mono text-[14px] tracking-wider text-primary-600">{t('gallery.fields.dialogueLabel')}</div>
                      <button
                        type="button"
                        onClick={onSaveDialogue}
                        disabled={!dialogueChanged || updatePanelText.isPending || !selected || !canEdit}
                        className="rounded-sm border border-primary-500/40 px-2 py-0.5 font-mono text-[12px] tracking-wider text-primary-300 hover:bg-primary-500/10 disabled:opacity-40"
                      >
                        {updatePanelText.isPending ? t('gallery.fields.savingButton') : t('gallery.fields.save')}
                      </button>
                    </div>
                    <textarea
                      value={dialogueDraft}
                      onChange={(e) => setDialogueDraft(e.target.value)}
                      rows={3}
                      placeholder={t('gallery.fields.dialoguePlaceholder')}
                      className="w-full rounded-sm border border-border-soft bg-raised/50 p-2 font-body text-xs text-text-primary outline-none focus:border-primary-500/50"
                    />
                  </div>
                </div>

                {selectedGroupTaskId ? (
                  <div className="mt-3">
                    <MultiShotBindingsRail
                      taskId={selectedGroupTaskId}
                      groupLabel={selectedGroupLabel}
                      projectId={projectId}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  <a
                    href={selected.imageUrl ?? '#'}
                    download={selected.imageUrl ? `panel-${(selectedIdxForGallery + 1).toString().padStart(2, '0')}.jpg` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!selected.imageUrl}
                    onClick={(e) => { if (!selected.imageUrl) e.preventDefault() }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-border-soft py-1.5 font-mono text-[14px] tracking-wider transition-all ${selected.imageUrl ? 'text-text-secondary hover:border-primary-500/40 hover:text-primary-400' : 'cursor-not-allowed text-text-tertiary opacity-50'}`}
                  >
                    <AppIcon name="download" className="h-3 w-3" />
                    {t('gallery.downloads.image')}
                  </a>
                  <a
                    href={selected.videoUrl ?? '#'}
                    download={selected.videoUrl ? `panel-${(selectedIdxForGallery + 1).toString().padStart(2, '0')}.mp4` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!selected.videoUrl}
                    onClick={(e) => { if (!selected.videoUrl) e.preventDefault() }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-border-soft py-1.5 font-mono text-[14px] tracking-wider transition-all ${selected.videoUrl ? 'text-text-secondary hover:border-primary-500/40 hover:text-primary-400' : 'cursor-not-allowed text-text-tertiary opacity-50'}`}
                  >
                    <AppIcon name="download" className="h-3 w-3" />
                    {t('gallery.downloads.video')}
                  </a>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <p className="font-fraunces text-sm italic text-text-tertiary">{t('gallery.noSelected')}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  )
}

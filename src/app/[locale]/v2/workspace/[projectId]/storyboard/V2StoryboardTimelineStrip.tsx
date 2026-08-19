'use client'

/**
 * Phase 1 step 4 (2026-06-22) — Timeline strip (toolbar + panel strip).
 *
 * Extracted from V2StoryboardClient's Timeline branch (was inline at
 * lines 1453-1701). The top portion of Timeline layout — toolbar with
 * regen / cleanup / autogroup / batch-image / batch-video CTAs, then
 * the horizontal panel strip below.
 *
 * Sibling of TimelineText / TimelineShot / TimelineInspector, all
 * orchestrated by V2StoryboardTimelineView.
 *
 * ── Props interface grouped into 3 clusters (analyze / batch /
 * inflight) per PR #17 reviewer feedback. 34 props is the density
 * ceiling — accepted because each cluster has real cardinality.
 */

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  accentForGroupId,
  type PanelLike,
  type AnalyzeState,
  type FailedTaskMeta,
} from './storyboard-client-helpers'
import type { AutoGroupMutation } from '@/lib/query/mutations/auto-group-multi-shot-mutation'
import { StripPanelThumb } from './StripPanelThumb'

export interface V2StoryboardTimelineStripProps {
  // ── identity / shared shape ──
  allPanels: PanelLike[]
  selectedId: string | null
  setSelectedId: (id: string) => void
  orderedGroupIds: string[]
  hasGroups: boolean
  groupedPanelCount: number
  projectVideoRatio: string
  thumbHeightClass: string
  layoutToggleNode: ReactNode
  videoModelPickerNode: ReactNode

  // ── analyze cluster ──
  analyzeBusy: boolean
  analyzeBusyLabel: string
  analyzeBannerLabel: string
  analyzePhase: 'idle' | 'submitting' | 'queued' | 'processing' | 'done'
  analyzeProgress: number
  analyzeState: AnalyzeState
  onAnalyzeStoryboard: () => void
  onStaleCleanupOpen: () => void
  currentEpisodeId: string | null
  canEdit: boolean
  autoGroup: AutoGroupMutation
  onAutoGroup: () => void

  // ── batch cluster ──
  batchImageState: { submitted: number; total: number } | null
  batchVideoMode: 'idle' | 'busy' | 'view'
  onBatchGenerateImages: () => void
  onBatchGenerateVideos: () => void
  regenPanelPending: boolean
  generateVideoPending: boolean

  // ── inflight / failure cluster ──
  imageInFlight: Set<string>
  videoInFlight: Set<string>
  serverInflightPanelImageIds: Set<string>
  serverInflightPanelVideoIds: Set<string>
  failedPanelImageIds: Map<string, FailedTaskMeta>
  failedPanelVideoIds: Map<string, FailedTaskMeta>
  appearanceGenerationBlocked: boolean
}

export function V2StoryboardTimelineStrip(props: V2StoryboardTimelineStripProps) {
  const t = useTranslations('v2Storyboard')
  const {
    allPanels,
    selectedId,
    setSelectedId,
    orderedGroupIds,
    hasGroups,
    groupedPanelCount,
    projectVideoRatio,
    thumbHeightClass,
    layoutToggleNode,
    videoModelPickerNode,
    analyzeBusy,
    analyzeBusyLabel,
    analyzeBannerLabel,
    analyzePhase,
    analyzeProgress,
    analyzeState,
    onAnalyzeStoryboard,
    onStaleCleanupOpen,
    currentEpisodeId,
    canEdit,
    autoGroup,
    onAutoGroup,
    batchImageState,
    batchVideoMode,
    onBatchGenerateImages,
    onBatchGenerateVideos,
    regenPanelPending,
    generateVideoPending,
    imageInFlight,
    videoInFlight,
    serverInflightPanelImageIds,
    serverInflightPanelVideoIds,
    failedPanelImageIds,
    failedPanelVideoIds,
    appearanceGenerationBlocked,
  } = props

  return (
    <div className="border-b border-border-soft px-[var(--workspace-gutter)] pb-4 pt-5">
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex justify-end">{layoutToggleNode}</div>
        {/* 2026-05-19 — picker mirrored from groups toolbar so timeline
            users can see/change the current video model without
            switching layouts (matches gallery treatment). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {videoModelPickerNode}
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-heading text-lg font-semibold text-text-primary">{t('timeline.header')}</div>
            {hasGroups ? (
              <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-emerald-400">
                {t('header.groupSummary', { groups: orderedGroupIds.length, grouped: groupedPanelCount, total: allPanels.length })}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={analyzeBusy || !currentEpisodeId || !canEdit}
            onClick={onAnalyzeStoryboard}
            title={t('timeline.regenStoryboardTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className={`h-3 w-3 ${analyzeBusy ? 'animate-pulse' : ''}`} />
            {analyzeBusy ? analyzeBusyLabel : t('buttons.regenerateStoryboardArrow')}
          </button>
          <button
            type="button"
            disabled={!currentEpisodeId}
            onClick={onStaleCleanupOpen}
            title={t('timeline.cleanupSourceTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-border-strong bg-raised/40 px-3 py-1.5 font-mono text-[14px] tracking-wider text-text-secondary transition-all hover:border-border-strong hover:bg-overlay/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('buttons.cleanupSourceFull')}
          </button>
          <button
            type="button"
            disabled={autoGroup.isPending || allPanels.length < 2 || !canEdit}
            onClick={onAutoGroup}
            title={t('timeline.autoGroupTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--production-blue)]/45 bg-[var(--production-blue-soft)] px-3 py-1.5 font-mono text-[14px] tracking-wider text-[var(--process-cyan-strong)] transition-all hover:border-[var(--production-blue)] hover:bg-[var(--production-blue-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className="h-3 w-3" />
            {autoGroup.isPending ? t('buttons.splitting') : hasGroups ? t('buttons.resplit') : t('buttons.smartSplit')}
          </button>
          {/*
            Batch generate buttons — surface a one-click path to fill
            every panel without an image / video. Each button only
            shows up when there's actually work to do (avoids "0 個"
            dead-button noise). Disabled while either is in flight so
            the user can't accidentally submit overlapping batches.
          */}
          {(() => {
            const missingImages = allPanels.filter((p) => !p.imageUrl).length
            if (missingImages === 0) return null
            return (
              <button
                type="button"
                disabled={batchImageState !== null || regenPanelPending || !canEdit || appearanceGenerationBlocked}
                onClick={onBatchGenerateImages}
                title={t('timeline.batchImageTitle', { count: missingImages })}
                className="flex items-center gap-1.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-emerald-300 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="image" className="h-3 w-3" />
                {batchImageState
                  ? t('timeline.batchImageSubmitting', { done: batchImageState.submitted, total: batchImageState.total })
                  : t('timeline.batchImageLabel', { count: missingImages })}
              </button>
            )
          })()}
          {(() => {
            const eligibleForVideo = allPanels.filter(
              (p) => Boolean(p.imageUrl) && !p.videoUrl,
            ).length
            if (eligibleForVideo === 0) return null
            return (
              <button
                type="button"
                disabled={batchVideoMode === 'busy' || generateVideoPending || !canEdit || appearanceGenerationBlocked}
                onClick={onBatchGenerateVideos}
                title={t('timeline.batchVideoTitle', { count: eligibleForVideo })}
                className="flex items-center gap-1.5 rounded-sm border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-sky-300 transition-all hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="play" className="h-3 w-3" />
                {batchVideoMode === 'busy'
                  ? t('timeline.batchVideoPreparing')
                  : batchVideoMode === 'view'
                    ? t('timeline.batchVideoViewRun')
                    : t('timeline.batchVideoLabel', { count: eligibleForVideo })}
              </button>
            )
          })()}
          <div className="font-mono text-[14px] tracking-wider text-text-tertiary">
            {t('timeline.shotsDraft', { count: allPanels.length })}
          </div>
          </div>
        </div>
      </div>
      {analyzeBusy ? (
        <div className="mb-2 flex items-center gap-2 rounded-sm border border-primary-500/40 bg-primary-500/15 px-3 py-2 text-sm text-primary-200">
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
      {analyzeState.status === 'error' ? (
        <div className="mb-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
          {t('generateSplash.submitErrorPrefix', { message: analyzeState.message })}
        </div>
      ) : null}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {allPanels.map((p, i) => {
          const groupBoundary = i > 0
            && !!p.multiShotGroupId
            && allPanels[i - 1].multiShotGroupId !== p.multiShotGroupId
          return (
            <StripPanelThumb
              key={p.id}
              panel={p}
              index={i}
              active={p.id === selectedId}
              accentClass={accentForGroupId(p.multiShotGroupId, orderedGroupIds)}
              groupBoundary={groupBoundary}
              thumbHeightClass={thumbHeightClass}
              projectVideoRatio={projectVideoRatio}
              imageInFlight={imageInFlight}
              videoInFlight={videoInFlight}
              serverInflightPanelImageIds={serverInflightPanelImageIds}
              serverInflightPanelVideoIds={serverInflightPanelVideoIds}
              failedPanelImageIds={failedPanelImageIds}
              failedPanelVideoIds={failedPanelVideoIds}
              onSelect={() => setSelectedId(p.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

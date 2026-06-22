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
import type { UseMutationResult } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { resolveErrorDisplay } from '@/lib/errors/display'
import {
  accentForGroupId,
  type PanelLike,
  type AnalyzeState,
  type FailedTaskMeta,
} from './storyboard-client-helpers'
import type { AutoGroupResult } from '@/lib/query/mutations/auto-group-multi-shot-mutation'

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
  autoGroup: UseMutationResult<AutoGroupResult, Error, { episodeId: string }>
  onAutoGroup: () => void

  // ── batch cluster ──
  batchImageState: { submitted: number; total: number } | null
  batchVideoState: { submitted: number; total: number } | null
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
    batchVideoState,
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
  } = props

  return (
    <div className="border-b border-amber-900/15 px-12 pb-4 pt-6">
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex justify-end">{layoutToggleNode}</div>
        {/* 2026-05-19 — picker mirrored from groups toolbar so timeline
            users can see/change the current video model without
            switching layouts (matches gallery treatment). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {videoModelPickerNode}
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="font-fraunces text-sm italic text-amber-500/80">{t('timeline.header')}</div>
            {hasGroups ? (
              <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-emerald-400">
                {t('header.groupSummary', { groups: orderedGroupIds.length, grouped: groupedPanelCount, total: allPanels.length })}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={analyzeBusy || !currentEpisodeId || !canEdit}
            onClick={onAnalyzeStoryboard}
            title={t('timeline.regenStoryboardTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className={`h-3 w-3 ${analyzeBusy ? 'animate-pulse' : ''}`} />
            {analyzeBusy ? analyzeBusyLabel : t('buttons.regenerateStoryboardArrow')}
          </button>
          <button
            type="button"
            disabled={!currentEpisodeId}
            onClick={onStaleCleanupOpen}
            title={t('timeline.cleanupSourceTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-stone-600 bg-stone-900/40 px-3 py-1.5 font-mono text-[14px] tracking-wider text-stone-300 transition-all hover:border-stone-500 hover:bg-stone-800/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('buttons.cleanupSourceFull')}
          </button>
          <button
            type="button"
            disabled={autoGroup.isPending || allPanels.length < 2 || !canEdit}
            onClick={onAutoGroup}
            title={t('timeline.autoGroupTitle')}
            className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
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
                disabled={batchImageState !== null || regenPanelPending || !canEdit}
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
                disabled={batchVideoState !== null || generateVideoPending || !canEdit}
                onClick={onBatchGenerateVideos}
                title={t('timeline.batchVideoTitle', { count: eligibleForVideo })}
                className="flex items-center gap-1.5 rounded-sm border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-sky-300 transition-all hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="play" className="h-3 w-3" />
                {batchVideoState
                  ? t('timeline.batchVideoSubmitting', { done: batchVideoState.submitted, total: batchVideoState.total })
                  : t('timeline.batchVideoLabel', { count: eligibleForVideo })}
              </button>
            )
          })()}
          <div className="font-mono text-[14px] tracking-wider text-stone-500">
            {t('timeline.shotsDraft', { count: allPanels.length })}
          </div>
          </div>
        </div>
      </div>
      {analyzeBusy ? (
        <div className="mb-2 flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
          <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-amber-400" />
          <span>{analyzeBannerLabel}</span>
          {analyzePhase === 'processing' ? (
            <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-stone-900/60">
              <div
                className="h-full bg-amber-400 transition-all duration-500"
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
      {autoGroup.isError ? (() => {
        // 2026-05-21 — route mutation error through resolveErrorDisplay
        // so CONFLICT / TASK_STILL_PROCESSING / EPISODE_NO_CLIPS all
        // surface their targeted friendly text instead of the raw
        // payload message (which was already partly friendly via
        // resolveTaskErrorMessage, but didn't pick up our specific
        // sub-codes like TASK_STILL_PROCESSING).
        const err = autoGroup.error as Error & { payload?: { error?: { code?: string; message?: string } } }
        const payload = err?.payload
        const display = resolveErrorDisplay({
          code: payload?.error?.code ?? null,
          message: payload?.error?.message ?? err?.message ?? null,
        })
        return (
          <div className="mb-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
            {t('errors.splitFailedWithReason', { reason: display?.message ?? err?.message ?? t('errors.unknown') })}
          </div>
        )
      })() : null}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {allPanels.map((p, i) => {
          const active = p.id === selectedId
          const hasImage = Boolean(p.imageUrl)
          const accent = accentForGroupId(p.multiShotGroupId, orderedGroupIds)
          const groupBoundary = i > 0
            && p.multiShotGroupId
            && allPanels[i - 1].multiShotGroupId !== p.multiShotGroupId
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`flex-shrink-0 overflow-hidden rounded-sm border-l-4 border-y border-r text-left transition-all ${accent} ${
                active
                  ? 'border-amber-500/60 ring-2 ring-amber-500/20'
                  : 'border-stone-800/60 hover:border-stone-700'
              } ${groupBoundary ? 'ml-2' : ''}`}
            >
              <div
                className={`relative ${thumbHeightClass} overflow-hidden bg-gradient-to-br from-stone-800 to-stone-900`}
                // Inline aspectRatio (instead of Tailwind aspect-[9/16])
                // because user-reported "thumbs render 16:9 even though
                // project is 9:16" — Tailwind arbitrary aspect classes
                // can be silently dropped if the JIT scanner doesn't
                // see the literal at build time, and falling back to
                // the parent's intrinsic ratio is exactly the
                // landscape-looking-thumb bug. Inline style is
                // bulletproof.
                style={{ aspectRatio: projectVideoRatio.replace(':', '/') }}
              >
                {hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl ?? ''} alt={`panel ${i + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-stone-950/70">
                    <AppIcon name="image" className="h-5 w-5 text-stone-600" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-transparent to-transparent" />
                <div className="absolute left-2 top-1.5 rounded bg-stone-950/50 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 backdrop-blur-sm">
                  #{String(i + 1).padStart(2, '0')}
                </div>
                {(() => {
                  const localImg = imageInFlight.has(p.id)
                  const localVid = videoInFlight.has(p.id)
                  const remoteImg = serverInflightPanelImageIds.has(p.id)
                  const remoteVid = serverInflightPanelVideoIds.has(p.id)
                  const isImg = localImg || remoteImg
                  const isVid = localVid || remoteVid
                  if (isImg || isVid) {
                    return (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-stone-950/75 backdrop-blur-sm">
                        <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-amber-400" />
                        <div className="font-mono text-[12px] tracking-wider text-amber-300">
                          {isVid ? t('gallery.videoGenerating') : t('gallery.imageGenerating')}
                        </div>
                      </div>
                    )
                  }
                  // Failure overlay — only show when there's no
                  // current in-flight retry AND there's no successful
                  // image/video yet. Image failures dominate over
                  // video failures (you regenerate image first).
                  const failedImg = !p.imageUrl && failedPanelImageIds.get(p.id)
                  const failedVid = !!p.imageUrl && !p.videoUrl && failedPanelVideoIds.get(p.id)
                  const failed = failedImg || failedVid
                  if (failed) {
                    const code = failed.errorCode ?? ''
                    // Friendlier 2-line label than the raw error
                    // dump. RATE_LIMIT happens often in the user's
                    // Tencent quota world; ViolationContent is a
                    // content-policy rejection and means "edit the
                    // description, then retry". Anything else falls
                    // through to a generic 失敗 with a tooltip.
                    const label = code === 'RATE_LIMIT'
                      ? t('timeline.panelFailedLabels.rateLimit')
                      : /Violation|Content/i.test(failed.errorMessage ?? '')
                        ? t('timeline.panelFailedLabels.violation')
                        : t('timeline.panelFailedLabels.generic')
                    const tooltip = `${code || ''}${code ? ' — ' : ''}${failed.errorMessage ?? t('timeline.panelFailedRetryHint', { action: failedImg ? t('gallery.generateImage') : t('gallery.generateVideo') })}`
                    return (
                      <div
                        title={tooltip}
                        className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-950/80 backdrop-blur-sm"
                      >
                        <AppIcon name="alert" className="h-5 w-5 text-rose-300" />
                        <div className="font-mono text-[12px] tracking-wider text-rose-200">
                          ✗ {label}
                        </div>
                        <div className="font-mono text-[8px] tracking-wider text-rose-400/80">
                          {t('timeline.panelFailedRetryHint', { action: failedImg ? t('gallery.generateImage') : t('gallery.generateVideo') })}
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}
              </div>
              {/*
                Description text used to live here as a per-thumb
                caption row, which made the strip card silhouette
                read as 16:9 even on 9:16 projects (image is 9:16
                but the caption + image stack added landscape
                proportions). User asked 2026-05-02 for a clean
                thumbs-only strip; the full description still lives
                in the lower 描述詞 column for the selected shot.
              */}
            </button>
          )
        })}
      </div>
    </div>
  )
}


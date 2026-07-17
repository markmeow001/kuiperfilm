'use client'

/**
 * Phase 1 (2026-07-04) — single panel thumbnail in the timeline strip,
 * extracted from V2StoryboardTimelineStrip's allPanels.map (PR #17 L-1).
 * Prop-driven leaf: one panel + the shared in-flight/failure state in,
 * one thumbnail button out. No parent closures — behaviour-preserving.
 */

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { PanelLike, FailedTaskMeta } from './storyboard-client-helpers'

export interface StripPanelThumbProps {
  panel: PanelLike
  index: number
  active: boolean
  accentClass: string
  groupBoundary: boolean
  thumbHeightClass: string
  projectVideoRatio: string
  imageInFlight: Set<string>
  videoInFlight: Set<string>
  serverInflightPanelImageIds: Set<string>
  serverInflightPanelVideoIds: Set<string>
  failedPanelImageIds: Map<string, FailedTaskMeta>
  failedPanelVideoIds: Map<string, FailedTaskMeta>
  onSelect: () => void
}

export function StripPanelThumb({
  panel: p,
  index: i,
  active,
  accentClass,
  groupBoundary,
  thumbHeightClass,
  projectVideoRatio,
  imageInFlight,
  videoInFlight,
  serverInflightPanelImageIds,
  serverInflightPanelVideoIds,
  failedPanelImageIds,
  failedPanelVideoIds,
  onSelect,
}: StripPanelThumbProps) {
  const t = useTranslations('v2Storyboard')
  const hasImage = Boolean(p.imageUrl)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex-shrink-0 overflow-hidden rounded-sm border-l-4 border-y border-r text-left transition-all ${accentClass} ${
        active
          ? 'border-primary-500/60 ring-2 ring-primary-500/20'
          : 'border-border-soft/60 hover:border-border-strong'
      } ${groupBoundary ? 'ml-2' : ''}`}
    >
      <div
        className={`relative ${thumbHeightClass} overflow-hidden bg-gradient-to-br from-overlay to-raised`}
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
          <div className="flex h-full w-full items-center justify-center bg-canvas/70">
            <AppIcon name="image" className="h-5 w-5 text-text-tertiary" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-canvas/90 via-transparent to-transparent" />
        <div className="absolute left-2 top-1.5 rounded bg-canvas/50 px-1.5 py-0.5 font-mono text-[14px] text-text-primary backdrop-blur-sm">
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-canvas/75 backdrop-blur-sm">
                <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-primary-400" />
                <div className="font-mono text-[12px] tracking-wider text-primary-300">
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
}

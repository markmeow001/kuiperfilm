'use client'

/**
 * Phase 1 step 4 (2026-06-22) — Timeline Selected Shot column (left visual).
 *
 * Extracted from V2StoryboardClient's Timeline branch (was inline at
 * lines 1829-2213, the biggest single sub-view). Owns:
 *   - Multi-shot CTA at the top
 *   - Image/video display toggle + B-path "生成原圖" affordance
 *   - Multi-shot status badges (done / error)
 *   - Selected shot preview (image or video) with in-flight overlay +
 *     failure overlay
 *   - Action button pair (regen image / generate video)
 *   - fal Seedance 2.0 alternate row
 *   - Download row
 *   - Regen success / error banners
 *
 * Kept as a single 380-line file (NOT split further) because the
 * 5 internal sections all share `selected` / `regenPanel` /
 * `generateVideo` / `isCurrentPanelImageInFlight` — splitting would
 * duplicate props without reducing total prop surface (per PR #17
 * pre-execution review).
 */

import type { Dispatch, SetStateAction } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type {
  PanelLike,
  ProjectLikeFull,
  MultiShotState,
  MediaDisplayMode,
  VideoFamily,
  FailedTaskMeta,
} from './storyboard-client-helpers'
import type { useRegenerateProjectPanelImage } from '@/lib/query/mutations/storyboard-panel-mutations'
import type { useGenerateVideo } from '@/lib/query/hooks/useStoryboards'
import type { useActiveTasks } from '@/lib/query/hooks/useTaskStatus'

export interface V2StoryboardTimelineShotProps {
  selected: PanelLike | null
  selectedIndex: number
  project: ProjectLikeFull | undefined
  projectVideoRatio: string
  isPortraitRatio: boolean
  selectedMediaDisplayMode: MediaDisplayMode | null
  setMediaDisplayOverride: Dispatch<SetStateAction<Record<string, MediaDisplayMode>>>
  multiShotState: MultiShotState
  canMultiShot: boolean
  videoFamily: VideoFamily
  onSubmitMultiShot: () => void
  regenPanel: ReturnType<typeof useRegenerateProjectPanelImage>
  generateVideo: ReturnType<typeof useGenerateVideo>
  onGenerateVideo: (modelOverride?: string) => void
  isCurrentPanelImageInFlight: boolean
  isCurrentPanelVideoInFlight: boolean
  activePanelImageTasks: ReturnType<typeof useActiveTasks>
  setImageInFlight: Dispatch<SetStateAction<Set<string>>>
  failedPanelImageIds: Map<string, FailedTaskMeta>
  failedPanelVideoIds: Map<string, FailedTaskMeta>
  setZoomImageUrl: Dispatch<SetStateAction<string | null>>
  canEdit: boolean
  appearanceGenerationBlocked: boolean
}

export function V2StoryboardTimelineShot(props: V2StoryboardTimelineShotProps) {
  const t = useTranslations('v2Storyboard')
  const {
    selected,
    selectedIndex,
    project,
    projectVideoRatio,
    isPortraitRatio,
    selectedMediaDisplayMode,
    setMediaDisplayOverride,
    multiShotState,
    canMultiShot,
    videoFamily,
    onSubmitMultiShot,
    regenPanel,
    generateVideo,
    onGenerateVideo,
    isCurrentPanelImageInFlight,
    isCurrentPanelVideoInFlight,
    activePanelImageTasks,
    setImageInFlight,
    failedPanelImageIds,
    failedPanelVideoIds,
    setZoomImageUrl,
    canEdit,
    appearanceGenerationBlocked,
  } = props

  return (
    <div className="order-1 col-span-1 xl:col-span-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-fraunces text-sm italic text-primary-500/80">Selected Shot</div>
        <button
          type="button"
          onClick={() => onSubmitMultiShot()}
          disabled={multiShotState.status === 'submitting' || !canMultiShot || appearanceGenerationBlocked}
          className="flex items-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-primary-500 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          title={(() => {
            const m = project?.novelPromotionData?.videoModel ?? ''
            if (!canMultiShot) {
              return t('details.modelNotMultiShotInline')
            }
            if (videoFamily === 'seedance') {
              return t('details.tipSeedanceComposite')
            }
            if (/^tencent-vod::Kling-(3|O1)/i.test(m)) {
              return t('details.tipBPath', { model: m.split('::')[1] })
            }
            return t('details.tipKlingC')
          })()}
        >
          <AppIcon name="sparklesAlt" className="h-3 w-3" />
          {multiShotState.status === 'submitting'
            ? t('buttons.sendingMultiShot', { sent: multiShotState.sent, total: multiShotState.total })
            : (() => {
                const m = project?.novelPromotionData?.videoModel ?? ''
                if (videoFamily === 'seedance') {
                  return t('details.multiShotSeedance')
                }
                return /^tencent-vod::Kling-(3|O1)/i.test(m)
                  ? t('details.multiShotBPath')
                  : t('details.multiShotKlingBatch')
              })()}
        </button>
      </div>
      {/* 2026-05-13 — 圖/視頻顯示切換 + B 路徑「生成原圖」CTA。
          三種狀態：
          (a) image + video 都有 → 顯示 toggle，user 切著看
          (b) 只有 video（B 路徑 t2v 直接出視頻，跳過生圖）→ 顯示
              「🖼 生成原圖」按鈕，補上 imageUrl 之後 toggle 自動出現
          (c) 只有 image 或都沒有 → 不顯示，下方既有的「生成圖片 /
              ↻ 重新生成圖」按鈕負責 */}
      {selected?.imageUrl && selected?.videoUrl ? (
        <div className="mb-3 inline-flex rounded-sm border border-border-soft/60 bg-raised/40 font-mono text-[12px]">
          <button
            type="button"
            onClick={() =>
              setMediaDisplayOverride((prev) => ({ ...prev, [selected.id]: 'image' }))
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-all ${
              selectedMediaDisplayMode === 'image'
                ? 'bg-primary-500/20 text-primary-300'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            title={t('toggle.showImage')}
          >
            <AppIcon name="image" className="h-3 w-3" />
            {t('toggle.image')}
          </button>
          <button
            type="button"
            onClick={() =>
              setMediaDisplayOverride((prev) => ({ ...prev, [selected.id]: 'video' }))
            }
            className={`flex items-center gap-1.5 border-l border-border-soft/60 px-3 py-1.5 transition-all ${
              selectedMediaDisplayMode === 'video'
                ? 'bg-primary-500/20 text-primary-300'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            title={t('toggle.showVideo')}
          >
            <span aria-hidden>▶</span>
            {t('toggle.video')}
          </button>
        </div>
      ) : selected?.videoUrl && !selected?.imageUrl ? (
        <button
          type="button"
          disabled={!selected || regenPanel.isPending || isCurrentPanelImageInFlight || !canEdit || appearanceGenerationBlocked}
          onClick={() => {
            if (!selected || appearanceGenerationBlocked) return
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
          className="mb-3 inline-flex items-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 font-mono text-[12px] tracking-wider text-primary-300 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          title={t('bpath.missingImageHint')}
        >
          <AppIcon name="image" className="h-3 w-3" />
          {isCurrentPanelImageInFlight
            ? t('bpath.submittingImage')
            : regenPanel.isPending
              ? t('bpath.submitting')
              : t('bpath.generateImageButton')}
        </button>
      ) : null}
      {multiShotState.status === 'done' ? (
        <div className="mb-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {t('multiShotSubmitted.doneTemplate', { count: multiShotState.sent })}
          {multiShotState.failures > 0 ? t('multiShotSubmitted.failuresSuffix', { count: multiShotState.failures }) : ''}
        </div>
      ) : null}
      {multiShotState.status === 'error' ? (
        <div className="mb-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {multiShotState.message}
        </div>
      ) : null}

      {/*
        Selected Shot — sized as a thumbnail-with-controls (≈ same
        footprint as the right-column multi-shot 9:16 player at
        180×320). User pointed out 2026-05-02 the previous full-
        col-span-6 width was overwhelming and out of proportion
        with the rest of the timeline page. Click on the
        image/video to open a fullscreen lightbox with the
        original-resolution asset for detailed inspection.
      */}
      <div
        className={`overflow-hidden rounded-sm border border-border-soft/60 bg-raised/30 mx-auto ${
          isPortraitRatio ? 'max-w-[260px]' : 'max-w-[480px]'
        }`}
      >
        <div
          className="relative bg-gradient-to-br from-overlay to-raised"
          style={{ aspectRatio: projectVideoRatio.replace(':', '/') }}
        >
          {selectedMediaDisplayMode === 'video' && selected?.videoUrl ? (
            // Video player. Use the still imageUrl as poster so first
            // paint is the same frame the user is used to seeing while
            // idle, then switch to playing video on user click. The
            // image/video toggle above lets the user explicitly switch
            // back to viewing the still image even after a video exists.
            <video
              key={selected.id + ':' + selected.videoUrl}
              src={selected.videoUrl}
              poster={selected.imageUrl ?? undefined}
              controls
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : selectedMediaDisplayMode === 'image' && selected?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.imageUrl}
              alt="selected"
              className="h-full w-full cursor-zoom-in object-cover"
              onClick={() => selected.imageUrl && setZoomImageUrl(selected.imageUrl)}
              title={t('selectedShot.zoomTitle')}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <AppIcon name="image" className="h-8 w-8 text-text-tertiary" />
            </div>
          )}
          {isCurrentPanelVideoInFlight || isCurrentPanelImageInFlight ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas/75 backdrop-blur-sm">
              <AppIcon name="sparklesAlt" className="h-8 w-8 animate-pulse text-primary-400" />
              <div className="font-fraunces text-base italic text-primary-300">
                {isCurrentPanelVideoInFlight ? t('selectedShot.videoGeneratingFull') : t('selectedShot.imageGeneratingFull')}
              </div>
              <div className="px-6 text-center font-serif-cn text-xs text-text-secondary">
                {isCurrentPanelVideoInFlight
                  ? t('selectedShot.klingUpdateHint')
                  : t('selectedShot.tencentUpdateHint')}
              </div>
              <div className="mt-1 h-0.5 w-48 overflow-hidden rounded-full bg-overlay/60">
                <div className="h-full w-1/3 animate-[progressSlide_2s_linear_infinite] bg-gradient-to-r from-transparent via-primary-400 to-transparent" />
              </div>
            </div>
          ) : (() => {
            // Failure overlay for the Selected Shot — same logic as
            // the strip thumbnail. Renders only when the panel has
            // a recent failed task AND no live retry in flight.
            if (!selected) return null
            const failedImg = !selected.imageUrl && failedPanelImageIds.get(selected.id)
            const failedVid = !!selected.imageUrl && !selected.videoUrl && failedPanelVideoIds.get(selected.id)
            const failed = failedImg || failedVid
            if (!failed) return null
            const code = failed.errorCode ?? ''
            const isRateLimit = code === 'RATE_LIMIT'
            const isViolation = /Violation|Content/i.test(failed.errorMessage ?? '')
            const headline = isRateLimit
              ? t('panelFailure.rateLimit')
              : isViolation
                ? t('panelFailure.violation')
                : t('panelFailure.generic')
            const detail = isRateLimit
              ? t('panelFailure.rateLimitDetail')
              : isViolation
                ? t('panelFailure.violationDetail')
                : (failed.errorMessage ?? t('panelFailure.retryHint'))
            return (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-rose-950/85 backdrop-blur-sm">
                <AppIcon name="alert" className="h-8 w-8 text-rose-300" />
                <div className="font-fraunces text-base italic text-rose-200">
                  ✗ {headline}
                </div>
                <div className="px-6 text-center font-serif-cn text-xs text-rose-300/90">
                  {detail}
                </div>
              </div>
            )
          })()}
        </div>
        <div className="bg-raised/60 px-4 py-3">
          <div className="font-serif-cn text-text-primary">
            {t('selectedShot.shotLabel', { n: String(selectedIndex + 1).padStart(2, '0') })}
          </div>
          {selected?.videoUrl ? (
            <div className="mt-1 font-mono text-[14px] tracking-wider text-primary-500">
              {t('selectedShot.videoReady')}
            </div>
          ) : isCurrentPanelVideoInFlight ? (
            <div className="mt-1 flex items-center gap-1.5 font-mono text-[14px] tracking-wider text-primary-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary-400" />
              {t('selectedShot.videoGenerating')}
            </div>
          ) : selected?.imageUrl ? (
            <div className="mt-1 font-mono text-[14px] tracking-wider text-text-tertiary">
              {t('selectedShot.imageReadyVideoPending')}
            </div>
          ) : (
            <div className="mt-1 font-mono text-[14px] tracking-wider text-text-tertiary">{t('selectedShot.notGenerated')}</div>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={!selected || regenPanel.isPending || !canEdit || appearanceGenerationBlocked}
          onClick={() => {
            if (!selected || appearanceGenerationBlocked) return
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
                  // Trigger an immediate activeImageTasks refetch so the
                  // server-side set catches up faster than its 3s tick.
                  void activePanelImageTasks.refetch()
                },
              },
            )
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-border-soft bg-raised/50 py-2.5 font-serif-cn text-sm text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="image" className="h-3.5 w-3.5" />
          {regenPanel.isPending
            ? t('gallery.submitting')
            : selected?.imageUrl
              ? t('gallery.regenImage')
              : t('gallery.generateImage')}
        </button>
        <button
          type="button"
          disabled={!selected || !selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit || appearanceGenerationBlocked}
          onClick={() => onGenerateVideo()}
          title={
            !selected?.imageUrl
              ? t('genBlocked.needImageFirst')
              : isCurrentPanelVideoInFlight
                ? t('genBlocked.videoStillGenerating')
                : t('multiShot.tipKlingPerGroup')
          }
          className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-primary-500/40 bg-primary-500/10 py-2.5 font-serif-cn text-sm text-primary-400 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="play" className="h-3.5 w-3.5" />
          {generateVideo.isPending
            ? t('gallery.submitting')
            : isCurrentPanelVideoInFlight
              ? t('gallery.generating')
              : selected?.videoUrl
                ? t('gallery.regenVideoArrow')
                : t('gallery.generateVideo')}
        </button>
      </div>
      {/* 2026-05-17 — Seedance 2.0 (fal) alternate row. Lets the user
          force-use fal Seedance for this one shot without changing
          the project's default videoModel. Two variants: standard
          (1080p + native audio, slower / pricier) and Fast (cheap).
          Smaller, secondary visual weight so it doesn't compete with
          the project-default "生成視頻" CTA above. Disabled state
          tracks the same prerequisites (need image, no inflight). */}
      <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-text-tertiary">
        <span className="shrink-0">{t('gallery.fal.label')}</span>
        <button
          type="button"
          disabled={!selected || !selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit || appearanceGenerationBlocked}
          onClick={() => onGenerateVideo('fal::bytedance/seedance-2.0/image-to-video')}
          title={
            !selected?.imageUrl
              ? t('genBlocked.needImageFirst')
              : t('gallery.fal.seedanceTitle')
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-border-strong bg-raised/40 px-2 py-1.5 font-serif-cn text-[12px] text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="play" className="h-3 w-3" />
          {t('gallery.fal.seedance')} (1080p+audio)
        </button>
        <button
          type="button"
          disabled={!selected || !selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit || appearanceGenerationBlocked}
          onClick={() => onGenerateVideo('fal::bytedance/seedance-2.0/fast/image-to-video')}
          title={
            !selected?.imageUrl
              ? t('genBlocked.needImageFirst')
              : t('gallery.fal.fastTitle')
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-border-strong bg-raised/40 px-2 py-1.5 font-serif-cn text-[12px] text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="play" className="h-3 w-3" />
          {t('gallery.fal.seedance')} {t('gallery.fal.fast')}
        </button>
      </div>
      {/* Download row — surface the underlying COS URL as a direct
          download for users who want the raw asset for editing
          elsewhere (CapCut / 剪映 / PR). Disabled until the asset
          actually exists. <a download> uses the filename hint so
          the saved file gets a meaningful name instead of the
          cosKey hash. */}
      {selected ? (
        <div className="mt-3 flex items-center gap-3">
          <a
            href={selected.imageUrl ?? '#'}
            download={selected.imageUrl ? `panel-${String(selectedIndex + 1).padStart(2, '0')}.jpg` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!selected.imageUrl}
            onClick={(e) => { if (!selected.imageUrl) e.preventDefault() }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-sm border border-border-soft py-2 font-mono text-[14px] tracking-wider text-text-secondary transition-all ${
              selected.imageUrl
                ? 'hover:border-primary-500/40 hover:text-primary-400'
                : 'cursor-not-allowed opacity-40'
            }`}
          >
            <AppIcon name="download" className="h-3 w-3" />
            {t('downloads.staticImage')}
          </a>
          <a
            href={selected.videoUrl ?? '#'}
            download={selected.videoUrl ? `panel-${String(selectedIndex + 1).padStart(2, '0')}.mp4` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!selected.videoUrl}
            onClick={(e) => { if (!selected.videoUrl) e.preventDefault() }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-sm border border-border-soft py-2 font-mono text-[14px] tracking-wider text-text-secondary transition-all ${
              selected.videoUrl
                ? 'hover:border-primary-500/40 hover:text-primary-400'
                : 'cursor-not-allowed opacity-40'
            }`}
          >
            <AppIcon name="download" className="h-3 w-3" />
            {t('downloads.video')}
          </a>
        </div>
      ) : null}
      {regenPanel.isError ? (
        <p className="mt-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {(regenPanel.error as Error)?.message ?? t('regenResult.errorFallback')}
        </p>
      ) : null}
      {regenPanel.isSuccess ? (
        <p className="mt-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {t('regenResult.successQueued')}
        </p>
      ) : null}
    </div>
  )
}

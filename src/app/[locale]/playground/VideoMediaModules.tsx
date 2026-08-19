'use client'

/**
 * Per-family media modules for the Video studio's adaptive left column
 * (2026-07-12, Higgsfield-modeled):
 *   kling-o3  → compact 動作參考影片 slot (subjects live in ElementsModal)
 *   seedance  → unified media card (images + 命名 + 首幀/風格 mode + video)
 *   frames    → 首幀 + 尾幀 slots (lastFrameUrl pipeline)
 * ReferencePanel stays untouched for the Image studio.
 */

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  variantKeyForMode, variantModeMismatch, isVariantSuffixedKey,
} from '@/lib/video-models/variant-for-mode'
import { elementDotClass } from './PromptHighlight'
import type { PlaygroundController } from './usePlaygroundController'
import styles from './PlaygroundPresentation.module.css'

interface ModuleProps {
  ctrl: PlaygroundController
}

/** Compact reference-video slot shared by kling / seedance modules. */
export function RefVideoSlot({ ctrl }: ModuleProps) {
  const t = useTranslations('playground.videoMedia')
  const { refVideo, isBusy, videoInputRef, handleVideoPick, removeRefVideo } = ctrl
  return (
    <div className={styles.touchSurface} data-playground-touch-surface>
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-text-tertiary">
        {t('actionVideoTitle')} <span className="text-text-tertiary">({t('actionVideoLimit', { count: refVideo ? 1 : 0 })})</span>
      </div>
      {refVideo ? (
        <div className="flex items-center gap-2 rounded-sm border border-cyan-400/30 bg-cyan-400/5 p-1.5">
          <video src={refVideo.signedUrl} controls muted playsInline preload="metadata" className="h-12 w-20 rounded-sm object-cover" />
          <div className="flex-1 font-mono text-[10px] uppercase tracking-wider text-cyan-200">{t('bound')}</div>
          <button
            type="button"
            onClick={removeRefVideo}
            disabled={isBusy}
            aria-label={t('removeVideo')}
            className="rounded-sm border border-white/[0.12] px-1.5 py-0.5 font-mono text-[10px] text-text-secondary hover:border-rose-500/60 hover:text-rose-300"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-white/[0.12] bg-raised/30 py-2.5 text-text-tertiary hover:border-cyan-400/40 hover:text-cyan-200 disabled:opacity-40"
        >
          <AppIcon name="upload" className="h-4 w-4" />
          <span className="font-mono text-[11px]">{t('uploadVideo')}</span>
        </button>
      )}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleVideoPick}
      />
    </div>
  )
}

/** Seedance family: unified media card — images (named) + mode + video. */
export function SeedanceMediaModule({ ctrl }: ModuleProps) {
  const t = useTranslations('playground.videoMedia')
  const {
    refImages, refImagesCap, isBusy, imageInputRef,
    handleImagePick, removeRefImage, setRefImageName,
    videoRefMode, setVideoRefMode, modelKey, videoModels,
  } = ctrl
  return (
    <div className={`${styles.touchSurface} space-y-3 rounded-md border border-white/[0.08] bg-raised/30 p-3`} data-playground-touch-surface>
      <div className="font-mono text-[11px] uppercase tracking-wider text-text-tertiary">
        {t('title')} <span className="text-text-tertiary">{t('summary', {
          images: refImages.length,
          imageMax: refImagesCap,
          videos: ctrl.refVideo ? 1 : 0,
        })}</span>
      </div>

      {refImages.length > 0 ? (
        <div className="flex gap-1">
          {([
            { key: 'image', label: t('firstFrame') },
            { key: 'omni', label: t('styleReference') },
          ] as const).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setVideoRefMode(m.key)}
              className={`flex-1 rounded-sm border px-2 py-1 font-mono text-[10px] transition-colors ${
                videoRefMode === m.key
                  ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200'
                  : 'border-white/[0.12] text-text-tertiary hover:text-text-primary'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
      {refImages.length > 0 ? (() => {
        const keys = videoModels.map((m) => m.value)
        const eff = variantKeyForMode(modelKey, videoRefMode, keys)
        if (eff !== modelKey) {
          const label = videoModels.find((m) => m.value === eff)?.label ?? eff
          return <div className="font-mono text-[10px] text-text-tertiary">{t('autoMatched', { label })}</div>
        }
        if (variantModeMismatch(modelKey, videoRefMode)) {
          return <div className="font-mono text-[10px] text-amber-400">{t('variantRequired', { variant: videoRefMode === 'image' ? 'I2V' : 'R2V' })}</div>
        }
        if (isVariantSuffixedKey(modelKey)) {
          return <div className="font-mono text-[10px] text-text-tertiary">{t('currentVariant', {
            mode: videoRefMode === 'image' ? t('firstFrameEndpoint') : t('referenceEndpoint'),
          })}</div>
        }
        return null
      })() : null}

      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={isBusy || refImages.length >= refImagesCap}
          aria-label={t('addImage')}
          className="aspect-square rounded-sm border border-dashed border-white/[0.12] text-lg text-text-tertiary hover:border-cyan-400/60 hover:text-cyan-200 disabled:opacity-40"
        >
          ＋
        </button>
        <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImagePick} />
        {refImages.map((ref, idx) => (
          <div key={ref.key} className="min-w-0">
            <div className="group relative aspect-square overflow-hidden rounded-sm border border-cyan-400/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ref.signedUrl} alt={t('imageAlt', { index: idx + 1 })} className="h-full w-full object-cover" />
              <div className="absolute left-1 top-1 rounded-sm bg-canvas/80 px-1 font-mono text-[10px] text-cyan-200">{idx + 1}</div>
              <button
                type="button"
                onClick={() => removeRefImage(idx)}
                aria-label={t('removeImage', { index: idx + 1 })}
                className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-sm bg-canvas/80 text-text-secondary opacity-0 hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
              >
                ×
              </button>
            </div>
            <div className="mt-1 flex items-center gap-1">
              {ref.name?.trim() ? (
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${elementDotClass(refImages.slice(0, idx).filter((r) => r.name?.trim()).length)}`} />
              ) : null}
              <input
                type="text"
                value={ref.name ?? ''}
                onChange={(e) => setRefImageName(ref.key, e.target.value)}
                disabled={isBusy}
                placeholder={t('namePlaceholder')}
                maxLength={80}
                title={t('nameHelp')}
                className="min-w-0 flex-1 rounded-sm border border-white/[0.08] bg-canvas/60 px-1 py-0.5 text-center font-mono text-[10px] text-text-secondary outline-none placeholder:text-text-tertiary focus:border-cyan-400/50"
              />
            </div>
          </div>
        ))}
      </div>

      <RefVideoSlot ctrl={ctrl} />
    </div>
  )
}

/** frames family: 首幀 + 尾幀 slots. */
export function FramesMediaModule({ ctrl }: ModuleProps) {
  const t = useTranslations('playground.videoMedia')
  const {
    refImages, isBusy, imageInputRef, handleImagePick, removeRefImage,
    endFrame, handleEndFramePick, removeEndFrame,
  } = ctrl
  const startFrame = refImages[0] ?? null
  return (
    <div className={`${styles.touchSurface} grid grid-cols-2 gap-2`} data-playground-touch-surface>
      {[
        {
          label: t('startFrame'), img: startFrame,
          pick: () => imageInputRef.current?.click(),
          remove: () => removeRefImage(0),
          input: (
            <input key="s" ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImagePick} />
          ),
        },
        {
          label: t('endFrame'), img: endFrame,
          pick: () => document.getElementById('pg-endframe-input')?.click(),
          remove: removeEndFrame,
          input: (
            <input key="e" id="pg-endframe-input" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleEndFramePick} />
          ),
        },
      ].map((slot) => (
        <div key={slot.label}>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-tertiary">{slot.label}</div>
          {slot.img ? (
            <div className="group relative aspect-video overflow-hidden rounded-sm border border-cyan-400/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slot.img.signedUrl} alt={slot.label} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={slot.remove}
                disabled={isBusy}
                aria-label={t('removeImage', { index: slot.label })}
                className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-sm bg-canvas/80 text-text-secondary opacity-0 hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={slot.pick}
              disabled={isBusy}
              className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-white/[0.12] bg-raised/30 text-text-tertiary hover:border-cyan-400/40 hover:text-cyan-200 disabled:opacity-40"
            >
              <AppIcon name="plus" className="h-4 w-4" />
              <span className="font-mono text-[10px]">{t('upload')}</span>
            </button>
          )}
          {slot.input}
        </div>
      ))}
    </div>
  )
}

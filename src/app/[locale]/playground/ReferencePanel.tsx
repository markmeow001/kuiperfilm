'use client'

/**
 * Reference素材 panel — reference images grid + (video) first-frame/style mode
 * selector + reference video upload + reference text. Shared by the Image
 * studio's 「＋素材」 popover and the Video studio's left params column so the
 * upload/binding logic lives in exactly one place.
 */

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  variantKeyForMode, variantModeMismatch, isVariantSuffixedKey,
} from '@/lib/video-models/variant-for-mode'
import { elementDotClass } from './PromptHighlight'
import { MAX_REF_VIDEOS, type PlaygroundController } from './usePlaygroundController'
import styles from './PlaygroundPresentation.module.css'

interface ReferencePanelProps {
  ctrl: PlaygroundController
}

export function ReferencePanel({ ctrl }: ReferencePanelProps) {
  const t = useTranslations('playground.reference')
  const {
    outputType, refImages, refVideo, refText, setRefText,
    videoRefMode, setVideoRefMode, modelKey, videoModels,
    isBusy, imageInputRef, videoInputRef,
    handleImagePick, handleVideoPick, removeRefImage, removeRefVideo,
    insertReferenceToken, isKlingO3Model, refImagesCap, setRefImageName,
  } = ctrl

  return (
    <div className={`${styles.touchSurface} space-y-4`} data-playground-touch-surface>
      {/* Reference images */}
      <div>
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-tertiary">
          {t('title')} <span className="text-cyan-300">({t('imageLimit', { count: refImages.length, max: refImagesCap })})</span>
          <span className="ml-2 text-text-tertiary">{t('imageHelp')}</span>
        </div>

        {/* 首幀/風格 mode toggle — Kling O3 has a single r2v endpoint, the
            toggle drives nothing there (handleRun skips variantKeyForMode);
            hide it to avoid a dead control. (2026-07-10 review LOW) */}
        {outputType === 'video' && refImages.length > 0 && !isKlingO3Model ? (
          <div className="mb-2">
            <div className="flex gap-1">
              {([
                { key: 'image', label: t('firstFrameMode') },
                { key: 'omni', label: t('styleMode') },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setVideoRefMode(m.key)}
                  className={`flex-1 rounded-sm border px-2 py-1.5 font-mono text-[11px] transition-colors ${
                    videoRefMode === m.key
                      ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200'
                      : 'border-white/[0.12] text-text-tertiary hover:text-text-primary'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {(() => {
              const keys = videoModels.map((m) => m.value)
              const eff = variantKeyForMode(modelKey, videoRefMode, keys)
              const notes: string[] = []
              if (videoRefMode === 'image' && refImages.length > 1) notes.push(t('firstFrameOnly'))
              if (eff !== modelKey) {
                const label = videoModels.find((m) => m.value === eff)?.label ?? eff
                notes.push(t('autoMatched', { label }))
              } else if (variantModeMismatch(modelKey, videoRefMode)) {
                const want = videoRefMode === 'image' ? 'I2V' : 'R2V'
                return <div className="mt-1 font-mono text-[10px] text-amber-400">{t('variantRequired', { variant: want })}</div>
              } else if (isVariantSuffixedKey(modelKey)) {
                notes.push(t('currentVariant', {
                  mode: videoRefMode === 'image' ? t('firstFrameEndpoint') : t('referenceEndpoint'),
                }))
              } else {
                notes.push(t('modelModeCaveat'))
              }
              return <div className="mt-1 font-mono text-[10px] text-text-tertiary">{notes.join(' · ')}</div>
            })()}
          </div>
        ) : null}

        <div className="grid grid-cols-5 gap-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isBusy || refImages.length >= refImagesCap}
            aria-label={t('addImage')}
            className="aspect-square rounded-sm border border-dashed border-white/[0.12] text-xl text-text-tertiary transition-all hover:border-cyan-400/60 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ＋
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleImagePick}
          />
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
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-sm bg-canvas/80 text-text-secondary opacity-0 transition-opacity hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
              {/* 命名（選填）— video only. Non-Kling: the worker prepends a
                  參考圖對應 map binding this name to image N; Kling O3: a
                  named image becomes a single-image bound subject. */}
              {outputType === 'video' ? (
                <div className="mt-1 flex items-center gap-1">
                  {ref.name?.trim() ? (
                    <span
                      className={`h-2 w-2 flex-shrink-0 rounded-full ${elementDotClass(
                        (isKlingO3Model ? ctrl.elements.length : 0)
                        + refImages.slice(0, idx).filter((r) => r.name?.trim()).length,
                      )}`}
                      title={t('namedTokenHint')}
                    />
                  ) : null}
                  <input
                    type="text"
                    value={ref.name ?? ''}
                    onChange={(e) => setRefImageName(ref.key, e.target.value)}
                    disabled={isBusy}
                    placeholder={t('namePlaceholder')}
                    maxLength={80}
                    title={isKlingO3Model
                      ? t('klingNameHelp')
                      : t('standardNameHelp')}
                    className="min-w-0 flex-1 rounded-sm border border-white/[0.08] bg-canvas/60 px-1 py-0.5 text-center font-mono text-[10px] text-text-secondary outline-none placeholder:text-text-tertiary focus:border-cyan-400/50"
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* @-token quick-insert row — dropped in the 2026-07-08 studio split
            (insertReferenceToken kept working in the controller but nothing
            rendered the chips); restored 2026-07-10 per user report. Click a
            chip → the token lands at the prompt caret. */}
        {(refImages.length > 0 || refVideo) ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-text-tertiary">{t('tokens')}</span>
            {refImages.map((ref, idx) => {
              // Named image: insert the NAME (that's what the 參考圖對應 map /
              // Kling element binds on); unnamed: positional @imageN.
              const named = ref.name?.trim()
              const token = named || `@image${idx + 1}`
              return (
                <button
                  type="button"
                  key={`tok-${ref.key}`}
                  onClick={() => insertReferenceToken(token)}
                  title={named
                    ? t('insertNamedToken', { name: named, index: idx + 1 })
                    : t('insertImageToken', { index: idx + 1 })}
                  className="rounded-sm border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 font-mono text-[11px] text-cyan-200 hover:bg-cyan-400/15"
                >
                  {named ? `${idx + 1}·${named}` : token}
                </button>
              )
            })}
            {refVideo ? (
              <button
                type="button"
                onClick={() => insertReferenceToken('@video1')}
                title={t('insertVideoToken')}
                className="rounded-sm border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 font-mono text-[11px] text-cyan-200 hover:bg-cyan-400/15"
              >
                @video1
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Reference video */}
      <div>
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-tertiary">
          {t('videoTitle')} <span className="text-cyan-300">({t('videoLimit', { count: refVideo ? 1 : 0, max: MAX_REF_VIDEOS })})</span>
        </div>
        {refVideo ? (
          <div className="flex items-center gap-3 rounded-sm border border-cyan-400/30 bg-cyan-400/5 p-2">
            <video src={refVideo.signedUrl} controls muted playsInline preload="metadata" className="h-16 w-28 rounded-sm object-cover" />
            <div className="flex-1 font-mono text-[11px] uppercase tracking-wider text-cyan-200">{t('videoBound')}</div>
            <button
              type="button"
              onClick={removeRefVideo}
              disabled={isBusy}
              aria-label={t('removeVideo')}
              className="rounded-sm border border-white/[0.12] px-2 py-1 font-mono text-[11px] text-text-secondary hover:border-rose-500/60 hover:text-rose-300"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={isBusy}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-white/[0.12] bg-raised/30 p-5 text-text-tertiary transition-all hover:border-cyan-400/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name="upload" className="h-6 w-6" />
            <div className="text-[12px]">{t('uploadVideo')}</div>
            <div className="font-mono text-[10px] text-text-tertiary">{t('videoHelp')}</div>
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

      {/* Reference text */}
      <div>
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-tertiary">
          {t('textTitle')} <span className="text-text-tertiary">({t('optional')})</span>
        </div>
        <input
          type="text"
          value={refText}
          onChange={(e) => setRefText(e.target.value)}
          placeholder={t('textPlaceholder')}
          className="w-full rounded-sm border border-white/[0.08] bg-raised/40 px-3 py-2 text-[13px] text-text-secondary placeholder:text-text-tertiary outline-none focus:border-cyan-400/50"
        />
      </div>
    </div>
  )
}

'use client'

/**
 * Reference素材 panel — reference images grid + (video) first-frame/style mode
 * selector + reference video upload + reference text. Shared by the Image
 * studio's 「＋素材」 popover and the Video studio's left params column so the
 * upload/binding logic lives in exactly one place.
 */

import { AppIcon } from '@/components/ui/icons'
import {
  variantKeyForMode, variantModeMismatch, isVariantSuffixedKey,
} from '@/lib/video-models/variant-for-mode'
import { elementDotClass } from './PromptHighlight'
import { MAX_REF_VIDEOS, type PlaygroundController } from './usePlaygroundController'

interface ReferencePanelProps {
  ctrl: PlaygroundController
}

export function ReferencePanel({ ctrl }: ReferencePanelProps) {
  const {
    outputType, refImages, refVideo, refText, setRefText,
    videoRefMode, setVideoRefMode, modelKey, videoModels,
    isBusy, imageInputRef, videoInputRef,
    handleImagePick, handleVideoPick, removeRefImage, removeRefVideo,
    insertReferenceToken, isKlingO3Model, refImagesCap, setRefImageName,
  } = ctrl

  return (
    <div className="space-y-4">
      {/* Reference images */}
      <div>
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-stone-500">
          參考圖片 <span className="text-violet-400">({refImages.length}/{refImagesCap})</span>
          <span className="ml-2 text-stone-600">jpg/png/webp · ≤10MB</span>
        </div>

        {/* 首幀/風格 mode toggle — Kling O3 has a single r2v endpoint, the
            toggle drives nothing there (handleRun skips variantKeyForMode);
            hide it to avoid a dead control. (2026-07-10 review LOW) */}
        {outputType === 'video' && refImages.length > 0 && !isKlingO3Model ? (
          <div className="mb-2">
            <div className="flex gap-1">
              {([
                { key: 'image', label: '首幀（畫面從這張圖開始）' },
                { key: 'omni', label: '風格 / 角色參考' },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setVideoRefMode(m.key)}
                  className={`flex-1 rounded-sm border px-2 py-1.5 font-mono text-[11px] transition-colors ${
                    videoRefMode === m.key
                      ? 'border-violet-500/60 bg-violet-500/10 text-violet-300'
                      : 'border-stone-700 text-stone-500 hover:text-stone-300'
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
              if (videoRefMode === 'image' && refImages.length > 1) notes.push('首幀模式僅使用第 1 張參考圖')
              if (eff !== modelKey) {
                const label = videoModels.find((m) => m.value === eff)?.label ?? eff
                notes.push(`已自動匹配端點：${label}`)
              } else if (variantModeMismatch(modelKey, videoRefMode)) {
                const want = videoRefMode === 'image' ? 'I2V' : 'R2V'
                return <div className="mt-1 font-mono text-[10px] text-amber-400">此模式需要 {want} 端點變體 — 請到 /profile 啟用對應模型</div>
              } else if (isVariantSuffixedKey(modelKey)) {
                notes.push(`✓ 當前模型已是${videoRefMode === 'image' ? ' I2V 首幀' : ' R2V 參考'}端點`)
              } else {
                notes.push('⚠ 此模型不分首幀/參考端點，參考圖語義由模型自身決定（要確保首幀請改用 Seedance I2V）')
              }
              return <div className="mt-1 font-mono text-[10px] text-stone-500">{notes.join(' · ')}</div>
            })()}
          </div>
        ) : null}

        <div className="grid grid-cols-5 gap-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isBusy || refImages.length >= refImagesCap}
            className="aspect-square rounded-sm border border-dashed border-stone-700 text-xl text-stone-500 transition-all hover:border-violet-500/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
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
              <div className="group relative aspect-square overflow-hidden rounded-sm border border-violet-500/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ref.signedUrl} alt={`ref ${idx + 1}`} className="h-full w-full object-cover" />
                <div className="absolute left-1 top-1 rounded-sm bg-stone-950/80 px-1 font-mono text-[10px] text-amber-300">{idx + 1}</div>
                <button
                  type="button"
                  onClick={() => removeRefImage(idx)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-sm bg-stone-950/80 text-stone-300 opacity-0 transition-opacity hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
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
                      title="prompt 中此名字會以同色標示"
                    />
                  ) : null}
                  <input
                    type="text"
                    value={ref.name ?? ''}
                    onChange={(e) => setRefImageName(ref.key, e.target.value)}
                    disabled={isBusy}
                    placeholder="命名"
                    maxLength={80}
                    title={isKlingO3Model
                      ? '命名後此圖成為具名主體，prompt 打名字即綁定'
                      : '命名後送出時自動附「參考圖對應」表，模型才知道 @名字 對應哪張圖'}
                    className="min-w-0 flex-1 rounded-sm border border-stone-800 bg-stone-950/60 px-1 py-0.5 text-center font-mono text-[10px] text-stone-300 outline-none placeholder:text-stone-700 focus:border-violet-500/40"
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
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-stone-600">引用</span>
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
                    ? `插入「${named}」（已綁定第 ${idx + 1} 張參考圖）`
                    : `插入 @image${idx + 1} 引用第 ${idx + 1} 張參考圖`}
                  className="rounded-sm border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] text-violet-300 hover:bg-violet-500/20"
                >
                  {named ? `${idx + 1}·${named}` : token}
                </button>
              )
            })}
            {refVideo ? (
              <button
                type="button"
                onClick={() => insertReferenceToken('@video1')}
                title="插入 @video1 引用參考影片"
                className="rounded-sm border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] text-violet-300 hover:bg-violet-500/20"
              >
                @video1
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Reference video */}
      <div>
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-stone-500">
          參考影片 <span className="text-violet-400">({refVideo ? 1 : 0}/{MAX_REF_VIDEOS})</span>
        </div>
        {refVideo ? (
          <div className="flex items-center gap-3 rounded-sm border border-violet-500/30 bg-violet-500/5 p-2">
            <video src={refVideo.signedUrl} controls muted playsInline preload="metadata" className="h-16 w-28 rounded-sm object-cover" />
            <div className="flex-1 font-mono text-[11px] uppercase tracking-wider text-violet-300">動作參考已綁</div>
            <button
              type="button"
              onClick={removeRefVideo}
              disabled={isBusy}
              className="rounded-sm border border-stone-700 px-2 py-1 font-mono text-[11px] text-stone-400 hover:border-rose-500/60 hover:text-rose-300"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={isBusy}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-stone-700 bg-stone-900/30 p-5 text-stone-500 transition-all hover:border-violet-500/40 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name="upload" className="h-6 w-6" />
            <div className="text-[12px]">可拖曳檔案至此，或點擊上傳</div>
            <div className="font-mono text-[10px] text-stone-600">mp4/mov/webm · ≤150MB · 建議 ≤15s</div>
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
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-stone-500">
          參考文字 <span className="text-stone-600">(選填)</span>
        </div>
        <input
          type="text"
          value={refText}
          onChange={(e) => setRefText(e.target.value)}
          placeholder="風格 / 旁白 / 隱喻 等補充..."
          className="w-full rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-2 text-[13px] text-stone-300 placeholder:text-stone-600 outline-none focus:border-amber-500/40"
        />
      </div>
    </div>
  )
}

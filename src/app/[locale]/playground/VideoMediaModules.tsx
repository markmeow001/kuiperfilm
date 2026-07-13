'use client'

/**
 * Per-family media modules for the Video studio's adaptive left column
 * (2026-07-12, Higgsfield-modeled):
 *   kling-o3  → compact 動作參考影片 slot (subjects live in ElementsModal)
 *   seedance  → unified media card (images + 命名 + 首幀/風格 mode + video)
 *   frames    → 首幀 + 尾幀 slots (lastFrameUrl pipeline)
 * ReferencePanel stays untouched for the Image studio.
 */

import { AppIcon } from '@/components/ui/icons'
import {
  variantKeyForMode, variantModeMismatch, isVariantSuffixedKey,
} from '@/lib/video-models/variant-for-mode'
import { elementDotClass } from './PromptHighlight'
import type { PlaygroundController } from './usePlaygroundController'

interface ModuleProps {
  ctrl: PlaygroundController
}

/** Compact reference-video slot shared by kling / seedance modules. */
export function RefVideoSlot({ ctrl }: ModuleProps) {
  const { refVideo, isBusy, videoInputRef, handleVideoPick, removeRefVideo } = ctrl
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-stone-500">
        動作參考影片 <span className="text-stone-600">({refVideo ? 1 : 0}/1 · ≤15s)</span>
      </div>
      {refVideo ? (
        <div className="flex items-center gap-2 rounded-sm border border-violet-500/30 bg-violet-500/5 p-1.5">
          <video src={refVideo.signedUrl} controls muted playsInline preload="metadata" className="h-12 w-20 rounded-sm object-cover" />
          <div className="flex-1 font-mono text-[10px] uppercase tracking-wider text-violet-300">已綁定</div>
          <button
            type="button"
            onClick={removeRefVideo}
            disabled={isBusy}
            className="rounded-sm border border-stone-700 px-1.5 py-0.5 font-mono text-[10px] text-stone-400 hover:border-rose-500/60 hover:text-rose-300"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-stone-700 bg-stone-900/30 py-2.5 text-stone-500 hover:border-violet-500/40 hover:text-violet-300 disabled:opacity-40"
        >
          <AppIcon name="upload" className="h-4 w-4" />
          <span className="font-mono text-[11px]">上傳（mp4/mov/webm）</span>
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
  const {
    refImages, refImagesCap, isBusy, imageInputRef,
    handleImagePick, removeRefImage, setRefImageName,
    videoRefMode, setVideoRefMode, modelKey, videoModels,
  } = ctrl
  return (
    <div className="space-y-3 rounded-md border border-stone-800 bg-stone-900/30 p-3">
      <div className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
        上傳媒體 <span className="text-stone-600">圖片 {refImages.length}/{refImagesCap} · 影片 {ctrl.refVideo ? 1 : 0}/1</span>
      </div>

      {refImages.length > 0 ? (
        <div className="flex gap-1">
          {([
            { key: 'image', label: '首幀' },
            { key: 'omni', label: '風格 / 角色參考' },
          ] as const).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setVideoRefMode(m.key)}
              className={`flex-1 rounded-sm border px-2 py-1 font-mono text-[10px] transition-colors ${
                videoRefMode === m.key
                  ? 'border-violet-500/60 bg-violet-500/10 text-violet-300'
                  : 'border-stone-700 text-stone-500 hover:text-stone-300'
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
          return <div className="font-mono text-[10px] text-stone-500">已自動匹配端點：{label}</div>
        }
        if (variantModeMismatch(modelKey, videoRefMode)) {
          return <div className="font-mono text-[10px] text-amber-400">此模式需要 {videoRefMode === 'image' ? 'I2V' : 'R2V'} 端點變體 — 請到 /profile 啟用</div>
        }
        if (isVariantSuffixedKey(modelKey)) {
          return <div className="font-mono text-[10px] text-stone-500">✓ 當前模型已是{videoRefMode === 'image' ? ' I2V 首幀' : ' R2V 參考'}端點</div>
        }
        return null
      })() : null}

      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={isBusy || refImages.length >= refImagesCap}
          className="aspect-square rounded-sm border border-dashed border-stone-700 text-lg text-stone-500 hover:border-violet-500/60 hover:text-violet-300 disabled:opacity-40"
        >
          ＋
        </button>
        <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImagePick} />
        {refImages.map((ref, idx) => (
          <div key={ref.key} className="min-w-0">
            <div className="group relative aspect-square overflow-hidden rounded-sm border border-violet-500/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ref.signedUrl} alt={`ref ${idx + 1}`} className="h-full w-full object-cover" />
              <div className="absolute left-1 top-1 rounded-sm bg-stone-950/80 px-1 font-mono text-[10px] text-amber-300">{idx + 1}</div>
              <button
                type="button"
                onClick={() => removeRefImage(idx)}
                className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-sm bg-stone-950/80 text-stone-300 opacity-0 hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
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
                placeholder="命名"
                maxLength={80}
                title="命名後送出時自動附「參考圖對應」表，prompt 打名字即綁定"
                className="min-w-0 flex-1 rounded-sm border border-stone-800 bg-stone-950/60 px-1 py-0.5 text-center font-mono text-[10px] text-stone-300 outline-none placeholder:text-stone-700 focus:border-violet-500/40"
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
  const {
    refImages, isBusy, imageInputRef, handleImagePick, removeRefImage,
    endFrame, handleEndFramePick, removeEndFrame,
  } = ctrl
  const startFrame = refImages[0] ?? null
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        {
          label: '首幀', img: startFrame,
          pick: () => imageInputRef.current?.click(),
          remove: () => removeRefImage(0),
          input: (
            <input key="s" ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImagePick} />
          ),
        },
        {
          label: '尾幀（選填）', img: endFrame,
          pick: () => document.getElementById('pg-endframe-input')?.click(),
          remove: removeEndFrame,
          input: (
            <input key="e" id="pg-endframe-input" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleEndFramePick} />
          ),
        },
      ].map((slot) => (
        <div key={slot.label}>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-stone-600">{slot.label}</div>
          {slot.img ? (
            <div className="group relative aspect-video overflow-hidden rounded-sm border border-violet-500/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slot.img.signedUrl} alt={slot.label} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={slot.remove}
                disabled={isBusy}
                className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-sm bg-stone-950/80 text-stone-300 opacity-0 hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={slot.pick}
              disabled={isBusy}
              className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-stone-700 bg-stone-900/30 text-stone-500 hover:border-violet-500/40 hover:text-violet-300 disabled:opacity-40"
            >
              <AppIcon name="plus" className="h-4 w-4" />
              <span className="font-mono text-[10px]">上傳</span>
            </button>
          )}
          {slot.input}
        </div>
      ))}
    </div>
  )
}

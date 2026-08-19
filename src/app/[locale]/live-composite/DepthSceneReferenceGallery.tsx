'use client'

import { useRef } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  DEPTH_REFERENCE_NOTE_MAX_CHARS,
  DEPTH_SCENE_DESCRIPTION_MAX_CHARS,
} from './lib/depth-rebuild-workflow'
import { DepthDescriptionAssist } from './DepthDescriptionAssist'
import type { DepthRebuildSceneView } from './depth-rebuild-ui-types'

interface DepthSceneReferenceGalleryProps {
  scenes: readonly DepthRebuildSceneView[]
  brief: string
  description: string
  uploadDisabled: boolean
  controlsDisabled: boolean
  assistBusy: boolean
  onAddImages: (files: readonly File[]) => void
  onRemoveImage: (sceneId: string) => void
  onPreviewError: (sceneId: string) => void
  onNoteChange: (sceneId: string, value: string) => void
  onBriefChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onAssist: () => void
}

export function DepthSceneReferenceGallery({
  scenes,
  brief,
  description,
  uploadDisabled,
  controlsDisabled,
  assistBusy,
  onAddImages,
  onRemoveImage,
  onPreviewError,
  onNoteChange,
  onBriefChange,
  onDescriptionChange,
  onAssist,
}: DepthSceneReferenceGalleryProps) {
  const inputId = 'depth-rebuild-scenes'
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.025] p-3" aria-labelledby="depth-scene-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 id="depth-scene-title" className="text-sm font-medium text-stone-200">新場景參考</h4>
          <p className="mt-1 text-[11px] leading-5 text-stone-500">
            可一次選多張；它們固定建築、材質、色調與空間方向，人物圖與場景圖共用 9 張上限。
          </p>
        </div>
        <span className="shrink-0 text-xs text-stone-500">選填</span>
      </div>

      {scenes.length > 0 ? (
        <div className="mt-3 space-y-2">
          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              role="group"
              aria-label={`場景參考 ${index + 1}`}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scene.reference.url}
                alt={`場景參考 ${index + 1}`}
                onError={() => onPreviewError(scene.id)}
                className="h-14 w-14 shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-stone-300">{scene.reference.name}</p>
                <input
                  type="text"
                  value={scene.note}
                  maxLength={DEPTH_REFERENCE_NOTE_MAX_CHARS}
                  aria-label={`場景參考 ${index + 1} 的用途`}
                  disabled={controlsDisabled}
                  onChange={(event) => onNoteChange(scene.id, event.target.value)}
                  placeholder="這張圖的用途，例如：主建築與庭院構圖"
                  className="mt-1.5 min-h-11 w-full border-0 border-b border-white/10 bg-transparent px-1 py-2 text-xs text-stone-300 outline-none placeholder:text-stone-600 focus-visible:border-cyan-300/50 focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                />
              </div>
              <button
                type="button"
                aria-label={`移除場景參考 ${index + 1}`}
                onClick={() => onRemoveImage(scene.id)}
                disabled={controlsDisabled}
                className="min-h-11 rounded-md border border-white/10 px-3 py-2 text-xs text-stone-400 hover:border-red-300/30 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:opacity-40"
              >
                移除
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative mt-3">
        <button
          ref={triggerRef}
          type="button"
          disabled={uploadDisabled || controlsDisabled}
          onClick={() => inputRef.current?.click()}
          className={`flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
            uploadDisabled || controlsDisabled
              ? 'cursor-not-allowed border-white/10 text-stone-600 opacity-50'
              : 'border-cyan-300/25 text-stone-400 hover:border-cyan-200/45 hover:text-cyan-100'
          }`}
        >
          <AppIcon name="plus" className="h-4 w-4" />
          新增場景參考圖片
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          aria-label="新增場景參考圖片"
          tabIndex={-1}
          disabled={controlsDisabled || uploadDisabled}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (files.length > 0) {
              onAddImages(files)
              triggerRef.current?.focus({ preventScroll: true })
            }
          }}
        />
      </div>

      <div className="mt-4">
        <DepthDescriptionAssist
          id="depth-scene-brief"
          subjectLabel="新場景與持續動態"
          value={brief}
          placeholder="例如：雨夜上海法租界，電車、路人和霓虹倒影持續移動"
          busy={assistBusy}
          disabled={controlsDisabled}
          onChange={onBriefChange}
          onAssist={onAssist}
        />
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-stone-400">場景與動態描述</span>
        <textarea
          value={description}
          maxLength={DEPTH_SCENE_DESCRIPTION_MAX_CHARS}
          disabled={controlsDisabled}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="描述年代、地點、天氣、建築、光影，以及路人、車輛、旗幟、雨霧、反射等持續運動；背景需隨原片運鏡產生自然視差。"
          className="min-h-28 w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-stone-200 outline-none placeholder:text-stone-600 focus-visible:border-cyan-300/45 focus-visible:ring-2 focus-visible:ring-cyan-300/70"
        />
        <span className="mt-1 block text-right font-mono text-[10px] text-stone-600">
          {description.length}/{DEPTH_SCENE_DESCRIPTION_MAX_CHARS}
        </span>
      </label>
    </section>
  )
}

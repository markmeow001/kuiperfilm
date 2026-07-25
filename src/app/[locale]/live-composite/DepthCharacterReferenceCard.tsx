'use client'

import { useRef } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  DEPTH_CHARACTER_BINDING_MAX_CHARS,
  DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS,
  DEPTH_CHARACTER_LABEL_MAX_CHARS,
} from './lib/depth-rebuild-workflow'
import { DepthDescriptionAssist } from './DepthDescriptionAssist'
import type { DepthRebuildCharacterView } from './depth-rebuild-ui-types'

interface DepthCharacterReferenceCardProps {
  character: DepthRebuildCharacterView
  ordinal: number
  canRemove: boolean
  controlsDisabled: boolean
  assistBusy: boolean
  onSelectImage: (file: File) => void
  onPreviewError: () => void
  onRemoveImage: () => void
  onRemoveCharacter: () => void
  onLabelChange: (value: string) => void
  onSourceBindingChange: (value: string) => void
  onBriefChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onAssist: () => void
}

export function DepthCharacterReferenceCard({
  character,
  ordinal,
  canRemove,
  controlsDisabled,
  assistBusy,
  onSelectImage,
  onPreviewError,
  onRemoveImage,
  onRemoveCharacter,
  onLabelChange,
  onSourceBindingChange,
  onBriefChange,
  onDescriptionChange,
  onAssist,
}: DepthCharacterReferenceCardProps) {
  const imageInputId = `depth-rebuild-character-${character.id}`
  const titleId = `depth-rebuild-character-title-${character.id}`
  const displayName = character.label.trim() || `角色 ${ordinal}`
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageTriggerRef = useRef<HTMLButtonElement>(null)
  const imageInputLabel = character.reference
    ? `更換${displayName}的參考圖片`
    : `上傳角色 ${String(ordinal).padStart(2, '0')} 參考圖片`

  return (
    <article aria-labelledby={titleId} className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h5 id={titleId} className="font-mono text-[11px] text-cyan-300">
            角色 {String(ordinal).padStart(2, '0')}
          </h5>
          <span className="text-[11px] text-stone-600">文字順序綁定</span>
        </div>
        <button
          type="button"
          aria-label={`移除${displayName}`}
          disabled={controlsDisabled || !canRemove}
          onClick={onRemoveCharacter}
          className="text-xs text-stone-500 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          移除角色
        </button>
      </div>

      <div
        className={`relative mt-3 ${
          character.reference
            ? 'flex items-center gap-3 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.035] p-2'
            : ''
        }`}
      >
        {character.reference ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={character.reference.url}
              alt={`${character.label || `角色 ${ordinal}`}參考預覽`}
              onError={onPreviewError}
              className="h-16 w-16 shrink-0 rounded-md object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-stone-300">{character.reference.name}</span>
          </>
        ) : null}
        <button
          ref={imageTriggerRef}
          type="button"
          disabled={controlsDisabled}
          onClick={() => imageInputRef.current?.click()}
          className={
            character.reference
              ? `rounded-md border border-white/10 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                  controlsDisabled ? 'cursor-not-allowed text-stone-600' : 'text-stone-400 hover:text-cyan-100'
                }`
              : `flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-dashed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                  controlsDisabled
                    ? 'cursor-not-allowed border-white/10 text-stone-600 opacity-50'
                    : 'border-cyan-300/25 text-stone-400 hover:border-cyan-200/45 hover:text-cyan-100'
                }`
          }
        >
          {!character.reference ? <AppIcon name="imageEdit" className="h-4 w-4" /> : null}
          {character.reference ? '更換' : `上傳角色 ${String(ordinal).padStart(2, '0')} 參考圖片`}
        </button>
        {character.reference ? (
          <button
            type="button"
            aria-label={`移除${displayName}的參考圖片`}
            onClick={onRemoveImage}
            disabled={controlsDisabled}
            className="rounded-md border border-white/10 px-2 py-1 text-xs text-stone-400 hover:text-rose-200 disabled:opacity-40"
          >
            移除圖片
          </button>
        ) : null}
        <input
          ref={imageInputRef}
          id={imageInputId}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          aria-label={imageInputLabel}
          tabIndex={-1}
          disabled={controlsDisabled}
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) {
              onSelectImage(file)
              imageTriggerRef.current?.focus({ preventScroll: true })
            }
          }}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-stone-400">新角色名稱</span>
          <input
            type="text"
            value={character.label}
            maxLength={DEPTH_CHARACTER_LABEL_MAX_CHARS}
            disabled={controlsDisabled}
            onChange={(event) => onLabelChange(event.target.value)}
            placeholder="例如：新郎／角色 A"
            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-stone-200 outline-none placeholder:text-stone-600 focus:border-cyan-300/45"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-stone-400">要替換原片中的誰</span>
          <input
            type="text"
            value={character.sourceBinding}
            maxLength={DEPTH_CHARACTER_BINDING_MAX_CHARS}
            disabled={controlsDisabled}
            onChange={(event) => onSourceBindingChange(event.target.value)}
            placeholder="例如：開場畫面左側、手拿花束的男性"
            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-stone-200 outline-none placeholder:text-stone-600 focus:border-cyan-300/45"
          />
        </label>
      </div>

      <div className="mt-3">
        <DepthDescriptionAssist
          id={`depth-character-brief-${character.id}`}
          subjectLabel={`${displayName}的外觀`}
          value={character.brief}
          placeholder="例如：1930 年代青年偵探，黑短髮，深色羊毛西裝"
          busy={assistBusy}
          disabled={controlsDisabled}
          onChange={onBriefChange}
          onAssist={onAssist}
        />
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-medium text-stone-400">角色補充描述</span>
        <textarea
          value={character.description}
          maxLength={DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS}
          disabled={controlsDisabled}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="完整描述身份、臉部質感、髮型、身形、服裝材質、妝容與配件；不要在這裡寫動作或背景。"
          className="min-h-24 w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-stone-200 outline-none placeholder:text-stone-600 focus:border-cyan-300/45"
        />
        <span className="mt-1 block text-right font-mono text-[10px] text-stone-600">
          {character.description.length}/{DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS}
        </span>
      </label>
    </article>
  )
}

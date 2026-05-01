'use client'

/**
 * Phase 12.4 — MVP character edit modal.
 *
 * Click on a character card → opens this modal. Lets the user:
 *   - View / regen / upload-replace / zoom the appearance image
 *   - Edit the role description (Character.introduction)
 *   - Edit the visual prompt (CharacterAppearance.description) — this is
 *     what regen feeds to the image model
 *   - Lock / unlock the profile (profileConfirmed)
 *   - Delete the character entirely
 *
 * Out of scope (deferred until schema lands or the dedicated editor):
 *   - Folder, height, tags, voice reference upload
 *   - Multi-appearance outfit list (project_kuiperai_multi_appearance_plan)
 *   - "Regenerate style" override per-character
 *
 * The component is purely controlled — it never reaches into mutations
 * itself. The parent V2SubjectsClient hands it the relevant mutations
 * pre-bound to the character.
 */

import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface CharacterAppearanceLike {
  id: string
  appearanceIndex?: number
  description?: string | null
  changeReason?: string | null
  imageUrl?: string | null
  imageUrls?: string | string[] | null
}

interface CharacterLike {
  id: string
  name?: string | null
  role?: string | null
  description?: string | null
  introduction?: string | null
  imageUrl?: string | null
  profileConfirmed?: boolean | null
  appearances?: CharacterAppearanceLike[] | null
}

export interface V2CharacterEditModalProps {
  character: CharacterLike
  imageUrl: string | null
  onClose: () => void
  onZoomImage: (url: string) => void

  // Image actions
  onRegenerate: () => void
  onUploadFile: (file: File) => void
  isRegenerating: boolean
  isUploading: boolean

  // Text edits
  onSaveIntroduction: (introduction: string) => void
  onSaveVisualPrompt: (visualPrompt: string) => void
  isSavingIntroduction: boolean
  isSavingVisualPrompt: boolean

  // Profile lock + destructive
  onToggleLock: () => void
  isLocking: boolean
  onDelete: () => void
  isDeleting: boolean
}

export function V2CharacterEditModal({
  character,
  imageUrl,
  onClose,
  onZoomImage,
  onRegenerate,
  onUploadFile,
  isRegenerating,
  isUploading,
  onSaveIntroduction,
  onSaveVisualPrompt,
  isSavingIntroduction,
  isSavingVisualPrompt,
  onToggleLock,
  isLocking,
  onDelete,
  isDeleting,
}: V2CharacterEditModalProps) {
  const ap = character.appearances?.[0]
  const initialIntroduction = character.introduction ?? character.description ?? ''
  const initialVisualPrompt = ap?.description ?? ''

  const [introductionDraft, setIntroductionDraft] = useState(initialIntroduction)
  const [visualPromptDraft, setVisualPromptDraft] = useState(initialVisualPrompt)

  // Re-seed drafts when the character payload changes (e.g. after regen
  // refetches and the parent passes a fresh CharacterLike).
  useEffect(() => {
    setIntroductionDraft(character.introduction ?? character.description ?? '')
  }, [character.introduction, character.description])
  useEffect(() => {
    setVisualPromptDraft(ap?.description ?? '')
  }, [ap?.description])

  // ESC closes the modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const introductionChanged = introductionDraft !== initialIntroduction
  const visualPromptChanged = visualPromptDraft !== initialVisualPrompt

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function handleConfirmDelete() {
    if (!window.confirm(`確定要刪除角色「${character.name ?? '未命名'}」?\n\n此操作會連帶刪除這個角色的所有造型與圖片,且無法復原。`)) {
      return
    }
    onDelete()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-stone-950/90 p-6 backdrop-blur-md sm:p-10"
      onClick={onClose}
    >
      <div
        className="relative my-10 w-full max-w-5xl rounded-sm border border-stone-800 bg-stone-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800/60 px-6 py-4">
          <div>
            <div className="font-fraunces text-xl italic text-amber-400">編輯角色</div>
            <div className="mt-1 font-mono text-[10px] tracking-wider text-stone-500">
              EDIT_CHARACTER · {character.id.slice(0, 8)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-stone-800 text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200"
            aria-label="關閉"
          >
            ×
          </button>
        </div>

        {/* Body — 2-column on desktop */}
        <div className="grid gap-6 p-6 md:grid-cols-[280px_1fr]">
          {/* Left: image + image actions */}
          <div className="space-y-3">
            <div
              className={`relative aspect-[3/4] overflow-hidden rounded-sm border border-stone-800 bg-gradient-to-br from-stone-800 to-stone-900 ${
                imageUrl ? 'cursor-zoom-in' : ''
              }`}
              onClick={() => imageUrl && onZoomImage(imageUrl)}
            >
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={character.name ?? '角色'} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <AppIcon name="image" className="h-10 w-10 text-stone-600" />
                </div>
              )}
              {isRegenerating ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/70 backdrop-blur-sm">
                  <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-amber-400" />
                  <div className="font-mono text-[10px] tracking-wider text-amber-300">生圖中…</div>
                  <div className="px-4 text-center font-serif-cn text-[10px] text-stone-400">
                    Tencent VOD 30-90 秒,撞並發會自動 retry
                  </div>
                </div>
              ) : isUploading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/70 backdrop-blur-sm">
                  <AppIcon name="cloudUpload" className="h-6 w-6 animate-pulse text-amber-400" />
                  <div className="font-mono text-[10px] tracking-wider text-amber-300">上傳中…</div>
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating || isUploading}
                className="flex items-center justify-center gap-1 rounded-sm border border-stone-800 bg-stone-900/50 py-2 font-mono text-[10px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                重新生成
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRegenerating || isUploading}
                className="flex items-center justify-center gap-1 rounded-sm border border-stone-800 bg-stone-900/50 py-2 font-mono text-[10px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="cloudUpload" className="h-3 w-3" />
                上傳替換
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUploadFile(file)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />

            {imageUrl ? (
              <a
                href={imageUrl}
                download={`${character.name ?? 'character'}.png`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 rounded-sm border border-stone-800 bg-stone-900/50 py-2 font-mono text-[10px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400"
              >
                <AppIcon name="cloudUpload" className="h-3 w-3 rotate-180" />
                下載原圖
              </a>
            ) : null}

            <button
              type="button"
              onClick={onToggleLock}
              disabled={isLocking}
              className={`flex w-full items-center justify-center gap-1 rounded-sm border py-2 font-mono text-[10px] tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                character.profileConfirmed
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                  : 'border-stone-800 bg-stone-900/50 text-stone-300 hover:border-amber-500/40 hover:text-amber-400'
              }`}
              title={character.profileConfirmed ? '已鎖定 — 分鏡會優先綁定此角色檔案' : '鎖定後分鏡會優先綁定此角色檔案'}
            >
              {isLocking ? '處理中…' : character.profileConfirmed ? '✓ 已鎖定檔案' : '⊙ 鎖定檔案'}
            </button>
          </div>

          {/* Right: text editors */}
          <div className="space-y-5">
            <div>
              <div className="mb-1 font-mono text-[10px] tracking-wider text-stone-500">角色名稱</div>
              <div className="rounded-sm border border-stone-800 bg-stone-900/50 px-3 py-2 font-fraunces text-base italic text-stone-200">
                {character.name ?? '未命名'}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-wider">
                <span className="text-stone-500">角色描述 (身份 / 關係 / 稱呼)</span>
                <span className="text-stone-600">{introductionDraft.length} 字</span>
              </div>
              <textarea
                value={introductionDraft}
                onChange={(e) => setIntroductionDraft(e.target.value)}
                rows={3}
                placeholder="例:Catherine 的丈夫,中年企業家,對妻子充滿掌控欲。 ⋯ 用於生圖時提供身份脈絡"
                className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/60 p-3 font-body text-sm text-stone-200 outline-none transition-colors focus:border-amber-500"
                disabled={isSavingIntroduction}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIntroductionDraft(initialIntroduction)}
                  disabled={!introductionChanged || isSavingIntroduction}
                  className="font-mono text-[10px] tracking-wider text-stone-500 transition-colors hover:text-stone-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  還原
                </button>
                <button
                  type="button"
                  onClick={() => onSaveIntroduction(introductionDraft.trim())}
                  disabled={!introductionChanged || isSavingIntroduction || !introductionDraft.trim()}
                  className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 font-mono text-[10px] tracking-wider text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSavingIntroduction ? '儲存中…' : '儲存描述'}
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-wider">
                <span className="text-amber-500/80">外觀提示詞 (餵給 AI 生圖)</span>
                <span className="text-stone-600">{visualPromptDraft.length} 字</span>
              </div>
              <textarea
                value={visualPromptDraft}
                onChange={(e) => setVisualPromptDraft(e.target.value)}
                rows={8}
                placeholder="例:35 歲中年男性,黑短髮,商務白襯衫卷袖,深灰精紡羊毛西褲,黃銅皮帶扣,銀色腕錶,神情冷峻,寫實風格 ⋯ 越具體生圖越穩定。注意年代與服裝符合劇本設定。"
                className="w-full resize-none rounded-sm border border-amber-500/30 bg-stone-900/60 p-3 font-body text-sm leading-relaxed text-stone-200 outline-none transition-colors focus:border-amber-500"
                disabled={isSavingVisualPrompt}
              />
              <div className="mt-2 flex items-center justify-between">
                <div className="font-mono text-[9px] tracking-wider text-stone-600">
                  儲存後下次「重新生成」會用此 prompt
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisualPromptDraft(initialVisualPrompt)}
                    disabled={!visualPromptChanged || isSavingVisualPrompt}
                    className="font-mono text-[10px] tracking-wider text-stone-500 transition-colors hover:text-stone-300 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    還原
                  </button>
                  <button
                    type="button"
                    onClick={() => onSaveVisualPrompt(visualPromptDraft.trim())}
                    disabled={!visualPromptChanged || isSavingVisualPrompt || !visualPromptDraft.trim()}
                    className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 font-mono text-[10px] tracking-wider text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSavingVisualPrompt ? '儲存中…' : '儲存提示詞'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer — destructive on the left, primary close on the right */}
        <div className="flex items-center justify-between gap-3 border-t border-stone-800/60 px-6 py-4">
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 rounded-sm border border-rose-500/40 bg-rose-500/5 px-4 py-2 font-mono text-[10px] tracking-wider text-rose-400 transition-all hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🗑 {isDeleting ? '刪除中…' : '刪除角色'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-stone-700 bg-stone-900 px-5 py-2 font-mono text-[10px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-300"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

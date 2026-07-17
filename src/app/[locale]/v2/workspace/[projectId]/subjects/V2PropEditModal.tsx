'use client'

/**
 * Phase R-3 (2026-05-22) — V2 prop edit modal.
 *
 * Symmetric with V2CharacterEditModal / V2LocationEditModal but
 * simpler — props have no appearance / view system, just one image
 * and a short summary.
 *
 * Backend rename is plumbed through PATCH /api/novel-promotion/
 * [projectId]/prop, which runs propagatePropRename inside a
 * $transaction (Phase R-2 helper) so every panel.props JSON ref
 * in the project gets rewritten atomically when the user renames
 * a prop.
 */

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface PropLike {
  id: string
  name?: string | null
  summary?: string | null
  imageUrl?: string | null
}

interface V2PropEditModalProps {
  prop: PropLike
  imageUrl: string | null
  onClose: () => void
  onZoomImage: (url: string) => void

  // Text edits
  onSaveName: (name: string) => void
  onSaveSummary: (summary: string) => void
  isSavingName: boolean
  isSavingSummary: boolean

  // Image actions
  onRegenerate: () => void
  onUploadFile: (file: File) => void
  isRegenerating: boolean
  isUploading: boolean

  // Destructive
  onDelete: () => void
  isDeleting: boolean
}

export function V2PropEditModal({
  prop,
  imageUrl,
  onClose,
  onZoomImage,
  onSaveName,
  onSaveSummary,
  isSavingName,
  isSavingSummary,
  onRegenerate,
  onUploadFile,
  isRegenerating,
  isUploading,
  onDelete,
  isDeleting,
}: V2PropEditModalProps) {
  const initialName = prop.name ?? ''
  const initialSummary = prop.summary ?? ''

  const [nameDraft, setNameDraft] = useState(initialName)
  const [summaryDraft, setSummaryDraft] = useState(initialSummary)

  useEffect(() => {
    setNameDraft(prop.name ?? '')
  }, [prop.name])
  useEffect(() => {
    setSummaryDraft(prop.summary ?? '')
  }, [prop.summary])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const nameTrimmed = nameDraft.trim()
  const nameChanged = nameTrimmed !== initialName.trim() && nameTrimmed.length > 0
  const summaryChanged = summaryDraft.trim() !== initialSummary.trim()

  function handleConfirmDelete() {
    if (!window.confirm(`確定要刪除道具「${prop.name ?? '未命名'}」?\n\n此操作無法復原。`)) {
      return
    }
    onDelete()
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUploadFile(file)
    e.target.value = ''
  }

  return (
    <div className="kuiper-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="kuiper-modal-surface relative max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6 sm:p-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 font-mono text-2xl text-text-tertiary transition-colors hover:text-primary-400"
          aria-label="關閉"
        >
          ×
        </button>

        <div className="mb-6">
          <h2 className="font-fraunces text-2xl italic text-primary-400">編輯道具</h2>
          <div className="mt-1 font-mono text-[14px] tracking-wider text-text-tertiary">
            EDIT_PROP · {prop.id.slice(0, 8)}
          </div>
        </div>

        <div className="grid grid-cols-[200px_1fr] gap-6">
          {/* Left: image preview */}
          <div className="space-y-3">
            <div className="aspect-square overflow-hidden rounded-sm border border-border-soft bg-raised">
              {imageUrl ? (
                <button
                  type="button"
                  onClick={() => onZoomImage(imageUrl)}
                  className="block h-full w-full"
                >
                  <img src={imageUrl} alt={prop.name ?? '道具'} className="h-full w-full object-cover transition-transform hover:scale-[1.03]" />
                </button>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <AppIcon name="image" className="h-10 w-10 text-text-tertiary" />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="flex items-center justify-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 font-mono text-[13px] tracking-wider text-primary-300 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {isRegenerating ? '生成中…' : imageUrl ? '重新生成' : '生成圖片'}
              </button>
              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-border-strong bg-raised px-3 py-1.5 font-mono text-[13px] tracking-wider text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-300">
                <AppIcon name="cloudUpload" className="h-3 w-3" />
                {isUploading ? '上傳中…' : '上傳圖片'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={isUploading}
                />
              </label>
            </div>
          </div>

          {/* Right: text editors */}
          <div className="space-y-5">
            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[14px] tracking-wider">
                <span className="text-text-tertiary">道具名稱</span>
                <span className="text-text-tertiary">
                  {nameChanged ? '改名後分鏡引用會自動同步' : ''}
                </span>
              </div>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="道具名稱 (例:骨杖 / 信封 / 銀劍)"
                className="w-full rounded-sm border border-border-soft bg-raised/60 px-3 py-2 font-fraunces text-base italic text-text-primary outline-none transition-colors focus:border-primary-500 disabled:opacity-60"
                disabled={isSavingName}
                maxLength={64}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNameDraft(initialName)}
                  disabled={!nameChanged || isSavingName}
                  className="font-mono text-[14px] tracking-wider text-text-tertiary transition-colors hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-30"
                >
                  還原
                </button>
                <button
                  type="button"
                  onClick={() => onSaveName(nameTrimmed)}
                  disabled={!nameChanged || isSavingName}
                  className="rounded-sm border border-primary-500/40 bg-primary-500/10 px-4 py-1.5 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:border-primary-500 hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSavingName ? '儲存中…' : '儲存名稱'}
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[14px] tracking-wider">
                <span className="text-text-tertiary">道具描述 (生圖時提供細節)</span>
                <span className="text-text-tertiary">{summaryDraft.length} 字</span>
              </div>
              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                rows={4}
                placeholder="例:一柄帶有銀色狼頭把柄的長劍,劍鞘上刻著古老的盧恩符文。 ⋯ 用於生圖時錨定外觀"
                className="w-full resize-none rounded-sm border border-border-soft bg-raised/60 p-3 font-body text-sm text-text-primary outline-none transition-colors focus:border-primary-500"
                disabled={isSavingSummary}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSummaryDraft(initialSummary)}
                  disabled={!summaryChanged || isSavingSummary}
                  className="font-mono text-[14px] tracking-wider text-text-tertiary transition-colors hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-30"
                >
                  還原
                </button>
                <button
                  type="button"
                  onClick={() => onSaveSummary(summaryDraft.trim())}
                  disabled={!summaryChanged || isSavingSummary}
                  className="rounded-sm border border-primary-500/40 bg-primary-500/10 px-4 py-1.5 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:border-primary-500 hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSavingSummary ? '儲存中…' : '儲存描述'}
                </button>
              </div>
            </div>

            <div className="border-t border-border-soft pt-4">
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 rounded-sm border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 font-mono text-[13px] tracking-wider text-rose-400 transition-all hover:border-rose-500/60 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isDeleting ? '刪除中…' : '刪除道具'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

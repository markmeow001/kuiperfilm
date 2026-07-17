'use client'

/**
 * Phase 12 — 手動新增 subject modal.
 *
 * Usage:
 *   <V2ManualAddSubjectModal
 *     subjectType="character"  // 'character' | 'scene' | 'prop'
 *     onClose={...}
 *     onSubmit={async ({ name, description, file }) => {...}}
 *     isSubmitting={...}
 *   />
 *
 * 設計原則:
 *   - 名稱必填,其餘可空
 *   - 上傳檔案不阻擋 — 沒上傳就只建記錄(可後續再產圖)
 *   - 客戶端先預覽再送,避免錯檔
 *   - 跟 V2LocationEditModal / V2CharacterEditModal 共用同一套灰底
 *     amber-accent 風格
 */

import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { getNamedSubjectCreatePolicy } from './subject-create-policy'

export type ManualAddSubjectType = 'character' | 'scene' | 'prop'

interface SubjectMeta {
  title: string
  iconLabel: string
  namePlaceholder: string
  descPlaceholder: string
  descLabel: string
}

const SUBJECT_META: Record<ManualAddSubjectType, SubjectMeta> = {
  character: {
    title: '手動新增角色',
    iconLabel: '角色',
    namePlaceholder: '例:陳警官',
    descLabel: '角色介紹（可選）',
    descPlaceholder: '例:三十歲,精悍刑警,曾經當過特勤,有正義感但脾氣火爆…',
  },
  scene: {
    title: '手動新增場景',
    iconLabel: '場景',
    namePlaceholder: '例:雨夜停車場',
    descLabel: '視覺描述（可選）',
    descPlaceholder: '例:深夜地下停車場,日光燈閃爍,水泥柱有油漬,鏡頭側光…',
  },
  prop: {
    title: '手動新增道具',
    iconLabel: '道具',
    namePlaceholder: '例:銀色懷錶',
    descLabel: '道具說明（可選）',
    descPlaceholder: '例:傳家銀懷錶,蓋面有獵犬浮雕,劇情中段被偷…',
  },
}

export interface V2ManualAddSubjectModalProps {
  subjectType: ManualAddSubjectType
  onClose: () => void
  onSubmit: (params: { name: string; description: string; file: File | null }) => void | Promise<void>
  isSubmitting: boolean
}

export function V2ManualAddSubjectModal({
  subjectType,
  onClose,
  onSubmit,
  isSubmitting,
}: V2ManualAddSubjectModalProps) {
  const meta = SUBJECT_META[subjectType]
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Cleanup the object URL when the file changes or modal closes.
  // Without this, repeatedly picking files leaks blob URLs into memory.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, isSubmitting])

  const createPolicy = getNamedSubjectCreatePolicy(name, meta.iconLabel, isSubmitting)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (f && !f.type.startsWith('image/')) {
      alert('只接受圖片檔(JPG / PNG / WebP)')
      return
    }
    setFile(f)
  }

  function handleSubmit() {
    if (!createPolicy.canSubmit) return
    void onSubmit({ name: name.trim(), description: description.trim(), file })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/85 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Close on backdrop click only — not on inner content
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <form
        className="w-full max-w-xl overflow-hidden rounded-sm border border-amber-900/30 bg-stone-950 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-900/20 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10">
              <AppIcon name="plus" className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div>
              <div className="font-fraunces text-lg italic text-stone-100">{meta.title}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-600/80">
                {meta.iconLabel} · MANUAL
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded p-1 text-stone-500 transition-colors hover:bg-stone-900 hover:text-amber-400 disabled:opacity-50"
            aria-label="關閉"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-stone-400">
              名稱 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={meta.namePlaceholder}
              disabled={isSubmitting}
              autoFocus
              className="w-full rounded-sm border border-stone-800 bg-stone-900/60 px-3 py-2 font-serif-cn text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-stone-400">
              {meta.descLabel}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={meta.descPlaceholder}
              disabled={isSubmitting}
              rows={4}
              className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/60 px-3 py-2 font-serif-cn text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* File picker + preview */}
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-stone-400">
              圖片（可選）
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="hidden"
            />
            {previewUrl ? (
              <div className="relative overflow-hidden rounded-sm border border-amber-900/30 bg-stone-900/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="預覽" className="block max-h-72 w-full object-contain" />
                <div className="flex items-center justify-between border-t border-amber-900/20 px-3 py-2">
                  <div className="truncate font-mono text-[11px] tracking-wider text-stone-400">{file?.name}</div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    disabled={isSubmitting}
                    className="rounded p-1 text-stone-500 transition-colors hover:text-rose-400 disabled:opacity-50"
                    aria-label="移除圖片"
                  >
                    <AppIcon name="close" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isSubmitting}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-stone-700 bg-stone-900/30 py-8 transition-colors hover:border-amber-500/40 hover:bg-amber-500/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="upload" className="h-5 w-5 text-stone-500" />
                <div className="font-serif-cn text-sm text-stone-400">點擊上傳圖片</div>
                <div className="font-mono text-[10px] tracking-wider text-stone-600">
                  JPG / PNG / WebP · 不上傳也可,之後可生圖
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-amber-900/20 bg-stone-900/30 px-6 py-4">
          {createPolicy.hint ? (
            <div className="mb-3 font-mono text-[11px] tracking-wider text-amber-300/80" role="status">
              {createPolicy.hint}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-sm px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-stone-400 transition-colors hover:text-stone-200 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!createPolicy.canSubmit}
              className="flex items-center gap-2 rounded-sm bg-amber-500 px-5 py-2 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                  建立中…
                </>
              ) : (
                <>
                  <AppIcon name="plus" className="h-4 w-4" />
                  建立{meta.iconLabel}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

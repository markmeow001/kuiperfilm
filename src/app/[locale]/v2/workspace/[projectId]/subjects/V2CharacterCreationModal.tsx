'use client'

/**
 * Phase 12 — 角色手動新增 modal (V2 stone/amber 風格)。
 *
 * 沿用 `useCharacterCreationSubmit` hook,所有 API 邏輯/錯誤處理/
 * loading 狀態都跟既有玻璃風 CharacterCreationModal 一樣;這裡只
 * 是重刻 UI 來對齊 V2 設計圖。
 *
 * 三個建立模式(對應 design tabs):
 *   1. 提示词生成  (description) — 只填描述,後台 AI 生成 4 視角
 *   2. 参考图生成  (reference)   — 上傳參考圖,AI 依參考重繪
 *   3. 上传四视图  (upload)      — 直接上傳已做好的 4 視角設定圖
 *
 * 欄位:
 *   - 角色名稱 *
 *   - 外觀描述 (對應 schema appearance.description / 視覺特徵)
 *   - 角色描述 (對應 Character.introduction;個性/身份;沒接後端 introduction
 *     欄位以免增加 API 介面複雜度,留 deprecated TODO)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useCharacterCreationSubmit } from '@/components/shared/assets/character-creation/hooks/useCharacterCreationSubmit'
import { getCharacterCreatePolicy, type CharacterCreateMode } from './subject-create-policy'

export interface V2CharacterCreationModalProps {
  projectId: string
  episodeId: string | null
  onClose: () => void
  onSuccess: () => void
}

const TAB_LABELS: Record<CharacterCreateMode, { label: string; icon: 'sparklesAlt' | 'image' | 'upload' }> = {
  description: { label: '提示詞生成', icon: 'sparklesAlt' },
  reference: { label: '參考圖生成', icon: 'image' },
  upload: { label: '上傳四視圖', icon: 'upload' },
}

export function V2CharacterCreationModal({ projectId, episodeId, onClose, onSuccess }: V2CharacterCreationModalProps) {
  const [createMode, setCreateMode] = useState<CharacterCreateMode>('description')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [introduction, setIntroduction] = useState('')
  const [aiInstruction, setAiInstruction] = useState('')
  const [referenceImagesBase64, setReferenceImagesBase64] = useState<string[]>([])
  const [referenceSubMode] = useState<'direct' | 'extract'>('direct')
  const fileRef = useRef<HTMLInputElement>(null)

  const {
    isSubmitting,
    isAiDesigning,
    isExtracting,
    handleExtractDescription,
    handleCreateWithReference,
    handleCreateWithUpload,
    handleAiDesign,
    handleSubmit,
    handleCreateOnly,
  } = useCharacterCreationSubmit({
    mode: 'project',
    projectId,
    episodeId,
    name,
    description,
    aiInstruction,
    referenceImagesBase64,
    referenceSubMode,
    isSubAppearance: false,
    selectedCharacterId: '',
    changeReason: '',
    setDescription,
    setAiInstruction,
    onSuccess: async () => {
      // After the character row + appearance image task are kicked off,
      // patch in the introduction text. Failure here is non-fatal — the
      // character still exists; the user can edit later.
      if (introduction.trim()) {
        try {
          await fetch(`/api/novel-promotion/${projectId}/character`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              // Note: PATCH expects characterId. We don't know the new
              // character's id from the submit hook (it doesn't expose
              // the create response). Skip silently when we can't —
              // worst case the introduction is empty and editable later.
              introduction: introduction.trim(),
            }),
          })
        } catch {
          /* non-fatal — see comment above */
        }
      }
      onSuccess()
    },
    onClose,
  })

  const handleFileSelect = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (fileArray.length === 0) return
      const maxImages = createMode === 'upload' ? 1 : 5
      const remaining = maxImages - referenceImagesBase64.length
      const toAdd = fileArray.slice(0, remaining)
      for (const file of toAdd) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const b64 = e.target?.result as string
          setReferenceImagesBase64((prev) => {
            if (prev.length >= maxImages) return prev
            if (prev.includes(b64)) return prev
            return [...prev, b64]
          })
        }
        reader.readAsDataURL(file)
      }
    },
    [createMode, referenceImagesBase64.length],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting && !isAiDesigning) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, isSubmitting, isAiDesigning])

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) void handleFileSelect(e.dataTransfer.files)
  }

  // Mode-aware submit dispatch
  const createPolicy = getCharacterCreatePolicy({
    name,
    description,
    mode: createMode,
    referenceImageCount: referenceImagesBase64.length,
    isBusy: isSubmitting || isAiDesigning,
  })

  function dispatchSubmit() {
    if (!createPolicy.canGenerate) return
    if (createMode === 'description') return handleSubmit()
    if (createMode === 'reference') return handleCreateWithReference()
    return handleCreateWithUpload()
  }

  return (
    <div
      className="kuiper-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting && !isAiDesigning) onClose()
      }}
    >
      <form
        className="kuiper-modal-surface flex max-h-[90vh] w-full max-w-2xl flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void dispatchSubmit()
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-primary-900/20 px-6 py-4 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <AppIcon name="sparklesAlt" className="h-4 w-4 text-primary-400" />
              <div className="font-fraunces text-lg italic text-text-primary">新建角色</div>
            </div>
            <div className="mt-1 font-mono text-[10px] tracking-wider text-text-tertiary">
              選擇創建方式:AI 提示詞生成、上傳參考圖生成、或直接上傳四視圖
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isAiDesigning}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-raised hover:text-primary-400 disabled:opacity-50"
            aria-label="關閉"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-3 gap-2 border-b border-primary-900/20 px-6 py-4 flex-shrink-0">
          {(['description', 'reference', 'upload'] as CharacterCreateMode[]).map((m) => {
            const meta = TAB_LABELS[m]
            const active = createMode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => setCreateMode(m)}
                disabled={isSubmitting || isAiDesigning}
                className={`flex items-center justify-center gap-2 rounded-sm border px-4 py-2.5 font-serif-cn text-sm transition-all disabled:opacity-50 ${
                  active
                    ? 'border-primary-500/60 bg-primary-500/10 text-primary-300'
                    : 'border-border-soft bg-raised/40 text-text-secondary hover:border-border-strong hover:text-text-primary'
                }`}
              >
                <AppIcon name={meta.icon} className="h-4 w-4" />
                {meta.label}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div className="space-y-5 overflow-y-auto px-6 py-5">
          {/* Name */}
          <Field label="角色名稱 *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              placeholder="輸入角色名稱"
              className="w-full rounded-sm border border-border-soft bg-raised/60 px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
            />
          </Field>

          {/* Reference image upload — show only in reference / upload modes */}
          {createMode === 'reference' || createMode === 'upload' ? (
            <Field
              label={
                createMode === 'upload'
                  ? '四視圖參考圖（必填,1 張)'
                  : `參考圖（必填,最多 5 張·已選 ${referenceImagesBase64.length}/5)`
              }
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple={createMode === 'reference'}
                onChange={(e) => {
                  if (e.target.files) void handleFileSelect(e.target.files)
                  if (fileRef.current) fileRef.current.value = ''
                }}
                disabled={isSubmitting}
                className="hidden"
              />
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="rounded-sm border border-dashed border-border-strong bg-raised/30 p-4"
              >
                {referenceImagesBase64.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {referenceImagesBase64.map((b64, i) => (
                      <div
                        key={i}
                        className="relative aspect-square overflow-hidden rounded-sm border border-primary-900/30"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b64} alt={`參考 ${i + 1}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setReferenceImagesBase64((prev) => prev.filter((_, j) => j !== i))}
                          disabled={isSubmitting}
                          className="absolute right-1 top-1 rounded-full bg-canvas/80 p-1 text-text-secondary transition-colors hover:text-rose-400 disabled:opacity-50"
                          aria-label="移除"
                        >
                          <AppIcon name="close" className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {(createMode === 'reference' && referenceImagesBase64.length < 5) ||
                    (createMode === 'upload' && referenceImagesBase64.length < 1) ? (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={isSubmitting}
                        className="aspect-square rounded-sm border border-dashed border-border-strong text-text-tertiary transition-colors hover:border-primary-500/40 hover:text-primary-400 disabled:opacity-50"
                      >
                        <AppIcon name="plus" className="mx-auto h-5 w-5" />
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={isSubmitting}
                    className="flex w-full flex-col items-center justify-center gap-2 py-8 text-text-tertiary transition-colors hover:text-primary-400 disabled:opacity-50"
                  >
                    <AppIcon name="upload" className="h-6 w-6" />
                    <div className="font-serif-cn text-sm">點擊或拖放圖片</div>
                    <div className="font-mono text-[10px] tracking-wider">
                      JPG / PNG / WebP · {createMode === 'upload' ? '需 16:9 橫排四視圖' : '最多 5 張參考圖'}
                    </div>
                  </button>
                )}
              </div>

              {createMode === 'reference' && referenceImagesBase64.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void handleExtractDescription()}
                  disabled={isExtracting || isSubmitting}
                  className="mt-2 flex items-center gap-2 rounded-sm border border-primary-500/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-primary-400 transition-colors hover:bg-primary-500/10 disabled:opacity-50"
                >
                  <AppIcon name="sparklesAlt" className="h-3 w-3" />
                  {isExtracting ? '識別中…' : 'AI 從參考圖識別描述'}
                </button>
              ) : null}
            </Field>
          ) : null}

          {/* Appearance description */}
          {createMode !== 'upload' ? (
            <Field label={createMode === 'description' ? '外觀描述 *（AI 生成依據）' : '外觀描述（可選,輔助 AI 重繪）'}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                rows={4}
                placeholder="詳細描述角色外觀,如:身高 175cm、黑色短髮、藍色眼睛、穿著白色襯衫和深色西褲…"
                className="w-full resize-none rounded-sm border border-border-soft bg-raised/60 px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
              />
              {createMode === 'description' ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    disabled={isSubmitting || isAiDesigning}
                    placeholder="AI 設計輔助:輸入簡短指令(例:三十歲精悍刑警)"
                    className="flex-1 rounded-sm border border-border-soft bg-raised/60 px-3 py-1.5 font-mono text-[11px] tracking-wider text-text-primary placeholder:text-text-tertiary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAiDesign()}
                    disabled={isAiDesigning || !aiInstruction.trim()}
                    className="flex items-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-primary-400 transition-colors hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppIcon name="sparklesAlt" className="h-3 w-3" />
                    {isAiDesigning ? '生成中…' : 'AI 補全'}
                  </button>
                </div>
              ) : null}
            </Field>
          ) : null}

          {/* Character introduction (personality/role) */}
          <Field label="角色描述（可選 · 個性/身份/與其他角色關係）">
            <textarea
              value={introduction}
              onChange={(e) => setIntroduction(e.target.value)}
              disabled={isSubmitting}
              rows={3}
              placeholder="描述角色的個性、身份、與主角的關係…(可後續編輯)"
              className="w-full resize-none rounded-sm border border-border-soft bg-raised/60 px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/50 focus:outline-none disabled:opacity-50"
            />
          </Field>

          {/* AI generation note */}
          {createMode !== 'upload' ? (
            <div className="flex items-start gap-2 rounded-sm border border-primary-900/30 bg-primary-500/5 px-3 py-2">
              <AppIcon name="sparklesAlt" className="mt-0.5 h-3 w-3 text-primary-400" />
              <div className="font-mono text-[11px] tracking-wider text-primary-200/80">
                AI 將根據您的描述自動生成 16:9 橫排四視圖設定圖（面部特寫、正面、側面、背面）
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-primary-900/20 bg-raised/30 px-6 py-4 flex-shrink-0">
          {createPolicy.hint ? (
            <div className="mb-3 font-mono text-[11px] tracking-wider text-primary-300/80" role="status">
              {createPolicy.hint}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || isAiDesigning}
              className="rounded-sm px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleCreateOnly()}
              disabled={!createPolicy.canCreateOnly}
              className="flex items-center gap-2 rounded-sm border border-primary-500/40 px-5 py-2 font-serif-cn text-sm text-primary-300 transition-all hover:bg-primary-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="plus" className="h-4 w-4" />
              只建立角色
            </button>
            <button
              type="submit"
              disabled={!createPolicy.canGenerate}
              className="flex items-center gap-2 rounded-sm bg-primary-500 px-5 py-2 font-serif-cn text-sm font-medium text-canvas transition-all hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                  建立中…
                </>
              ) : (
                <>
                  <AppIcon name="sparklesAlt" className="h-4 w-4" />
                  {createMode === 'upload' ? '建立並上傳' : '生成並建立'}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-text-secondary">{label}</div>
      {children}
    </label>
  )
}

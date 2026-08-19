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
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { V2CharacterAppearancesPanel } from './V2CharacterAppearancesPanel'
import type { CharacterAppearanceLike } from './subjects-client-helpers'

interface CharacterLike {
  id: string
  name?: string | null
  role?: string | null
  description?: string | null
  introduction?: string | null
  imageUrl?: string | null
  profileConfirmed?: boolean | null
  appearances?: CharacterAppearanceLike[] | null
  // Voice + LLM-extracted profile metadata.
  customVoiceUrl?: string | null
  voiceId?: string | null
  voiceType?: string | null
  // profileData is the JSON string written by analyze-novel; contains
  // personality_tags / archetype / era_period / costume_tier / etc. We
  // surface a few of these as chips so the user can sanity-check the
  // LLM's read of the script without having to dig into raw JSON.
  profileData?: string | null
}

export interface V2CharacterEditModalProps {
  projectId: string
  currentEpisodeId: string | null
  character: CharacterLike
  activeAppearance: CharacterAppearanceLike
  activeAppearanceSource: 'episode' | 'default'
  imageUrl: string | null
  onClose: () => void
  onZoomImage: (url: string) => void

  // Image actions
  onRegenerate: () => void
  onUploadFile: (file: File) => void
  // Two-step "upload reference + auto-expand to 3-view sheet" flow.
  // Worker overwrites this appearance's imageUrls with the multi-view set.
  onUploadAndExpandToMultiView?: (file: File) => void
  isRegenerating: boolean
  isUploading: boolean
  isExpanding?: boolean

  // Text edits
  onSaveName: (name: string) => void
  onSaveIntroduction: (introduction: string) => void
  onSaveVisualPrompt: (visualPrompt: string) => void
  isSavingName: boolean
  isSavingIntroduction: boolean
  isSavingVisualPrompt: boolean

  // Re-describe from current image (escape hatch for legacy uploads
  // / out-of-sync `descriptions` field). Same backend as the list-view
  // "↻ 從圖抽描述" button. Optional — parent may omit if no appearance.
  onRedescribe?: () => void
  isRedescribing?: boolean

  // Profile lock + destructive
  onToggleLock: () => void
  isLocking: boolean
  lockError?: string | null
  onDelete: () => void
  isDeleting: boolean
}

export function V2CharacterEditModal({
  character,
  currentEpisodeId,
  activeAppearance,
  activeAppearanceSource,
  imageUrl,
  onClose,
  onZoomImage,
  onRegenerate,
  onUploadFile,
  onUploadAndExpandToMultiView,
  isRegenerating,
  isUploading,
  isExpanding,
  onSaveName,
  onSaveIntroduction,
  onSaveVisualPrompt,
  isSavingName,
  isSavingIntroduction,
  isSavingVisualPrompt,
  onRedescribe,
  isRedescribing,
  onToggleLock,
  isLocking,
  lockError,
  onDelete,
  isDeleting,
  projectId,
}: V2CharacterEditModalProps) {
  const t = useTranslations('v2Subjects.card')
  const activeAppearanceT = useTranslations('v2Subjects.activeAppearance')
  const ap = activeAppearance
  const initialName = character.name ?? ''
  const initialIntroduction = character.introduction ?? character.description ?? ''
  const initialVisualPrompt = ap?.description ?? ''

  const [nameDraft, setNameDraft] = useState(initialName)
  const [introductionDraft, setIntroductionDraft] = useState(initialIntroduction)
  const [visualPromptDraft, setVisualPromptDraft] = useState(initialVisualPrompt)

  // Re-seed drafts when the character payload changes (e.g. after regen
  // refetches and the parent passes a fresh CharacterLike).
  useEffect(() => {
    setNameDraft(character.name ?? '')
  }, [character.name])
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

  const nameTrimmed = nameDraft.trim()
  const nameChanged = nameTrimmed !== initialName.trim() && nameTrimmed.length > 0
  const introductionChanged = introductionDraft !== initialIntroduction
  const visualPromptChanged = visualPromptDraft !== initialVisualPrompt

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const expandFileInputRef = useRef<HTMLInputElement | null>(null)

  function handleConfirmDelete() {
    if (!window.confirm(`確定要刪除角色「${character.name ?? '未命名'}」?\n\n此操作會連帶刪除這個角色的所有造型與圖片,且無法復原。`)) {
      return
    }
    onDelete()
  }

  return (
    <div
      className="kuiper-modal-backdrop fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 sm:p-10"
      onClick={onClose}
    >
      <div
        className="kuiper-modal-surface relative my-6 w-full max-w-5xl sm:my-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-soft/60 px-6 py-4">
          <div>
            <div className="font-fraunces text-xl italic text-primary-400">編輯角色</div>
            <div className="mt-1 font-mono text-[14px] tracking-wider text-text-tertiary">
              EDIT_CHARACTER · {character.id.slice(0, 8)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-border-soft text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
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
              role="status"
              className="rounded-[10px] border border-[var(--production-border)] bg-[var(--production-tool-soft)] px-3 py-2 text-sm text-[var(--production-tool)]"
            >
              <div className="text-[12px] font-semibold tracking-wide text-[var(--production-ink-muted)]">
                {activeAppearanceT('modalLabel')}
              </div>
              <div className="mt-0.5 break-words font-semibold">
                {ap.changeReason ?? `#${(ap.appearanceIndex ?? 0) + 1}`}
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--production-ink-muted)]">
                {activeAppearanceSource === 'episode'
                  ? activeAppearanceT('sourceEpisode')
                  : activeAppearanceT('sourceDefault')}
              </div>
            </div>
            <button
              type="button"
              disabled={!imageUrl}
              aria-label={`圖片預覽：${character.name ?? '角色'}`}
              className={`relative block w-full aspect-[3/4] overflow-hidden rounded-sm border border-border-soft bg-gradient-to-br from-overlay to-raised ${
                imageUrl ? 'cursor-zoom-in' : ''
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:cursor-default`}
              onClick={() => imageUrl && onZoomImage(imageUrl)}
            >
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={character.name ?? '角色'} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <AppIcon name="image" className="h-10 w-10 text-text-tertiary" />
                </span>
              )}
              {isExpanding ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/70 backdrop-blur-sm">
                  <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-primary-400" />
                  <span className="font-mono text-[14px] tracking-wider text-primary-300">提交中…</span>
                  <span className="px-4 text-center font-serif-cn text-[14px] text-text-secondary">
                    上傳參考圖,即將開始生 3 視角
                  </span>
                </span>
              ) : isRegenerating ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/70 backdrop-blur-sm">
                  <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-primary-400" />
                  <span className="font-mono text-[14px] tracking-wider text-primary-300">生圖中…</span>
                  <span className="px-4 text-center font-serif-cn text-[14px] text-text-secondary">
                    Tencent VOD 60-180 秒,撞並發會自動 retry
                  </span>
                </span>
              ) : isUploading ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/70 backdrop-blur-sm">
                  <AppIcon name="cloudUpload" className="h-6 w-6 animate-pulse text-primary-400" />
                  <span className="font-mono text-[14px] tracking-wider text-primary-300">上傳中…</span>
                </span>
              ) : null}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating || isUploading}
                className="flex items-center justify-center gap-1 rounded-sm border border-border-soft bg-raised/50 py-2 font-mono text-[14px] tracking-wider text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {isRegenerating ? '生圖中…' : imageUrl ? '重新生成' : '生成'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRegenerating || isUploading}
                className="flex items-center justify-center gap-1 rounded-sm border border-border-soft bg-raised/50 py-2 font-mono text-[14px] tracking-wider text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
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

            {onUploadAndExpandToMultiView ? (
              <>
                <button
                  type="button"
                  onClick={() => expandFileInputRef.current?.click()}
                  disabled={isRegenerating || isUploading || isExpanding}
                  title="上傳一張參考圖,自動生成 3 張多視角圖(正面/側面/背面),覆蓋現有圖"
                  className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-primary-500/40 bg-primary-500/10 py-2 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:border-primary-500 hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AppIcon name="sparklesAlt" className="h-3 w-3" />
                  {isExpanding ? '提交中…' : '上傳並轉多視角(3 張)'}
                </button>
                <input
                  ref={expandFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onUploadAndExpandToMultiView(file)
                    if (expandFileInputRef.current) expandFileInputRef.current.value = ''
                  }}
                />
              </>
            ) : null}

            {imageUrl ? (
              <a
                href={imageUrl}
                download={`${character.name ?? 'character'}.png`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 rounded-sm border border-border-soft bg-raised/50 py-2 font-mono text-[14px] tracking-wider text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-400"
              >
                <AppIcon name="cloudUpload" className="h-3 w-3 rotate-180" />
                下載原圖
              </a>
            ) : null}

            <button
              type="button"
              onClick={onToggleLock}
              disabled={isLocking || Boolean(character.profileConfirmed)}
              className={`flex min-h-11 w-full items-center justify-center gap-1 rounded-sm border py-2 font-mono text-[14px] tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                character.profileConfirmed
                  ? 'border-primary-500/50 bg-primary-500/10 text-primary-400'
                  : 'border-border-soft bg-raised/50 text-text-secondary hover:border-primary-500/40 hover:text-primary-400'
              }`}
              title={character.profileConfirmed ? t('lockedTitle') : t('lockTitle')}
            >
              {isLocking
                ? t('locking')
                : character.profileConfirmed
                  ? t('locked')
                  : lockError
                    ? t('retryLock')
                    : t('lock')}
            </button>
            {lockError ? (
              <div
                role="alert"
                className="rounded-sm border border-[var(--production-danger)]/35 bg-[var(--production-danger)]/10 px-3 py-2 text-sm text-[var(--production-danger)]"
              >
                <span className="font-semibold">{t('lockFailed')}</span>{' '}
                <span>{lockError}</span>
              </div>
            ) : null}
          </div>

          {/* Right: text editors */}
          <div className="space-y-5">
            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[14px] tracking-wider">
                <span className="text-text-tertiary">角色名稱</span>
                <span className="text-text-tertiary">
                  {nameChanged ? '改名後分鏡引用會自動同步' : ''}
                </span>
              </div>
              {/* Phase R-3 (2026-05-22) — editable input. Backend PATCH
                  + transactional panel propagation already shipped in
                  Phase R-2 (rename-propagation.ts); UI just feeds the
                  mutation. Trimmed empty names are rejected client-side
                  so the user gets immediate feedback rather than a 400
                  from the route's `if (!name) ApiError` guard. */}
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="角色名稱"
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
                <span className="text-text-tertiary">角色描述 (身份 / 關係 / 稱呼)</span>
                <span className="text-text-tertiary">{introductionDraft.length} 字</span>
              </div>
              <textarea
                value={introductionDraft}
                onChange={(e) => setIntroductionDraft(e.target.value)}
                rows={3}
                placeholder="例:Catherine 的丈夫,中年企業家,對妻子充滿掌控欲。 ⋯ 用於生圖時提供身份脈絡"
                className="w-full resize-none rounded-sm border border-border-soft bg-raised/60 p-3 font-body text-sm text-text-primary outline-none transition-colors focus:border-primary-500"
                disabled={isSavingIntroduction}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIntroductionDraft(initialIntroduction)}
                  disabled={!introductionChanged || isSavingIntroduction}
                  className="font-mono text-[14px] tracking-wider text-text-tertiary transition-colors hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-30"
                >
                  還原
                </button>
                <button
                  type="button"
                  onClick={() => onSaveIntroduction(introductionDraft.trim())}
                  disabled={!introductionChanged || isSavingIntroduction || !introductionDraft.trim()}
                  className="rounded-sm border border-primary-500/40 bg-primary-500/10 px-4 py-1.5 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:border-primary-500 hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSavingIntroduction ? '儲存中…' : '儲存描述'}
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[14px] tracking-wider">
                <span className="text-primary-500/80">外觀提示詞 (餵給 AI 生圖)</span>
                <span className="text-text-tertiary">{visualPromptDraft.length} 字</span>
              </div>
              <textarea
                value={visualPromptDraft}
                onChange={(e) => setVisualPromptDraft(e.target.value)}
                rows={8}
                placeholder="例:35 歲中年男性,黑短髮,商務白襯衫卷袖,深灰精紡羊毛西褲,黃銅皮帶扣,銀色腕錶,神情冷峻,寫實風格 ⋯ 越具體生圖越穩定。注意年代與服裝符合劇本設定。"
                className="w-full resize-none rounded-sm border border-primary-500/30 bg-raised/60 p-3 font-body text-sm leading-relaxed text-text-primary outline-none transition-colors focus:border-primary-500"
                disabled={isSavingVisualPrompt}
              />
              <div className="mt-2 flex items-center justify-between">
                <div className="font-mono text-[12px] tracking-wider text-text-tertiary">
                  儲存後下次「重新生成」會用此 prompt
                </div>
                <div className="flex items-center gap-2">
                  {onRedescribe ? (
                    <button
                      type="button"
                      onClick={onRedescribe}
                      disabled={isRedescribing || isSavingVisualPrompt || isRegenerating || isUploading || !imageUrl}
                      title="用 AI 從目前角色圖重新抽外觀提示詞 — 適合上傳新圖後 / 描述跟圖對不上時"
                      className="rounded-sm border border-border-strong bg-raised/50 px-3 py-1.5 font-mono text-[14px] tracking-wider text-text-secondary transition-all hover:border-primary-500/50 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isRedescribing ? '抽描述中…' : '↻ 從圖抽描述'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setVisualPromptDraft(initialVisualPrompt)}
                    disabled={!visualPromptChanged || isSavingVisualPrompt}
                    className="font-mono text-[14px] tracking-wider text-text-tertiary transition-colors hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    還原
                  </button>
                  <button
                    type="button"
                    onClick={() => onSaveVisualPrompt(visualPromptDraft.trim())}
                    disabled={!visualPromptChanged || isSavingVisualPrompt || !visualPromptDraft.trim()}
                    className="rounded-sm border border-primary-500/40 bg-primary-500/10 px-4 py-1.5 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:border-primary-500 hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSavingVisualPrompt ? '儲存中…' : '儲存提示詞'}
                  </button>
                </div>
              </div>
            </div>

            <CharacterTagsSection profileData={character.profileData ?? null} />

            <CharacterVoiceSection />

            {/* Phase 11.4 — multi-appearance per-episode binding.
                imageUrl + description threaded through so the management
                row can show a thumbnail + caption — user-asked 2026-05-13
                '造型管理我需要不同造型也要有可以看到造型的圖片'. */}
            <V2CharacterAppearancesPanel
              projectId={projectId}
              characterId={character.id}
              currentEpisodeId={currentEpisodeId}
              activeAppearanceId={activeAppearance.id}
              appearances={(character.appearances ?? []).map((a) => {
                // imageUrl priority: explicit a.imageUrl > first entry of
                // a.imageUrls (when it's an array or stringified array) >
                // null. Matches the worker's pick.
                let primaryUrl: string | null = a.imageUrl ?? null
                if (!primaryUrl && a.imageUrls) {
                  if (Array.isArray(a.imageUrls)) {
                    primaryUrl = a.imageUrls[0] ?? null
                  } else if (typeof a.imageUrls === 'string') {
                    try {
                      const parsed = JSON.parse(a.imageUrls) as unknown
                      if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
                        primaryUrl = parsed[0]
                      }
                    } catch {
                      // Plain string url
                      primaryUrl = a.imageUrls
                    }
                  }
                }
                // 2026-05-23 Phase 3 — forward ARK asset registration
                // state so the panel's ArkAssetRegisterChip can render
                // the correct chip variant. Missing these fields would
                // make every appearance show the default "报备火山"
                // button even when already registered.
                const arkAppearance = a as typeof a & {
                  arkAssetId?: string | null
                  arkAssetStatus?: string | null
                  arkAssetSourceUrl?: string | null
                  arkAssetError?: string | null
                }
                return {
                  id: a.id,
                  appearanceIndex: a.appearanceIndex ?? null,
                  changeReason: a.changeReason ?? null,
                  imageUrl: primaryUrl,
                  description: a.description ?? null,
                  arkAssetId: arkAppearance.arkAssetId ?? null,
                  arkAssetStatus: arkAppearance.arkAssetStatus ?? null,
                  arkAssetSourceUrl: arkAppearance.arkAssetSourceUrl ?? null,
                  arkAssetError: arkAppearance.arkAssetError ?? null,
                }
              })}
            />
          </div>
        </div>

        {/* Footer — destructive on the left, primary close on the right */}
        <div className="flex items-center justify-between gap-3 border-t border-border-soft/60 px-6 py-4">
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 rounded-sm border border-rose-500/40 bg-rose-500/5 px-4 py-2 font-mono text-[14px] tracking-wider text-rose-400 transition-all hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🗑 {isDeleting ? '刪除中…' : '刪除角色'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-border-strong bg-raised px-5 py-2 font-mono text-[14px] tracking-wider text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-300"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * LLM-extracted profile chip strip — surfaces a few of the most useful
 * fields from analyze-novel's profileData JSON (personality tags,
 * archetype, era, costume tier) so the user can sanity-check the
 * model's read without opening raw JSON. Read-only for now; editing
 * these would require a schema-aware editor and isn't shipping in
 * this round.
 */
function CharacterTagsSection({ profileData }: { profileData: string | null }) {
  let parsed: Record<string, unknown> = {}
  if (profileData) {
    try { parsed = JSON.parse(profileData) as Record<string, unknown> } catch { /* swallow */ }
  }
  const personalityTags = Array.isArray(parsed.personality_tags)
    ? (parsed.personality_tags as unknown[]).filter((v): v is string => typeof v === 'string')
    : []
  const visualKeywords = Array.isArray(parsed.visual_keywords)
    ? (parsed.visual_keywords as unknown[]).filter((v): v is string => typeof v === 'string')
    : []
  const archetype = typeof parsed.archetype === 'string' ? parsed.archetype : null
  const eraPeriod = typeof parsed.era_period === 'string' ? parsed.era_period : null
  const costumeTier = typeof parsed.costume_tier === 'number' ? parsed.costume_tier : null
  const ageRange = typeof parsed.age_range === 'string' ? parsed.age_range : null

  const hasAnyTag = personalityTags.length > 0 || visualKeywords.length > 0 || archetype || eraPeriod || costumeTier !== null
  if (!hasAnyTag) return null

  return (
    <div className="rounded-sm border border-border-soft/60 bg-raised/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[14px] tracking-wider text-text-tertiary">LLM 角色標籤</div>
        <div className="font-mono text-[12px] text-text-tertiary">分析時自動抽取</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {archetype ? <Chip color="amber">{archetype}</Chip> : null}
        {eraPeriod ? <Chip color="cyan">{eraPeriod}</Chip> : null}
        {costumeTier !== null ? <Chip color="emerald">服裝層級 {costumeTier}/5</Chip> : null}
        {ageRange ? <Chip color="stone">{ageRange}</Chip> : null}
        {personalityTags.map((t) => <Chip key={`p-${t}`} color="rose">{t}</Chip>)}
        {visualKeywords.map((t) => <Chip key={`v-${t}`} color="sky">{t}</Chip>)}
      </div>
    </div>
  )
}

function Chip({ children, color }: { children: React.ReactNode; color: 'amber' | 'rose' | 'emerald' | 'cyan' | 'sky' | 'stone' }) {
  const palette = {
    amber: 'border-primary-500/40 bg-primary-500/10 text-primary-300',
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    cyan: 'border-[var(--process-cyan)]/40 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
    sky: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    stone: 'border-border-strong bg-raised/60 text-text-secondary',
  }[color]
  return (
    <span className={`rounded-sm border px-2 py-0.5 font-mono text-[14px] tracking-wider ${palette}`}>
      {children}
    </span>
  )
}

/** Project custom voice sources remain closed until consent data is durable. */
function CharacterVoiceSection() {
  const voiceT = useTranslations('voice.inlineBinding')

  return (
    <div className="rounded-sm border border-border-soft/60 bg-raised/40 p-3">
      <div className="mb-2 font-mono text-[14px] tracking-wider text-text-tertiary">
        {voiceT('catalogLabel')}
      </div>
      <div className="flex flex-wrap gap-2" aria-describedby="project-custom-voice-unavailable">
        <button
          type="button"
          disabled
          className="flex items-center gap-1 rounded-sm border border-border-soft bg-raised/50 px-2 py-1 font-mono text-[14px] tracking-wider text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="cloudUpload" className="h-3 w-3" />
          {voiceT('uploadAudio')}
        </button>
        <button
          type="button"
          disabled
          className="flex items-center gap-1 rounded-sm border border-border-soft bg-raised/50 px-2 py-1 font-mono text-[14px] tracking-wider text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="bolt" className="h-3 w-3" />
          {voiceT('aiDesign')}
        </button>
      </div>
      <p
        id="project-custom-voice-unavailable"
        className="mt-2 font-body text-[12px] leading-relaxed text-text-tertiary"
      >
        {voiceT('customSourceUnavailable')}
      </p>
    </div>
  )
}

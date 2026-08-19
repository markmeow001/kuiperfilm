'use client'

/**
 * Phase 11.4 / multi-appearance — per-episode appearance binding UI.
 *
 * Renders inside V2CharacterEditModal. For each episode in the project
 * shows a dropdown of this character's available appearances; selecting
 * one writes EpisodeCharacter.appearanceId for (episode, character).
 *
 * Visible result: when panel images / multi-shot videos generate for
 * that episode, the worker resolves the bound appearance instead of
 * defaulting to appearance[0]. Lets users say "ep1-10 = appearance A
 * (initial outfit), ep11+ = appearance B (after the time skip)" without
 * touching panel character references.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import {
  useBulkBindEpisodeCharacterAppearance,
  useCreateCharacterAppearance,
  useDeleteCharacterAppearance,
  useEpisodeCharacterBindings,
  useUpdateCharacterAppearanceMeta,
  useUpdateEpisodeCharacterBinding,
} from '@/lib/query/mutations/episode-character-binding-mutations'
import { useUploadAndExpandCharacterToMultiView } from '@/lib/query/mutations/character-image-ops-mutations'
import { useRegisterArkAsset } from '@/lib/query/mutations/useRegisterArkAsset'
import { AppIcon } from '@/components/ui/icons'
import { DarkMediaLightbox } from '@/components/v2/DarkMediaLightbox'
import { ArkAssetRegisterChip } from './ArkAssetRegisterChip'

interface AppearanceOption {
  id: string
  appearanceIndex?: number | null
  changeReason?: string | null
  /** Frontal reference image — surfaced as a thumbnail in the management row.
   * Falls back to selected index of imageUrls when null. */
  imageUrl?: string | null
  /** LLM-derived visual prompt (35y 西裝商務 etc.) — shown as caption below
   * the appearance name so the user can read the look without zooming the
   * thumbnail. */
  description?: string | null
  // 2026-05-23 — Phase 3: 火山方舟 asset registration status. Surfaced
  // as a chip in the row so the user knows whether this appearance's
  // image is ready for Seedance 2.0 (which rejects raw photoreal URLs).
  // Populated by the register-ark-asset worker; null = never registered.
  arkAssetId?: string | null
  arkAssetStatus?: string | null
  arkAssetSourceUrl?: string | null
  arkAssetError?: string | null
}

interface V2CharacterAppearancesPanelProps {
  projectId: string
  characterId: string
  currentEpisodeId: string | null
  activeAppearanceId: string
  appearances: AppearanceOption[]
}

export function V2CharacterAppearancesPanel({
  projectId,
  characterId,
  currentEpisodeId,
  activeAppearanceId,
  appearances,
}: V2CharacterAppearancesPanelProps) {
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as
    | {
        novelPromotionData?: {
          episodes?: Array<{
            id: string
            episodeNumber?: number | null
            name?: string | null
          }> | null
        } | null
      }
    | undefined

  const episodes = (project?.novelPromotionData?.episodes ?? []).slice().sort((a, b) => {
    return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
  })

  // Lightbox state — shared across all thumbnail rows so we don't render
  // N overlays. Single zoomable url controls visibility.
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null)

  return (
    <div className="space-y-2 rounded-sm border border-border-soft/60 bg-raised/40 p-3">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[14px] tracking-wider text-text-tertiary">
          造型管理 ({appearances.length})
        </div>
        <AddAppearanceButton
          projectId={projectId}
          characterId={characterId}
          currentEpisodeId={currentEpisodeId}
          existingAppearanceCount={appearances.length}
        />
      </div>

      {/* Per-appearance management — thumbnail + rename / delete */}
      {appearances.length > 0 ? (
        <div className="space-y-1.5 border-t border-border-soft/40 pt-2">
          {appearances.map((ap) => (
            <AppearanceManageRow
              key={ap.id}
              projectId={projectId}
              characterId={characterId}
              appearance={ap}
              isActive={ap.id === activeAppearanceId}
              canDelete={appearances.length > 1}
              onZoom={(url) => setZoomImageUrl(url)}
            />
          ))}
        </div>
      ) : null}

      {/* Lightbox overlay — single shared instance per panel so all
          thumbnail clicks route through the same z-index / ESC handler. */}
      <DarkMediaLightbox
        src={zoomImageUrl}
        alt="造型參考圖"
        closeLabel="關閉造型圖片預覽"
        dismissHint="點擊背景或按 Esc 關閉"
        onClose={() => setZoomImageUrl(null)}
      />

      {appearances.length <= 1 ? (
        <div className="font-body text-[11px] italic text-text-tertiary">
          目前只有一個造型。點「+新增造型」加上換裝(例:時間跳轉後的新形象、戰鬥裝、年老回憶等),然後在下方為各集綁定。
        </div>
      ) : episodes.length === 0 ? (
        <div className="font-body text-[11px] italic text-text-tertiary">
          已有 {appearances.length} 個造型,但專案還沒有集數 — 新建劇集後可在此分配。
        </div>
      ) : (
        <>
          {/* Range-bind toolbar — pick an appearance + a from-to range
              and apply once. Saves N clicks on the per-episode rows. */}
          <RangeBindToolbar
            projectId={projectId}
            characterId={characterId}
            episodes={episodes}
            appearances={appearances}
          />

          <div className="flex items-center justify-between border-t border-border-soft/40 pt-2 font-mono text-[12px] text-text-tertiary">
            <span>每集綁定({episodes.length} 集)</span>
            <span>未綁定 = 用第一個造型</span>
          </div>
          <div className="space-y-1.5">
            {episodes.map((ep) => (
              <EpisodeBindingRow
                key={ep.id}
                projectId={projectId}
                characterId={characterId}
                episode={ep}
                appearances={appearances}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Per-appearance row sitting at the top of the panel — lets the user
 * rename a costume (changeReason) or remove a wrongly-created one.
 * Delete is gated so the last appearance can never be removed (mirrors
 * the API guard at /character/appearance DELETE).
 */
function AppearanceManageRow({
  projectId,
  characterId,
  appearance,
  isActive,
  canDelete,
  onZoom,
}: {
  projectId: string
  characterId: string
  appearance: AppearanceOption
  isActive: boolean
  canDelete: boolean
  /** Click handler for the thumbnail — opens the shared lightbox in
   * the parent panel. Called with the url to render full-screen. */
  onZoom: (url: string) => void
}) {
  const activeAppearanceT = useTranslations('v2Subjects.activeAppearance')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(appearance.changeReason ?? '')
  // Description-editor expansion. User-asked 2026-05-13: '目前只能更改最原本
  // 的造型描述,如果要修改其他造型,就沒辦法'. Each appearance row now has
  // its own ✎ button that expands an inline description textarea so the
  // user can edit any appearance's description without leaving the modal.
  const [descExpanded, setDescExpanded] = useState(false)
  const [descDraft, setDescDraft] = useState(appearance.description ?? '')
  // Re-seed when the parent re-fetches (e.g. after a sibling row save).
  useEffect(() => {
    setDescDraft(appearance.description ?? '')
  }, [appearance.description])

  const update = useUpdateCharacterAppearanceMeta(projectId)
  const del = useDeleteCharacterAppearance(projectId)
  const register = useRegisterArkAsset(projectId)
  // Per-appearance image upload. The upload-and-expand mutation was previously
  // only wired into 新增造型 (AddAppearanceButton); existing appearances (e.g.
  // the auto-created 年輕 / 現代 looks) had no way to upload a custom reference
  // — only 描述 / 刪除. This adds a per-row 上傳 so each look can take its own
  // image (upload → 3-view sheet, same as the add-new flow).
  const uploadExpand = useUploadAndExpandCharacterToMultiView(projectId)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const display = appearance.changeReason || `造型 ${(appearance.appearanceIndex ?? 0) + 1}`
  const idxLabel = `#${(appearance.appearanceIndex ?? 0) + 1}`
  const thumbUrl = appearance.imageUrl ?? null
  const caption = appearance.description?.trim() ?? ''
  const descDirty = descDraft.trim() !== (appearance.description ?? '').trim()

  function commitRename() {
    const trimmed = draft.trim()
    if (!trimmed) {
      setDraft(appearance.changeReason ?? '')
      setEditing(false)
      return
    }
    if (trimmed === (appearance.changeReason ?? '')) {
      setEditing(false)
      return
    }
    update.mutate(
      { characterId, appearanceId: appearance.id, changeReason: trimmed },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => {
          alert(`改名失敗:${(err as Error)?.message ?? '未知'}`)
        },
      },
    )
  }

  function handleSaveDescription() {
    const trimmed = descDraft.trim()
    if (trimmed === (appearance.description ?? '').trim()) {
      setDescExpanded(false)
      return
    }
    update.mutate(
      { characterId, appearanceId: appearance.id, description: trimmed },
      {
        onSuccess: () => setDescExpanded(false),
        onError: (err) => {
          alert(`描述儲存失敗:${(err as Error)?.message ?? '未知'}`)
        },
      },
    )
  }

  function handleCancelDescription() {
    setDescDraft(appearance.description ?? '')
    setDescExpanded(false)
  }

  function handleDelete() {
    if (!canDelete) return
    if (!confirm(`確定刪除造型「${display}」?關聯的集綁定也會一併移除。`)) return
    del.mutate(
      { characterId, appearanceId: appearance.id },
      {
        onError: (err) => {
          alert(`刪除失敗:${(err as Error)?.message ?? '未知'}`)
        },
      },
    )
  }

  function handleUploadFile(file: File) {
    uploadExpand.mutate(
      { file, characterId, appearanceId: appearance.id },
      {
        onError: (err) => {
          alert(`上傳失敗:${(err as Error)?.message ?? '未知'}`)
        },
      },
    )
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  return (
    <div
      className={`rounded-[10px] border bg-canvas/40 ${
        isActive
          ? 'border-[var(--production-tool)]/45'
          : 'border-transparent'
      }`}
    >
      <div className="flex items-center gap-2.5 p-2">
        {/* 64×64 thumbnail. Click → lightbox. Hover overlay shows the zoom
            icon so it reads as clickable. Falls back to a gradient + 👤 icon
            placeholder when the appearance has no imageUrl yet. */}
        {thumbUrl ? (
          <button
            type="button"
            onClick={() => onZoom(thumbUrl)}
            aria-label={`圖片預覽：${display}`}
            className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-sm border border-border-soft bg-raised transition-all hover:border-primary-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
            title="點擊看大圖"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl}
              alt={display}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
              <span className="font-mono text-[12px] tracking-wider text-primary-300">🔍</span>
            </span>
          </button>
        ) : (
          <div
            className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-sm border border-border-soft bg-gradient-to-br from-overlay to-raised"
            title="尚未生成圖片"
          >
            <AppIcon name="user" className="h-5 w-5 text-text-tertiary" />
          </div>
        )}

        {/* Right column — name (editable) + caption + actions. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 font-mono text-[12px] tracking-wider text-text-tertiary">{idxLabel}</span>
            {isActive ? (
              <span className="flex-shrink-0 rounded-full bg-[var(--production-tool-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--production-tool)]">
                {activeAppearanceT('modalLabel')}
              </span>
            ) : null}
            {editing ? (
              <input
                autoFocus
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') {
                    setDraft(appearance.changeReason ?? '')
                    setEditing(false)
                  }
                }}
                disabled={update.isPending}
                className="flex-1 rounded-sm border border-primary-500/50 bg-canvas px-1.5 py-0.5 font-body text-xs text-text-primary outline-none disabled:opacity-50"
                placeholder="造型名稱"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex-1 truncate text-left font-body text-[13px] text-text-primary transition-colors hover:text-primary-300"
                title="點擊改名"
              >
                {display}
              </button>
            )}
            {update.isPending ? (
              <span className="font-mono text-[12px] text-text-tertiary">儲存中…</span>
            ) : null}
            {/* 上傳 — per-appearance custom reference image. Upload → 3-view
                sheet (same upload-and-expand path as 新增造型). Lets the user
                give each look (年輕 / 現代 / …) its own image, not just #1. */}
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploadExpand.isPending}
              title="上傳這個造型的參考圖（會生成 3 視角）"
              className="flex-shrink-0 rounded-sm border border-border-soft px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-text-tertiary transition-all hover:border-primary-500/50 hover:text-primary-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploadExpand.isPending ? '上傳中…' : '上傳'}
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleUploadFile(file)
              }}
            />
            {/* ✎ edit description — user-asked 2026-05-13: 'every appearance
                needs its own description editor, not just the first one'. */}
            <button
              type="button"
              onClick={() => setDescExpanded((v) => !v)}
              title={descExpanded ? '收起描述編輯器' : '編輯造型描述'}
              className={`flex-shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[12px] tracking-wider transition-all ${
                descExpanded
                  ? 'border-primary-500/50 bg-primary-500/10 text-primary-300'
                  : 'border-border-soft text-text-tertiary hover:border-primary-500/50 hover:text-primary-300'
              }`}
            >
              {descExpanded ? '▾ 描述' : '✎ 描述'}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete || del.isPending}
              title={canDelete ? '刪除這個造型' : '至少要保留一個造型'}
              className="flex-shrink-0 rounded-sm border border-border-soft px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-text-tertiary transition-all hover:border-rose-500/50 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {del.isPending ? '…' : '刪除'}
            </button>
          </div>
          {caption ? (
            <div className="line-clamp-1 font-body text-[12px] text-text-tertiary" title={caption}>
              {caption}
            </div>
          ) : (
            <div className="font-body text-[12px] italic text-text-tertiary">無描述</div>
          )}
          {/* 2026-05-23 — Phase 3: 火山方舟 asset registration chip.
              Sits below the caption so the row main content stays uncluttered.
              Only renders when imageUrl exists (no point registering empty). */}
          {appearance.imageUrl ? (
            <div className="mt-0.5">
              <ArkAssetRegisterChip
                targetType="CharacterAppearance"
                targetId={appearance.id}
                imageUrl={appearance.imageUrl}
                arkAssetId={appearance.arkAssetId}
                arkAssetStatus={appearance.arkAssetStatus}
                arkAssetSourceUrl={appearance.arkAssetSourceUrl}
                arkAssetError={appearance.arkAssetError}
                onRegister={async ({ targetType, targetId }) => {
                  try {
                    await register.mutateAsync({ targetType, targetId })
                  } catch (err) {
                    alert(`報備失敗:${(err as Error)?.message ?? '未知'}`)
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Expanded description editor — only renders when toggled. Sits
          below the row so the layout still reads as a list. Save sends
          PATCH /character/appearance with the new description; cancel
          reverts to the persisted value. */}
      {descExpanded ? (
        <div className="border-t border-border-soft/40 p-2">
          <textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            rows={6}
            placeholder="造型描述（LLM 生成圖時會用這段作為 prompt）"
            className="w-full resize-none rounded-sm border border-border-soft bg-raised/60 p-2 font-serif-cn text-[12px] leading-relaxed text-text-primary outline-none focus:border-primary-500/40"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="font-mono text-[11px] tracking-wider text-text-tertiary">
              {descDirty ? `✏ 已修改 · ${descDraft.trim().length} 字` : `${descDraft.trim().length} 字`}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCancelDescription}
                disabled={update.isPending}
                className="rounded-sm border border-border-soft px-2 py-0.5 font-mono text-[12px] tracking-wider text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveDescription}
                disabled={!descDirty || update.isPending}
                className="rounded-sm border border-primary-500/50 bg-primary-500/15 px-2 py-0.5 font-mono text-[12px] tracking-wider text-primary-200 transition-all hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {update.isPending ? '儲存中…' : '儲存描述'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Range-bind toolbar. User picks "套用造型 X 至 第 1 - 10 集" and
 * fires one bulk request. Episodes outside the range are left
 * untouched.
 */
function RangeBindToolbar({
  projectId,
  characterId,
  episodes,
  appearances,
}: {
  projectId: string
  characterId: string
  episodes: Array<{ id: string; episodeNumber?: number | null; name?: string | null }>
  appearances: AppearanceOption[]
}) {
  const [selectedAppearance, setSelectedAppearance] = useState<string>('')
  // Default the range to the full project so the user only has to tweak
  // edges, not type from scratch when they want "all episodes".
  const minNum = useMemo(() => Math.min(...episodes.map((e) => e.episodeNumber ?? 1)), [episodes])
  const maxNum = useMemo(() => Math.max(...episodes.map((e) => e.episodeNumber ?? episodes.length)), [episodes])
  const [fromNum, setFromNum] = useState<number>(minNum)
  const [toNum, setToNum] = useState<number>(maxNum)
  const bulk = useBulkBindEpisodeCharacterAppearance(projectId)

  const matchedEpisodes = useMemo(() => {
    const lo = Math.min(fromNum, toNum)
    const hi = Math.max(fromNum, toNum)
    return episodes.filter((e) => {
      const n = e.episodeNumber ?? 0
      return n >= lo && n <= hi
    })
  }, [episodes, fromNum, toNum])

  function handleApply() {
    if (matchedEpisodes.length === 0) {
      alert('範圍沒有對應到任何集數')
      return
    }
    const target =
      selectedAppearance === ''
        ? null // null = 用第一個造型(清除綁定)
        : selectedAppearance
    bulk.mutate(
      {
        characterId,
        appearanceId: target,
        episodeIds: matchedEpisodes.map((e) => e.id),
      },
      {
        onError: (err) => {
          alert(`批量綁定失敗:${(err as Error)?.message ?? '未知'}`)
        },
      },
    )
  }

  return (
    <div className="rounded-sm border border-[var(--process-cyan)]/30 bg-[var(--process-cyan-soft)] px-2 py-2">
      <div className="mb-1.5 font-mono text-[14px] tracking-wider text-[var(--process-cyan-strong)]">
        ⚡ 批量綁定
      </div>
      <div className="flex flex-wrap items-center gap-1.5 font-body text-xs text-text-secondary">
        <span className="text-text-secondary">套用</span>
        <select
          value={selectedAppearance}
          onChange={(e) => setSelectedAppearance(e.target.value)}
          disabled={bulk.isPending}
          className="rounded-sm border border-border-soft bg-canvas/80 px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-[var(--production-focus)] disabled:opacity-50"
        >
          <option value="">— 用第一個造型 —</option>
          {appearances.map((ap) => {
            const label = ap.changeReason || `造型 ${(ap.appearanceIndex ?? 0) + 1}`
            return (
              <option key={ap.id} value={ap.id}>
                {label}
              </option>
            )
          })}
        </select>
        <span className="text-text-secondary">至 第</span>
        <input
          type="number"
          value={fromNum}
          onChange={(e) => setFromNum(Number.parseInt(e.target.value, 10) || minNum)}
          min={minNum}
          max={maxNum}
          disabled={bulk.isPending}
          className="w-14 rounded-sm border border-border-soft bg-canvas/80 px-1.5 py-0.5 text-center font-mono text-xs text-text-primary outline-none focus:border-[var(--production-focus)] disabled:opacity-50"
        />
        <span className="text-text-secondary">-</span>
        <input
          type="number"
          value={toNum}
          onChange={(e) => setToNum(Number.parseInt(e.target.value, 10) || maxNum)}
          min={minNum}
          max={maxNum}
          disabled={bulk.isPending}
          className="w-14 rounded-sm border border-border-soft bg-canvas/80 px-1.5 py-0.5 text-center font-mono text-xs text-text-primary outline-none focus:border-[var(--production-focus)] disabled:opacity-50"
        />
        <span className="text-text-secondary">集</span>
        <button
          type="button"
          onClick={handleApply}
          disabled={bulk.isPending || matchedEpisodes.length === 0}
          className="ml-auto rounded-sm border border-[var(--production-blue)]/45 bg-[var(--production-blue-soft)] px-3 py-0.5 font-mono text-[14px] tracking-wider text-[var(--process-cyan-strong)] transition-all hover:border-[var(--production-blue)] hover:bg-[var(--production-blue-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {bulk.isPending ? '套用中…' : `套用 (${matchedEpisodes.length} 集)`}
        </button>
      </div>
    </div>
  )
}

function AddAppearanceButton({
  projectId,
  characterId,
  currentEpisodeId,
  existingAppearanceCount,
}: {
  projectId: string
  characterId: string
  currentEpisodeId: string | null
  existingAppearanceCount: number
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [desc, setDesc] = useState('')
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const create = useCreateCharacterAppearance(projectId)
  const uploadExpand = useUploadAndExpandCharacterToMultiView(projectId)
  const inFlight = create.isPending || uploadExpand.isPending

  function reset() {
    setOpen(false)
    setReason('')
    setDesc('')
    setPickedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSave() {
    const trimmedReason = reason.trim()
    const trimmedDesc = desc.trim()
    if (!trimmedReason) {
      alert('造型名稱必填')
      return
    }
    // Image-driven path: file is the source of truth, description can
    // be a placeholder. Pure-text path: description required.
    if (!pickedFile && !trimmedDesc) {
      alert('描述或上傳參考圖至少要填一項')
      return
    }
    const descToSave = trimmedDesc || `(由上傳的參考圖生成的「${trimmedReason}」造型)`
    create.mutate(
      {
        characterId,
        changeReason: trimmedReason,
        description: descToSave,
        episodeId: currentEpisodeId ?? undefined,
      },
      {
        onSuccess: (data: unknown) => {
          // The create endpoint returns { appearance: { id, ... } }
          const appearance = (data as { appearance?: { id?: string } })?.appearance
          const newAppearanceId = appearance?.id
          if (pickedFile && newAppearanceId) {
            uploadExpand.mutate(
              { file: pickedFile, characterId, appearanceId: newAppearanceId },
              {
                onSuccess: reset,
                onError: (err) => {
                  alert(`造型已建立但多視角生成提交失敗:${(err as Error)?.message ?? '未知'}\n你可以稍後在這個造型上點重新生成。`)
                  reset()
                },
              },
            )
          } else {
            reset()
          }
        },
        onError: (err) => {
          alert(`新增造型失敗:${(err as Error)?.message ?? '未知'}`)
        },
      },
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-primary-500/40 bg-primary-500/10 px-2 py-1 font-mono text-[14px] tracking-wider text-primary-300 transition-all hover:bg-primary-500/20"
      >
        + 新增造型
      </button>
    )
  }

  const suggestedReason = existingAppearanceCount === 1 ? '時間跳轉造型' : `造型 ${existingAppearanceCount + 1}`

  return (
    <div className="flex min-w-0 w-full flex-1 flex-col gap-2 rounded-sm border border-primary-500/40 bg-canvas/60 p-2">
      <div className="font-mono text-[14px] tracking-wider text-primary-400">新增造型</div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`造型名稱(例:${suggestedReason})`}
        className="min-w-0 w-full rounded-sm border border-border-soft bg-canvas/80 px-2 py-1 font-body text-xs text-text-primary outline-none focus:border-primary-500"
        disabled={inFlight}
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={3}
        placeholder={pickedFile
          ? '描述(可選 — 上傳參考圖後可以留空,系統用圖片生 3 視角)'
          : '外觀描述(種族/年齡/服裝/配件,越具體越穩)或下方上傳參考圖至少擇一'}
        className="min-w-0 w-full resize-none rounded-sm border border-border-soft bg-canvas/80 px-2 py-1 font-body text-xs text-text-primary outline-none focus:border-primary-500"
        disabled={inFlight}
      />

      {/* Optional reference image — when picked, we run upload-and-expand
          after the appearance row is created so the new outfit gets a
          3-view sheet generated FROM the user's reference instead of a
          pure-text prompt. */}
      <div className="flex min-w-0 flex-col items-stretch gap-2 rounded-sm border border-border-soft/60 bg-raised/40 px-2 py-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon name="image" className="h-3 w-3 text-text-tertiary" />
          {pickedFile ? (
            <span className="min-w-0 truncate font-mono text-[14px] text-primary-300" title={pickedFile.name}>
              {pickedFile.name.length > 28 ? `${pickedFile.name.slice(0, 28)}…` : pickedFile.name}
            </span>
          ) : (
            <span className="min-w-0 break-words font-mono text-[14px] text-text-tertiary">參考圖(可選 — 上傳即用此圖生 3 視角)</span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {pickedFile ? (
            <button
              type="button"
              onClick={() => {
                setPickedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              disabled={inFlight}
              className="font-mono text-[12px] tracking-wider text-text-tertiary transition-colors hover:text-rose-400 disabled:opacity-50"
            >
              清除
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={inFlight}
            className="rounded-sm border border-border-strong bg-raised px-2 py-0.5 font-mono text-[12px] tracking-wider text-text-secondary transition-all hover:border-primary-500/40 hover:text-primary-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pickedFile ? '更換' : '選擇圖片'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) setPickedFile(file)
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 font-mono text-[14px]">
        <button
          type="button"
          onClick={reset}
          disabled={inFlight}
          className="text-text-tertiary transition-colors hover:text-text-secondary disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={inFlight || !reason.trim() || (!desc.trim() && !pickedFile)}
          className="rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1 text-primary-300 transition-all hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {create.isPending
            ? '建立中…'
            : uploadExpand.isPending
              ? '上傳中…'
              : pickedFile ? '建立 + 上傳轉 3 視角' : '建立造型'}
        </button>
      </div>
    </div>
  )
}

interface EpisodeBindingRowProps {
  projectId: string
  characterId: string
  episode: { id: string; episodeNumber?: number | null; name?: string | null }
  appearances: AppearanceOption[]
}

export function EpisodeBindingRow({
  projectId,
  characterId,
  episode,
  appearances,
}: EpisodeBindingRowProps) {
  const t = useTranslations('v2Subjects.activeAppearance')
  const bindingsQuery = useEpisodeCharacterBindings(projectId, episode.id)
  const updateBinding = useUpdateEpisodeCharacterBinding(projectId)

  const currentBinding = (bindingsQuery.data ?? []).find((b) => b.characterId === characterId)
  const currentValue = currentBinding?.appearanceId ?? ''
  const bindingLoadFailed = Boolean(bindingsQuery.error)
  const bindingUnavailable = bindingsQuery.isPending || bindingsQuery.isFetching || bindingLoadFailed

  function handleChange(value: string) {
    if (bindingUnavailable) return
    updateBinding.mutate({
      episodeId: episode.id,
      characterId,
      appearanceId: value === '' ? null : value,
    })
  }

  const epLabel = episode.episodeNumber
    ? t('episodeNumber', { number: episode.episodeNumber })
    : episode.name ?? episode.id.slice(0, 6)

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border-soft/60 bg-canvas/35 p-2 sm:flex-row sm:items-center">
      <div className="w-full flex-shrink-0 text-[14px] text-text-secondary sm:w-20">{epLabel}</div>
      <div className="min-w-0 flex-1">
        <select
          aria-label={epLabel}
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          disabled={bindingUnavailable || updateBinding.isPending}
          className="min-h-11 w-full rounded-[9px] border border-border-soft bg-canvas/80 px-2 text-xs text-text-primary outline-none focus:border-[var(--production-focus)] focus:ring-2 focus:ring-[var(--production-focus)]/20 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <option value="">{t('bindingDefaultOption')}</option>
          {appearances.map((ap) => {
            const label = ap.changeReason || t('appearanceNumber', { number: (ap.appearanceIndex ?? 0) + 1 })
            return (
              <option key={ap.id} value={ap.id}>
                {label}
              </option>
            )
          })}
        </select>
        {bindingsQuery.isPending || (bindingsQuery.isFetching && !bindingLoadFailed) ? (
          <div role="status" className="mt-1.5 text-[12px] text-[var(--production-ink-muted)]">
            {t('bindingLoading')}
          </div>
        ) : null}
        {bindingLoadFailed ? (
          <div
            role="alert"
            className="mt-1.5 flex flex-col gap-2 rounded-[8px] border border-[var(--production-danger)]/30 bg-[var(--production-danger)]/10 px-2.5 py-2 text-[12px] text-[var(--production-danger)] sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{t('bindingError')}</span>
            <button
              type="button"
              onClick={() => { void bindingsQuery.refetch() }}
              className="min-h-11 shrink-0 rounded-[8px] border border-[var(--production-danger)]/40 px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
            >
              {t('bindingRetry')}
            </button>
          </div>
        ) : null}
      </div>
      {updateBinding.isPending ? (
        <span className="text-[12px] text-text-tertiary">{t('bindingSaving')}</span>
      ) : null}
    </div>
  )
}

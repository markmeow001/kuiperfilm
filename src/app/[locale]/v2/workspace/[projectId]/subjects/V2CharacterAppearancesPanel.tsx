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
import { AppIcon } from '@/components/ui/icons'

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
}

interface V2CharacterAppearancesPanelProps {
  projectId: string
  characterId: string
  appearances: AppearanceOption[]
}

export function V2CharacterAppearancesPanel({
  projectId,
  characterId,
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
    <div className="space-y-2 rounded-sm border border-stone-800/60 bg-stone-900/40 p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[14px] tracking-wider text-stone-500">
          造型管理 ({appearances.length})
        </div>
        <AddAppearanceButton
          projectId={projectId}
          characterId={characterId}
          existingAppearanceCount={appearances.length}
        />
      </div>

      {/* Per-appearance management — thumbnail + rename / delete */}
      {appearances.length > 0 ? (
        <div className="space-y-1.5 border-t border-stone-800/40 pt-2">
          {appearances.map((ap) => (
            <AppearanceManageRow
              key={ap.id}
              projectId={projectId}
              characterId={characterId}
              appearance={ap}
              canDelete={appearances.length > 1}
              onZoom={(url) => setZoomImageUrl(url)}
            />
          ))}
        </div>
      ) : null}

      {/* Lightbox overlay — single shared instance per panel so all
          thumbnail clicks route through the same z-index / ESC handler. */}
      {zoomImageUrl ? (
        <AppearanceLightbox url={zoomImageUrl} onClose={() => setZoomImageUrl(null)} />
      ) : null}

      {appearances.length <= 1 ? (
        <div className="font-body text-[11px] italic text-stone-500">
          目前只有一個造型。點「+新增造型」加上換裝(例:時間跳轉後的新形象、戰鬥裝、年老回憶等),然後在下方為各集綁定。
        </div>
      ) : episodes.length === 0 ? (
        <div className="font-body text-[11px] italic text-stone-500">
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

          <div className="flex items-center justify-between border-t border-stone-800/40 pt-2 font-mono text-[12px] text-stone-600">
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
  canDelete,
  onZoom,
}: {
  projectId: string
  characterId: string
  appearance: AppearanceOption
  canDelete: boolean
  /** Click handler for the thumbnail — opens the shared lightbox in
   * the parent panel. Called with the url to render full-screen. */
  onZoom: (url: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(appearance.changeReason ?? '')
  const update = useUpdateCharacterAppearanceMeta(projectId)
  const del = useDeleteCharacterAppearance(projectId)

  const display = appearance.changeReason || `造型 ${(appearance.appearanceIndex ?? 0) + 1}`
  const idxLabel = `#${(appearance.appearanceIndex ?? 0) + 1}`
  const thumbUrl = appearance.imageUrl ?? null
  const caption = appearance.description?.trim() ?? ''

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

  return (
    <div className="flex items-center gap-2.5 rounded-sm bg-stone-950/40 p-2">
      {/* 64×64 thumbnail. Click → lightbox. Hover overlay shows the zoom
          icon so it reads as clickable. Falls back to a gradient + 👤 icon
          placeholder when the appearance has no imageUrl yet (genuinely
          common for newly-added rows before re-generation runs). */}
      {thumbUrl ? (
        <button
          type="button"
          onClick={() => onZoom(thumbUrl)}
          className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-sm border border-stone-800 bg-stone-900 transition-all hover:border-amber-500/60"
          title="點擊看大圖"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl}
            alt={display}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
            <span className="font-mono text-[12px] tracking-wider text-amber-300">🔍</span>
          </div>
        </button>
      ) : (
        <div
          className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-sm border border-stone-800 bg-gradient-to-br from-stone-800 to-stone-900"
          title="尚未生成圖片"
        >
          <AppIcon name="user" className="h-5 w-5 text-stone-600" />
        </div>
      )}

      {/* Right column — name (editable) + caption + actions. Caption
          truncates to one line so multi-paragraph LLM prompts don't push
          the layout. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 font-mono text-[12px] tracking-wider text-stone-600">{idxLabel}</span>
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
              className="flex-1 rounded-sm border border-amber-500/50 bg-stone-950 px-1.5 py-0.5 font-body text-xs text-stone-100 outline-none disabled:opacity-50"
              placeholder="造型名稱"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex-1 truncate text-left font-body text-[13px] text-stone-200 transition-colors hover:text-amber-300"
              title="點擊改名"
            >
              {display}
            </button>
          )}
          {update.isPending ? (
            <span className="font-mono text-[12px] text-stone-500">儲存中…</span>
          ) : null}
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete || del.isPending}
            title={canDelete ? '刪除這個造型' : '至少要保留一個造型'}
            className="flex-shrink-0 rounded-sm border border-stone-800 px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-stone-500 transition-all hover:border-rose-500/50 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {del.isPending ? '…' : '刪除'}
          </button>
        </div>
        {caption ? (
          <div className="line-clamp-1 font-body text-[12px] text-stone-500" title={caption}>
            {caption}
          </div>
        ) : (
          <div className="font-body text-[12px] italic text-stone-700">無描述</div>
        )}
      </div>
    </div>
  )
}

/**
 * Full-screen lightbox overlay for appearance thumbnails. Lives at panel
 * root so all thumbnail clicks route through one z-index layer. Clicking
 * the backdrop or pressing ESC closes.
 */
function AppearanceLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  // ESC to close. Effect runs only while overlay is mounted.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-8 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="造型參考圖"
        className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-1 font-mono text-[14px] tracking-wider text-stone-300 transition-colors hover:border-amber-500/60 hover:text-amber-300"
        title="關閉 (ESC)"
      >
        ✕ 關閉
      </button>
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
    <div className="rounded-sm border border-violet-500/20 bg-violet-500/5 px-2 py-2">
      <div className="mb-1.5 font-mono text-[14px] tracking-wider text-violet-300">
        ⚡ 批量綁定
      </div>
      <div className="flex flex-wrap items-center gap-1.5 font-body text-xs text-stone-300">
        <span className="text-stone-400">套用</span>
        <select
          value={selectedAppearance}
          onChange={(e) => setSelectedAppearance(e.target.value)}
          disabled={bulk.isPending}
          className="rounded-sm border border-stone-800 bg-stone-950/80 px-1.5 py-0.5 text-xs text-stone-200 outline-none focus:border-violet-500/60 disabled:opacity-50"
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
        <span className="text-stone-400">至 第</span>
        <input
          type="number"
          value={fromNum}
          onChange={(e) => setFromNum(Number.parseInt(e.target.value, 10) || minNum)}
          min={minNum}
          max={maxNum}
          disabled={bulk.isPending}
          className="w-14 rounded-sm border border-stone-800 bg-stone-950/80 px-1.5 py-0.5 text-center font-mono text-xs text-stone-200 outline-none focus:border-violet-500/60 disabled:opacity-50"
        />
        <span className="text-stone-400">-</span>
        <input
          type="number"
          value={toNum}
          onChange={(e) => setToNum(Number.parseInt(e.target.value, 10) || maxNum)}
          min={minNum}
          max={maxNum}
          disabled={bulk.isPending}
          className="w-14 rounded-sm border border-stone-800 bg-stone-950/80 px-1.5 py-0.5 text-center font-mono text-xs text-stone-200 outline-none focus:border-violet-500/60 disabled:opacity-50"
        />
        <span className="text-stone-400">集</span>
        <button
          type="button"
          onClick={handleApply}
          disabled={bulk.isPending || matchedEpisodes.length === 0}
          className="ml-auto rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-0.5 font-mono text-[14px] tracking-wider text-violet-200 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
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
  existingAppearanceCount,
}: {
  projectId: string
  characterId: string
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
      { characterId, changeReason: trimmedReason, description: descToSave },
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
        className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[14px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20"
      >
        + 新增造型
      </button>
    )
  }

  const suggestedReason = existingAppearanceCount === 1 ? '時間跳轉造型' : `造型 ${existingAppearanceCount + 1}`

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-sm border border-amber-500/40 bg-stone-950/60 p-2">
      <div className="font-mono text-[14px] tracking-wider text-amber-400">新增造型</div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`造型名稱(例:${suggestedReason})`}
        className="rounded-sm border border-stone-800 bg-stone-950/80 px-2 py-1 font-body text-xs text-stone-200 outline-none focus:border-amber-500"
        disabled={inFlight}
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={3}
        placeholder={pickedFile
          ? '描述(可選 — 上傳參考圖後可以留空,系統用圖片生 3 視角)'
          : '外觀描述(種族/年齡/服裝/配件,越具體越穩)或下方上傳參考圖至少擇一'}
        className="resize-none rounded-sm border border-stone-800 bg-stone-950/80 px-2 py-1 font-body text-xs text-stone-200 outline-none focus:border-amber-500"
        disabled={inFlight}
      />

      {/* Optional reference image — when picked, we run upload-and-expand
          after the appearance row is created so the new outfit gets a
          3-view sheet generated FROM the user's reference instead of a
          pure-text prompt. */}
      <div className="flex items-center justify-between rounded-sm border border-stone-800/60 bg-stone-900/40 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <AppIcon name="image" className="h-3 w-3 text-stone-500" />
          {pickedFile ? (
            <span className="font-mono text-[14px] text-amber-300" title={pickedFile.name}>
              {pickedFile.name.length > 28 ? `${pickedFile.name.slice(0, 28)}…` : pickedFile.name}
            </span>
          ) : (
            <span className="font-mono text-[14px] text-stone-500">參考圖(可選 — 上傳即用此圖生 3 視角)</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {pickedFile ? (
            <button
              type="button"
              onClick={() => {
                setPickedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              disabled={inFlight}
              className="font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-rose-400 disabled:opacity-50"
            >
              清除
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={inFlight}
            className="rounded-sm border border-stone-700 bg-stone-900 px-2 py-0.5 font-mono text-[12px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="flex items-center justify-end gap-2 font-mono text-[14px]">
        <button
          type="button"
          onClick={reset}
          disabled={inFlight}
          className="text-stone-500 transition-colors hover:text-stone-300 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={inFlight || !reason.trim() || (!desc.trim() && !pickedFile)}
          className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
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

function EpisodeBindingRow({
  projectId,
  characterId,
  episode,
  appearances,
}: EpisodeBindingRowProps) {
  const bindingsQuery = useEpisodeCharacterBindings(projectId, episode.id)
  const updateBinding = useUpdateEpisodeCharacterBinding(projectId)

  const currentBinding = (bindingsQuery.data ?? []).find((b) => b.characterId === characterId)
  const currentValue = currentBinding?.appearanceId ?? ''

  function handleChange(value: string) {
    updateBinding.mutate({
      episodeId: episode.id,
      characterId,
      appearanceId: value === '' ? null : value,
    })
  }

  const epLabel = episode.episodeNumber
    ? `第 ${episode.episodeNumber} 集`
    : episode.name ?? episode.id.slice(0, 6)

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 flex-shrink-0 font-mono text-[14px] text-stone-400">{epLabel}</div>
      <select
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        disabled={updateBinding.isPending}
        className="flex-1 rounded-sm border border-stone-800 bg-stone-950/80 px-2 py-1 font-body text-xs text-stone-200 outline-none focus:border-amber-500 disabled:opacity-50"
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
      {updateBinding.isPending ? (
        <span className="font-mono text-[12px] text-stone-500">儲存中…</span>
      ) : null}
    </div>
  )
}

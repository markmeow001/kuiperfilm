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

import { useRef, useState } from 'react'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import {
  useCreateCharacterAppearance,
  useEpisodeCharacterBindings,
  useUpdateEpisodeCharacterBinding,
} from '@/lib/query/mutations/episode-character-binding-mutations'
import { useUploadAndExpandCharacterToMultiView } from '@/lib/query/mutations/character-image-ops-mutations'
import { AppIcon } from '@/components/ui/icons'

interface AppearanceOption {
  id: string
  appearanceIndex?: number | null
  changeReason?: string | null
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

  return (
    <div className="space-y-2 rounded-sm border border-stone-800/60 bg-stone-900/40 p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-wider text-stone-500">
          造型管理 ({appearances.length})
        </div>
        <AddAppearanceButton
          projectId={projectId}
          characterId={characterId}
          existingAppearanceCount={appearances.length}
        />
      </div>

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
          <div className="flex items-center justify-between border-t border-stone-800/40 pt-2 font-mono text-[9px] text-stone-600">
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
        className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[10px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20"
      >
        + 新增造型
      </button>
    )
  }

  const suggestedReason = existingAppearanceCount === 1 ? '時間跳轉造型' : `造型 ${existingAppearanceCount + 1}`

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-sm border border-amber-500/40 bg-stone-950/60 p-2">
      <div className="font-mono text-[10px] tracking-wider text-amber-400">新增造型</div>
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
            <span className="font-mono text-[10px] text-amber-300" title={pickedFile.name}>
              {pickedFile.name.length > 28 ? `${pickedFile.name.slice(0, 28)}…` : pickedFile.name}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-stone-500">參考圖(可選 — 上傳即用此圖生 3 視角)</span>
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
              className="font-mono text-[9px] tracking-wider text-stone-500 transition-colors hover:text-rose-400 disabled:opacity-50"
            >
              清除
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={inFlight}
            className="rounded-sm border border-stone-700 bg-stone-900 px-2 py-0.5 font-mono text-[9px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="flex items-center justify-end gap-2 font-mono text-[10px]">
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
      <div className="w-20 flex-shrink-0 font-mono text-[10px] text-stone-400">{epLabel}</div>
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
        <span className="font-mono text-[9px] text-stone-500">儲存中…</span>
      ) : null}
    </div>
  )
}

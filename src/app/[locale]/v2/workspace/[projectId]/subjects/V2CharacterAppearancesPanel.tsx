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

import { useState } from 'react'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import {
  useCreateCharacterAppearance,
  useEpisodeCharacterBindings,
  useUpdateEpisodeCharacterBinding,
} from '@/lib/query/mutations/episode-character-binding-mutations'

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
  const create = useCreateCharacterAppearance(projectId)

  function handleSave() {
    const trimmedReason = reason.trim()
    const trimmedDesc = desc.trim()
    if (!trimmedReason || !trimmedDesc) {
      alert('造型名稱和描述都要填')
      return
    }
    create.mutate(
      { characterId, changeReason: trimmedReason, description: trimmedDesc },
      {
        onSuccess: () => {
          setOpen(false)
          setReason('')
          setDesc('')
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
        disabled={create.isPending}
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={3}
        placeholder="外觀描述(同 visual_description 格式 — 種族/年齡/服裝/配件,越具體越穩)"
        className="resize-none rounded-sm border border-stone-800 bg-stone-950/80 px-2 py-1 font-body text-xs text-stone-200 outline-none focus:border-amber-500"
        disabled={create.isPending}
      />
      <div className="flex items-center justify-end gap-2 font-mono text-[10px]">
        <button
          type="button"
          onClick={() => { setOpen(false); setReason(''); setDesc('') }}
          disabled={create.isPending}
          className="text-stone-500 transition-colors hover:text-stone-300 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={create.isPending || !reason.trim() || !desc.trim()}
          className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {create.isPending ? '建立中…' : '建立造型'}
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

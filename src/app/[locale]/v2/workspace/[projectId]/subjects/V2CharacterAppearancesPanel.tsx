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

import { useProjectData } from '@/lib/query/hooks/useProjectData'
import {
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

  if (appearances.length <= 1) {
    return (
      <div className="rounded-sm border border-stone-800/60 bg-stone-900/40 p-3">
        <div className="mb-1 font-mono text-[10px] tracking-wider text-stone-500">
          每集造型綁定
        </div>
        <div className="font-body text-[11px] italic text-stone-500">
          此角色只有一個造型 — 加 +新增造型 後才需要綁定到不同集數。
        </div>
      </div>
    )
  }

  if (episodes.length === 0) {
    return (
      <div className="rounded-sm border border-stone-800/60 bg-stone-900/40 p-3">
        <div className="mb-1 font-mono text-[10px] tracking-wider text-stone-500">
          每集造型綁定
        </div>
        <div className="font-body text-[11px] italic text-stone-500">
          專案還沒有集數 — 新建劇集後可在此分配造型。
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-sm border border-stone-800/60 bg-stone-900/40 p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-wider text-stone-500">
          每集造型綁定 ({episodes.length})
        </div>
        <div className="font-mono text-[9px] text-stone-600">
          未綁定 = 用第一個造型
        </div>
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

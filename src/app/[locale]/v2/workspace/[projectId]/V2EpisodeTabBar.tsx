'use client'

/**
 * Phase 12.x.x — v2-native EpisodeTabBar.
 *
 * Earlier this wrapped the Phase-11.1 EpisodeTabBar component, but its
 * frosted-white-glass styling clashed with the v2 cinematic dark palette
 * (stone-950 / amber-500 / serif-cn), so this is rewritten inline using
 * the same border-stone-800 / amber-500 chip language the rest of v2
 * uses.
 *
 * Behaviour preserved:
 *  - Tab click → `?episode=<id>` via useCurrentEpisode.setCurrentEpisode
 *  - "+ 新建劇集" → POST /episodes
 *  - Double-click tab → inline rename → PATCH /episodes/[id]
 *  - Right-click delete (×) → confirm + DELETE /episodes/[id]
 *  - Refuses to delete the last remaining episode
 *  - Keyboard ←/→ between tabs when the bar has focus
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import { useCurrentEpisode } from './hooks/useCurrentEpisode'
import { queryKeys } from '@/lib/query/keys'

interface V2EpisodeTabBarProps {
  projectId: string
  locale: string
  projectName?: string
}

export function V2EpisodeTabBar({ projectId, locale, projectName }: V2EpisodeTabBarProps) {
  const queryClient = useQueryClient()
  const { episodes, currentEpisodeId, setCurrentEpisode } = useCurrentEpisode(projectId)
  const [busy, setBusy] = useState<'add' | 'rename' | 'delete' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const tabsRef = useRef<HTMLDivElement>(null)

  const refreshProject = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
  }, [queryClient, projectId])

  // Auto-scroll the active tab into view when the URL switches.
  useEffect(() => {
    if (!currentEpisodeId) return
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-tab-id="${currentEpisodeId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [currentEpisodeId])

  const handleAdd = useCallback(async () => {
    if (busy) return
    setBusy('add')
    try {
      const nextNumber = episodes.length + 1
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `第 ${nextNumber} 集` }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        alert(`建立集數失敗 (${res.status}): ${text || '未知錯誤'}`)
        return
      }
      const json = (await res.json()) as { episode?: { id?: string } }
      const newId = json.episode?.id ?? null
      await refreshProject()
      if (newId) setCurrentEpisode(newId)
    } catch (err) {
      alert(`建立集數失敗: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }, [busy, episodes.length, projectId, refreshProject, setCurrentEpisode])

  const submitRename = useCallback(
    async (id: string) => {
      const trimmed = editingName.trim()
      if (!trimmed || busy) {
        setEditingId(null)
        return
      }
      setBusy('rename')
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          alert(`重命名失敗 (${res.status}): ${text || '未知錯誤'}`)
          return
        }
        await refreshProject()
      } catch (err) {
        alert(`重命名失敗: ${(err as Error).message}`)
      } finally {
        setBusy(null)
        setEditingId(null)
      }
    },
    [busy, editingName, projectId, refreshProject],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (busy) return
      if (episodes.length <= 1) {
        alert('至少需要保留一集')
        return
      }
      const target = episodes.find((ep) => ep.id === id)
      const ok = confirm(`刪除「${target?.name ?? '此集'}」?此操作無法復原。`)
      if (!ok) return
      setBusy('delete')
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${id}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          alert(`刪除失敗 (${res.status}): ${text || '未知錯誤'}`)
          return
        }
        if (id === currentEpisodeId) {
          const remaining = episodes.filter((ep) => ep.id !== id)
          if (remaining[0]) setCurrentEpisode(remaining[0].id)
        }
        await refreshProject()
      } catch (err) {
        alert(`刪除失敗: ${(err as Error).message}`)
      } finally {
        setBusy(null)
      }
    },
    [busy, currentEpisodeId, episodes, projectId, refreshProject, setCurrentEpisode],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (episodes.length === 0 || editingId) return
      const idx = currentEpisodeId
        ? episodes.findIndex((ep) => ep.id === currentEpisodeId)
        : 0
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        const next = episodes[(idx + 1) % episodes.length]
        if (next) setCurrentEpisode(next.id)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        const prev = episodes[(idx - 1 + episodes.length) % episodes.length]
        if (prev) setCurrentEpisode(prev.id)
      }
    },
    [currentEpisodeId, editingId, episodes, setCurrentEpisode],
  )

  // Render even with 0 episodes — show just the "+ 新建劇集" button so the
  // user has a clear entry point before any episode exists. ScriptPage's
  // own "儲存" still auto-creates the first episode on its own as a safety
  // net for users who skip the tab bar and start typing directly.
  return (
    <div
      className="flex items-stretch gap-2 border-b border-stone-800/60 bg-stone-950 px-6 py-3"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Project name link → home overview */}
      <Link
        href={`/${locale}/v2/workspace/${projectId}`}
        title={projectName ?? '專案首頁'}
        className="flex shrink-0 items-center gap-2 rounded-sm border border-stone-800/50 bg-stone-900/30 px-3 py-1.5 font-serif-cn text-sm text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-300"
      >
        <AppIcon name="bookOpen" className="h-4 w-4" />
        <span className="max-w-[160px] truncate">{projectName ?? '專案'}</span>
      </Link>

      {/* Episode tabs (scrollable) */}
      <div
        ref={tabsRef}
        className="flex flex-1 items-center gap-1 overflow-x-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        {episodes.map((episode) => {
          const isActive = episode.id === currentEpisodeId
          const isEditing = editingId === episode.id
          if (isEditing) {
            return (
              <div
                key={episode.id}
                data-tab-id={episode.id}
                className="flex shrink-0 items-center gap-1 rounded-sm border border-amber-500/50 bg-amber-500/10 px-2 py-1.5"
              >
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename(episode.id)
                    else if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={() => void submitRename(episode.id)}
                  autoFocus
                  className="w-28 bg-transparent font-serif-cn text-sm text-amber-100 outline-none"
                />
              </div>
            )
          }
          return (
            <div
              key={episode.id}
              data-tab-id={episode.id}
              className={`group relative shrink-0 transition-colors ${isActive ? '' : ''}`}
            >
              <button
                type="button"
                onClick={() => setCurrentEpisode(episode.id)}
                onDoubleClick={() => {
                  setEditingId(episode.id)
                  setEditingName(episode.name)
                }}
                className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all ${
                  isActive
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                    : 'border-stone-800/40 bg-stone-900/20 text-stone-400 hover:border-stone-700 hover:text-stone-200'
                }`}
                title={`${episode.name}（雙擊重命名)`}
              >
                <span className={`font-mono text-[14px] ${isActive ? 'text-amber-500' : 'text-stone-600'}`}>
                  {String(episode.episodeNumber).padStart(2, '0')}
                </span>
                <span>{episode.name}</span>
              </button>
              {/* Delete (×) — only on hover and when there's more than one episode */}
              {episodes.length > 1 ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(episode.id)}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-[14px] text-stone-400 transition-colors hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-300 group-hover:flex"
                  title="刪除此集"
                >
                  ×
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* + 新建劇集 */}
      <button
        type="button"
        onClick={() => void handleAdd()}
        disabled={busy === 'add'}
        className="flex shrink-0 items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 font-serif-cn text-sm text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/15 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AppIcon name="plus" className="h-3.5 w-3.5" />
        <span>{busy === 'add' ? '新增中…' : '新建劇集'}</span>
      </button>
    </div>
  )
}

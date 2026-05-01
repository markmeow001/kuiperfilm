'use client'

/**
 * Phase 12.x.x — v2 wrapper around the existing Phase-11.1 EpisodeTabBar.
 *
 * Pulls the episodes list from useProjectData via useCurrentEpisode, drives
 * the URL `?episode=<id>` search param on tab click, and wires + / rename /
 * delete to the existing /api/novel-promotion/[projectId]/episodes routes.
 */

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import EpisodeTabBar from '@/components/ui/EpisodeTabBar'
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

  const refreshProject = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
  }, [queryClient, projectId])

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

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      if (busy) return
      setBusy('rename')
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
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
      }
    },
    [busy, projectId, refreshProject],
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
        // If we just deleted the current episode, fall back to the first remaining one.
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

  // Don't render the tab bar if there's no project yet — the bar would be empty
  // and confusing. Once the user creates the first episode (via ScriptPage's
  // "生成劇本" CTA), this component will pick it up on the next render.
  if (episodes.length === 0) return null
  if (!currentEpisodeId) return null

  return (
    <EpisodeTabBar
      projectName={projectName ?? ''}
      projectHref={`/${locale}/v2/workspace/${projectId}`}
      episodes={episodes.map((ep) => ({
        id: ep.id,
        title: ep.name,
        episodeNumber: ep.episodeNumber,
      }))}
      currentId={currentEpisodeId}
      onSelect={setCurrentEpisode}
      onAdd={handleAdd}
      onRename={handleRename}
      onDelete={handleDelete}
    />
  )
}

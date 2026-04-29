'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'

/**
 * Phase 11.1: 工作區水平 Tab Bar — 每集一個 tab
 *
 * - 點劇名 → 跳 dashboard (projectHref)
 * - 當前集高亮 + accent gradient underline
 * - 鍵盤左/右 navigate
 * - 尾端 sticky「+ 新建集」
 * - rename / delete confirm（複用 EpisodeSelector pattern）
 *
 * 不持有任何狀態以外的 UI logic（dropdown / drag-reorder / 進度顯示交給 dashboard）。
 */

export interface EpisodeTabItem {
  id: string
  title: string
  episodeNumber: number
  readyDot?: 'empty' | 'ready' | 'processing'
}

export interface EpisodeTabBarProps {
  projectName: string
  projectHref: string
  episodes: ReadonlyArray<EpisodeTabItem>
  currentId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRename?: (id: string, newName: string) => void
  onDelete?: (id: string) => void
}

export default function EpisodeTabBar({
  projectName,
  projectHref,
  episodes,
  currentId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: EpisodeTabBarProps) {
  const tc = useTranslations('common')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  const tabsRef = useRef<HTMLDivElement>(null)
  const currentIndex = episodes.findIndex((episode) => episode.id === currentId)

  // 切到目前集時，若 tab 在可視範圍外，scroll 入視窗
  useEffect(() => {
    const container = tabsRef.current
    if (!container) return
    const activeTab = container.querySelector<HTMLElement>(`[data-tab-id="${currentId}"]`)
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [currentId])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (episodes.length === 0) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const next = episodes[(currentIndex + 1) % episodes.length]
      if (next) onSelect(next.id)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const prev = episodes[(currentIndex - 1 + episodes.length) % episodes.length]
      if (prev) onSelect(prev.id)
    }
  }

  const submitRename = (id: string) => {
    const trimmed = editingName.trim()
    if (trimmed.length > 0 && onRename) {
      onRename(id, trimmed)
    }
    setEditingId(null)
  }

  const submitDelete = (id: string) => {
    if (onDelete) onDelete(id)
    setConfirmingDeleteId(null)
  }

  const dotClass = (dot: EpisodeTabItem['readyDot']): string => {
    if (dot === 'ready') return 'bg-[var(--glass-tone-success-fg)]'
    if (dot === 'processing') return 'bg-[var(--glass-accent-from)] animate-pulse'
    return 'bg-[var(--glass-stroke-strong)]'
  }

  return (
    <div
      className="fixed top-20 left-6 right-6 z-[60] flex items-stretch gap-3"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* 劇名連結（點 → 回 dashboard overview） */}
      <Link
        href={projectHref}
        className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2.5 rounded-2xl shrink-0 max-w-[220px]"
        title={projectName}
      >
        <AppIcon name="bookOpen" className="w-4 h-4 text-[var(--glass-tone-info-fg)] shrink-0" />
        <span className="text-sm font-bold text-[var(--glass-text-primary)] truncate">{projectName}</span>
      </Link>

      {/* Tab 列 */}
      <div
        ref={tabsRef}
        className="flex items-center gap-1 overflow-x-auto custom-scrollbar flex-1 min-w-0 px-2 py-1 rounded-2xl"
        style={{
          background: 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(24px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.45)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.06), 0 1.5px 6px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.7)',
        }}
      >
        {episodes.map((episode) => {
          const isActive = episode.id === currentId

          // 編輯模式
          if (editingId === episode.id) {
            return (
              <div
                key={episode.id}
                data-tab-id={episode.id}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-[var(--glass-tone-info-bg)] border border-[var(--glass-stroke-focus)] shrink-0"
              >
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      submitRename(episode.id)
                    } else if (e.key === 'Escape') {
                      setEditingId(null)
                    }
                  }}
                  className="px-2 py-1 text-sm rounded-lg border border-[var(--glass-stroke-focus)] focus:outline-none w-32"
                  autoFocus
                />
                <button
                  onClick={() => submitRename(episode.id)}
                  className="w-6 h-6 rounded-md bg-[var(--glass-accent-from)] text-white flex items-center justify-center"
                  title={tc('save')}
                >
                  <AppIcon name="check" className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="w-6 h-6 rounded-md bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] flex items-center justify-center"
                  title={tc('cancel')}
                >
                  <AppIcon name="close" className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          }

          // 刪除確認
          if (confirmingDeleteId === episode.id) {
            return (
              <div
                key={episode.id}
                data-tab-id={episode.id}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-[var(--glass-tone-danger-bg)] border border-[var(--glass-tone-danger-fg)]/30 shrink-0"
              >
                <span className="text-xs font-medium text-[var(--glass-tone-danger-fg)] truncate max-w-[120px]">
                  {tc('deleteEpisode')}: {episode.title}
                </span>
                <button
                  onClick={() => submitDelete(episode.id)}
                  className="px-2 py-1 rounded-md bg-[var(--glass-tone-danger-fg)] text-white text-xs"
                >
                  {tc('deleteEpisodeConfirm')}
                </button>
                <button
                  onClick={() => setConfirmingDeleteId(null)}
                  className="w-6 h-6 rounded-md bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] flex items-center justify-center"
                >
                  <AppIcon name="close" className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          }

          return (
            <div
              key={episode.id}
              data-tab-id={episode.id}
              className={`group relative flex items-center gap-2 px-3 py-2 rounded-xl transition-all shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
                  : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-muted)]'
              }`}
            >
              <button
                onClick={() => onSelect(episode.id)}
                className="flex items-center gap-2"
              >
                {episode.readyDot && (
                  <span className={`w-1.5 h-1.5 rounded-full ${dotClass(episode.readyDot)}`} />
                )}
                <span className="text-xs font-bold opacity-70">{episode.episodeNumber}</span>
                <span className="text-sm font-semibold max-w-[140px] truncate">{episode.title}</span>
              </button>

              {/* 操作按鈕（hover 顯示） */}
              {(onRename || onDelete) && (
                <div className="hidden group-hover:flex items-center gap-1 ml-1">
                  {onRename && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(episode.id)
                        setEditingName(episode.title)
                      }}
                      className="w-5 h-5 rounded-md hover:bg-[var(--glass-bg-surface-strong)] flex items-center justify-center text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)]"
                      title={tc('editEpisodeName')}
                    >
                      <AppIcon name="edit" className="w-3 h-3" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmingDeleteId(episode.id)
                      }}
                      className="w-5 h-5 rounded-md hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center text-[var(--glass-text-tertiary)] hover:text-[var(--glass-tone-danger-fg)]"
                      title={tc('deleteEpisode')}
                    >
                      <AppIcon name="trash" className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {/* Active underline */}
              {isActive && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] w-6 rounded-full bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)]"
                />
              )}
            </div>
          )
        })}
      </div>

      {/* + 新建集 sticky */}
      <button
        onClick={onAdd}
        className="glass-btn-base glass-btn-secondary flex items-center gap-1 px-3 py-2 rounded-2xl shrink-0 text-sm font-medium text-[var(--glass-tone-info-fg)]"
        title={tc('newEpisode')}
      >
        <AppIcon name="plus" className="w-4 h-4" />
        <span>{tc('newEpisode')}</span>
      </button>
    </div>
  )
}

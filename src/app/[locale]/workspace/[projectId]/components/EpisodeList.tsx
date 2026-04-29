'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { EpisodeProgress } from './episode-progress'

/**
 * Phase 11.1: 「劇 → 集」dashboard 集列表（純 presentational）
 *
 * - 不直接拉資料、不寫 URL、不寫 router；所有事件由父層處理。
 * - 卡片：縮圖 + 第 N 集 + 名稱 + 3 條 progress bar + rename / delete。
 * - 卡片 grid 結尾「+ 新增集」cell。
 */

export interface EpisodeWithProgress {
  id: string
  episodeNumber: number
  name: string
  description: string | null
  progress: EpisodeProgress
  thumbnailUrl: string | null
}

export interface EpisodeListProps {
  projectName: string
  episodes: ReadonlyArray<EpisodeWithProgress>
  characterCount: number
  locationCount: number
  onEpisodeOpen: (episodeId: string) => void
  onEpisodeCreate: () => void
  onEpisodeRename: (id: string, newName: string) => Promise<void>
  onEpisodeDelete: (id: string) => Promise<void>
  onOpenProjectSettings: () => void
}

interface ProgressBarProps {
  label: string
  done: number
  total: number
  notStartedLabel: string
}

function ProgressBar({ label, done, total, notStartedLabel }: ProgressBarProps) {
  const isEmpty = total === 0
  const percent = isEmpty ? 0 : Math.round((done / total) * 100)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--glass-text-secondary)] font-medium">{label}</span>
        <span className="text-[var(--glass-text-tertiary)]">
          {isEmpty ? notStartedLabel : `${done}/${total}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--glass-bg-muted)] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

interface EpisodeCardProps {
  episode: EpisodeWithProgress
  t: (key: string, values?: Record<string, string | number>) => string
  tc: (key: string) => string
  onOpen: () => void
  onRename: (newName: string) => Promise<void>
  onDelete: () => Promise<void>
}

function EpisodeCard({ episode, t, tc, onOpen, onRename, onDelete }: EpisodeCardProps) {
  const [editingName, setEditingName] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleRenameSubmit = async () => {
    if (editingName === null) return
    const trimmed = editingName.trim()
    if (trimmed.length === 0) {
      setEditingName(null)
      return
    }
    if (trimmed !== episode.name) {
      await onRename(trimmed)
    }
    setEditingName(null)
  }

  const handleDeleteConfirm = async () => {
    await onDelete()
    setConfirmingDelete(false)
  }

  return (
    <div className="glass-surface rounded-2xl overflow-hidden flex flex-col group transition-all duration-200 hover:shadow-lg">
      {/* Thumbnail */}
      <button
        type="button"
        onClick={onOpen}
        className="block w-full aspect-video relative bg-[var(--glass-bg-muted)] overflow-hidden"
      >
        {episode.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={episode.thumbnailUrl}
            alt={episode.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[var(--glass-accent-from)]/20 to-[var(--glass-accent-to)]/20 flex items-center justify-center">
            <AppIcon name="film" className="w-10 h-10 text-[var(--glass-text-tertiary)]" />
          </div>
        )}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur text-white text-xs font-semibold">
          {tc('episode')} {episode.episodeNumber}
        </div>
      </button>

      {/* Body */}
      <div className="flex-1 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2">
          {editingName !== null ? (
            <div className="flex-1 flex items-center gap-1">
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleRenameSubmit()
                  } else if (e.key === 'Escape') {
                    setEditingName(null)
                  }
                }}
                className="flex-1 px-2 py-1 text-sm rounded-lg border border-[var(--glass-stroke-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--glass-focus-ring-strong)]"
                autoFocus
              />
              <button
                onClick={() => void handleRenameSubmit()}
                className="w-7 h-7 rounded-lg bg-[var(--glass-accent-from)] text-white hover:bg-[var(--glass-accent-to)] flex items-center justify-center"
                title={tc('save')}
              >
                <AppIcon name="check" className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditingName(null)}
                className="w-7 h-7 rounded-lg bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)] flex items-center justify-center"
                title={tc('cancel')}
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpen}
              className="flex-1 text-left font-semibold text-[var(--glass-text-primary)] line-clamp-1 hover:text-[var(--glass-tone-info-fg)] transition-colors"
            >
              {episode.name}
            </button>
          )}

          {editingName === null && !confirmingDelete && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingName(episode.name)
                }}
                className="w-7 h-7 rounded-lg hover:bg-[var(--glass-bg-muted)] flex items-center justify-center text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)]"
                title={tc('editEpisodeName')}
              >
                <AppIcon name="edit" className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmingDelete(true)
                }}
                className="w-7 h-7 rounded-lg hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center text-[var(--glass-text-tertiary)] hover:text-[var(--glass-tone-danger-fg)]"
                title={tc('deleteEpisode')}
              >
                <AppIcon name="trash" className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {confirmingDelete && (
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-[var(--glass-tone-danger-bg)] border border-[var(--glass-tone-danger-fg)]/30 text-xs">
            <span className="flex-1 text-[var(--glass-tone-danger-fg)] font-medium truncate">
              {tc('deleteEpisode')}: {episode.name}
            </span>
            <button
              onClick={() => void handleDeleteConfirm()}
              className="px-2 py-1 rounded-md bg-[var(--glass-tone-danger-fg)] text-white font-medium"
            >
              {tc('deleteEpisodeConfirm')}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="w-6 h-6 rounded-md bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] flex items-center justify-center"
            >
              <AppIcon name="close" className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Progress bars */}
        <div className="space-y-2 pt-1">
          <ProgressBar
            label={t('progressScript')}
            done={episode.progress.scriptDone}
            total={episode.progress.scriptTotal}
            notStartedLabel={t('progressNotStarted')}
          />
          <ProgressBar
            label={t('progressStoryboard')}
            done={episode.progress.storyboardDone}
            total={episode.progress.storyboardTotal}
            notStartedLabel={t('progressNotStarted')}
          />
          <ProgressBar
            label={t('progressVideo')}
            done={episode.progress.videoDone}
            total={episode.progress.videoTotal}
            notStartedLabel={t('progressNotStarted')}
          />
        </div>
      </div>
    </div>
  )
}

export default function EpisodeList({
  projectName,
  episodes,
  characterCount,
  locationCount,
  onEpisodeOpen,
  onEpisodeCreate,
  onEpisodeRename,
  onEpisodeDelete,
  onOpenProjectSettings,
}: EpisodeListProps) {
  const t = useTranslations('workspaceDetail')
  const tc = useTranslations('common')

  return (
    <section className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[var(--glass-text-primary)]">{projectName}</h1>
          <p className="text-sm text-[var(--glass-text-secondary)]">{t('overviewTitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1 rounded-full bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] text-xs font-semibold">
            {t('episodeCountLabel', { count: episodes.length })}
          </span>
          <span className="px-3 py-1 rounded-full bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] text-xs font-semibold">
            {t('characterCountLabel', { count: characterCount })}
          </span>
          <span className="px-3 py-1 rounded-full bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] text-xs font-semibold">
            {t('locationCountLabel', { count: locationCount })}
          </span>
          <button
            onClick={onOpenProjectSettings}
            className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-3 py-1.5 text-sm"
          >
            <AppIcon name="settingsHex" className="w-4 h-4" />
            {t('projectSettings')}
          </button>
        </div>
      </header>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {episodes.map((episode) => (
          <EpisodeCard
            key={episode.id}
            episode={episode}
            t={(key, values) => t(key, values)}
            tc={(key) => tc(key)}
            onOpen={() => onEpisodeOpen(episode.id)}
            onRename={(newName) => onEpisodeRename(episode.id, newName)}
            onDelete={() => onEpisodeDelete(episode.id)}
          />
        ))}

        {/* Add card */}
        <button
          onClick={onEpisodeCreate}
          className="glass-surface-soft min-h-[280px] rounded-2xl border-2 border-dashed border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)] hover:bg-[var(--glass-tone-info-bg)] transition-colors flex flex-col items-center justify-center gap-2 text-[var(--glass-text-tertiary)] hover:text-[var(--glass-tone-info-fg)]"
        >
          <AppIcon name="plus" className="w-10 h-10" />
          <span className="text-sm font-medium">{t('addEpisode')}</span>
        </button>
      </div>
    </section>
  )
}

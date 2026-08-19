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
 *  - Double-click or F2 → inline rename → PATCH /episodes/[id]
 *  - Delete control → confirm + DELETE /episodes/[id]
 *  - Refuses to delete the last remaining episode
 *  - Keyboard ←/→/Home/End moves selection and focus between tabs
 *  - Viewer access keeps navigation readable while hiding mutations
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useCurrentEpisode } from './hooks/useCurrentEpisode'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { queryKeys } from '@/lib/query/keys'

interface V2EpisodeTabBarProps {
  projectId: string
  locale: string
  projectName?: string
  tone?: 'darkroom' | 'paper'
}

export function V2EpisodeTabBar({
  projectId,
  locale,
  projectName,
  tone = 'darkroom',
}: V2EpisodeTabBarProps) {
  const t = useTranslations('v2Script.episodes')
  const queryClient = useQueryClient()
  const { episodes, currentEpisodeId, setCurrentEpisode } = useCurrentEpisode(projectId)
  const { canEdit } = useProjectAccess(projectId)
  const [busy, setBusy] = useState<'add' | 'rename' | 'delete' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [addOutcomeUnknown, setAddOutcomeUnknown] = useState(false)
  const addBaselineIdsRef = useRef(new Set<string>())
  const focusAfterEditingIdRef = useRef<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const paper = tone === 'paper'

  const refreshProject = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
  }, [queryClient, projectId])

  // Auto-scroll the active tab into view when the URL switches.
  useEffect(() => {
    if (!currentEpisodeId) return
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-tab-id="${currentEpisodeId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [currentEpisodeId])

  useEffect(() => {
    if (!canEdit) setEditingId(null)
  }, [canEdit])

  useEffect(() => {
    if (editingId !== null || !focusAfterEditingIdRef.current) return
    const episodeId = focusAfterEditingIdRef.current
    focusAfterEditingIdRef.current = null
    tabButtonRefs.current.get(episodeId)?.focus()
  }, [editingId])

  useEffect(() => {
    if (!addOutcomeUnknown) return
    const discovered = episodes.filter((episode) => !addBaselineIdsRef.current.has(episode.id))
    if (discovered.length !== 1 || !discovered[0]) return
    setCurrentEpisode(discovered[0].id)
    setAddOutcomeUnknown(false)
    setErrorMessage(null)
  }, [addOutcomeUnknown, episodes, setCurrentEpisode])

  const handleAdd = useCallback(async () => {
    if (busy || !canEdit || addOutcomeUnknown) return
    addBaselineIdsRef.current = new Set(episodes.map((episode) => episode.id))
    setBusy('add')
    setErrorMessage(null)
    try {
      const nextNumber = episodes.length + 1
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t('defaultName', { number: nextNumber }) }),
      })
      if (!res.ok) {
        if (res.status >= 500) {
          // This route creates the episode before a later project update.
          // A 5xx can therefore arrive after the episode committed; reposting
          // could create a duplicate.
          setAddOutcomeUnknown(true)
          setErrorMessage(t('errorAddOutcomeUnknown'))
        } else {
          setErrorMessage(t('errorAdd'))
        }
        return
      }
      let json: { episode?: { id?: string } }
      try {
        json = (await res.json()) as { episode?: { id?: string } }
      } catch {
        setAddOutcomeUnknown(true)
        setErrorMessage(t('errorAddOutcomeUnknown'))
        return
      }
      const newId = json.episode?.id ?? null
      if (!newId) {
        setAddOutcomeUnknown(true)
        setErrorMessage(t('errorAddOutcomeUnknown'))
        await refreshProject()
        return
      }
      await refreshProject()
      setCurrentEpisode(newId)
    } catch {
      setAddOutcomeUnknown(true)
      setErrorMessage(t('errorAddOutcomeUnknown'))
    } finally {
      setBusy(null)
    }
  }, [addOutcomeUnknown, busy, canEdit, episodes, projectId, refreshProject, setCurrentEpisode, t])

  const submitRename = useCallback(
    async (id: string, restoreFocus = false) => {
      const trimmed = editingName.trim()
      if (!trimmed || busy || !canEdit) {
        if (restoreFocus) focusAfterEditingIdRef.current = id
        setEditingId(null)
        return
      }
      setBusy('rename')
      setErrorMessage(null)
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        })
        if (!res.ok) {
          setErrorMessage(t('errorRename'))
          return
        }
        await refreshProject()
      } catch {
        setErrorMessage(t('errorRename'))
      } finally {
        if (restoreFocus) focusAfterEditingIdRef.current = id
        setBusy(null)
        setEditingId(null)
      }
    },
    [busy, canEdit, editingName, projectId, refreshProject, t],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (busy || !canEdit) return
      if (episodes.length <= 1) {
        setErrorMessage(t('deleteLast'))
        return
      }
      const target = episodes.find((ep) => ep.id === id)
      const targetName = target?.name ?? t('defaultName', { number: 1 })
      const ok = confirm(t('deleteConfirm', { name: targetName }))
      if (!ok) return
      setBusy('delete')
      setErrorMessage(null)
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${id}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          setErrorMessage(t('errorDelete'))
          return
        }
        if (id === currentEpisodeId) {
          const remaining = episodes.filter((ep) => ep.id !== id)
          if (remaining[0]) setCurrentEpisode(remaining[0].id)
        }
        await refreshProject()
      } catch {
        setErrorMessage(t('errorDelete'))
      } finally {
        setBusy(null)
      }
    },
    [busy, canEdit, currentEpisodeId, episodes, projectId, refreshProject, setCurrentEpisode, t],
  )

  const selectAndFocusEpisode = useCallback((episodeId: string) => {
    setCurrentEpisode(episodeId)
    tabButtonRefs.current.get(episodeId)?.focus()
  }, [setCurrentEpisode])

  const handleCheckAddOutcome = useCallback(async () => {
    if (busy) return
    setBusy('add')
    try {
      await refreshProject()
    } finally {
      setBusy(null)
    }
  }, [busy, refreshProject])

  const handleTabKeyDown = useCallback((
    event: KeyboardEvent<HTMLButtonElement>,
    episodeId: string,
  ) => {
    if (episodes.length === 0 || editingId) return
    const index = episodes.findIndex((episode) => episode.id === episodeId)
    if (index < 0) return

    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % episodes.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + episodes.length) % episodes.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = episodes.length - 1
    } else if (event.key === 'F2' && canEdit) {
      event.preventDefault()
      const episode = episodes[index]
      if (episode) {
        setEditingId(episode.id)
        setEditingName(episode.name)
      }
      return
    }

    if (nextIndex === null) return
    event.preventDefault()
    const nextEpisode = episodes[nextIndex]
    if (nextEpisode) selectAndFocusEpisode(nextEpisode.id)
  }, [canEdit, editingId, episodes, selectAndFocusEpisode])

  // Render even with 0 episodes — show just the "+ 新建劇集" button so the
  // user has a clear entry point before any episode exists. ScriptPage's
  // own "儲存" still auto-creates the first episode on its own as a safety
  // net for users who skip the tab bar and start typing directly.
  return (
    <>
      <div
        className={paper
          ? 'flex items-stretch gap-2 border-b border-[var(--production-border)] bg-[var(--production-surface)] px-[var(--workspace-gutter)] py-3 text-[var(--production-ink)]'
          : 'flex items-stretch gap-2 border-b border-border-soft bg-canvas/95 px-[var(--workspace-gutter)] py-3 backdrop-blur-xl'}
      >
        {/* Project name link → home overview.
            `?stay=1` opt-out keeps sticky-step from bouncing this back
            to last-step (page.tsx 2026-05-13 fix). */}
        <Link
          href={`/${locale}/v2/workspace/${projectId}?stay=1`}
          title={t('projectHome')}
          className={paper
            ? 'hidden min-h-11 shrink-0 items-center gap-2 rounded-[10px] border border-[var(--production-border)] bg-[var(--production-surface)] px-3 text-[14px] text-[var(--production-ink-muted)] transition-colors hover:border-[var(--production-border-dark)] hover:text-[var(--production-ink)] motion-reduce:transition-none sm:flex'
            : 'hidden min-h-11 shrink-0 items-center gap-2 rounded-input border border-border-soft bg-raised px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary sm:flex'}
        >
          <AppIcon name="bookOpen" className="h-4 w-4" />
          <span className="max-w-[160px] truncate">{projectName ?? t('projectHome')}</span>
        </Link>

        {/* Episode tabs (scrollable) */}
        <div
          ref={tabsRef}
          role="tablist"
          aria-label={t('navigationLabel')}
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
                className={paper
                  ? 'flex min-h-11 shrink-0 items-center gap-1 rounded-[10px] border border-[var(--production-blue)] bg-[var(--production-blue-soft)] px-2'
                  : 'flex shrink-0 items-center gap-1 rounded-input border border-primary-500/50 bg-primary-500/10 px-2 py-1.5'}
              >
                <input
                  type="text"
                  aria-label={t('renameLabel', { name: episode.name })}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename(episode.id, true)
                    else if (e.key === 'Escape') {
                      focusAfterEditingIdRef.current = episode.id
                      setEditingId(null)
                    }
                  }}
                  onBlur={() => void submitRename(episode.id)}
                  autoFocus
                  className={paper
                    ? 'min-h-11 w-28 bg-transparent text-[14px] text-[var(--production-ink)] outline-none'
                    : 'min-h-11 w-28 bg-transparent text-sm text-text-primary outline-none'}
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
                ref={(element) => {
                  if (element) tabButtonRefs.current.set(episode.id, element)
                  else tabButtonRefs.current.delete(episode.id)
                }}
                type="button"
                onClick={() => setCurrentEpisode(episode.id)}
                onDoubleClick={() => {
                  if (!canEdit) return
                  setEditingId(episode.id)
                  setEditingName(episode.name)
                }}
                onKeyDown={(event) => handleTabKeyDown(event, episode.id)}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`${episode.name}${isActive ? ` · ${t('selected')}` : ''}`}
                className={[
                  'flex min-h-11 items-center gap-1.5 border px-3 font-serif-cn text-[14px] transition-colors motion-reduce:transition-none',
                  paper ? 'rounded-[10px]' : 'rounded-sm',
                  paper
                    ? isActive
                      ? 'border-[var(--process-cyan)] bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                      : 'border-[var(--production-border)] bg-[var(--production-surface)] text-[var(--production-ink-muted)] hover:border-[var(--production-border-dark)] hover:text-[var(--production-ink)]'
                    : isActive
                      ? 'border-primary-500/50 bg-primary-500/10 text-primary-300'
                      : 'border-border-soft bg-raised/60 text-text-secondary hover:border-border-strong hover:text-text-primary',
                ].join(' ')}
                title={canEdit ? t('renameHint') : episode.name}
              >
                <span className={[
                  'font-mono text-[13px]',
                  paper
                    ? isActive ? 'text-[var(--process-cyan-strong)]' : 'text-[var(--production-ink-muted)]'
                    : isActive ? 'text-primary-400' : 'text-text-tertiary',
                ].join(' ')}>
                  {String(episode.episodeNumber).padStart(2, '0')}
                </span>
                <span>{episode.name}</span>
              </button>
              {/* Delete (×) — visible on touch, revealed on hover/focus with a mouse. */}
              {canEdit && episodes.length > 1 ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(episode.id)}
                  aria-label={t('delete', { name: episode.name })}
                  className="absolute -right-3 -top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full opacity-100 transition-opacity motion-reduce:transition-none sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  title={t('delete', { name: episode.name })}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      'flex h-5 w-5 items-center justify-center rounded-full border text-[14px] transition-colors motion-reduce:transition-none',
                      paper
                        ? 'border-[var(--production-border-dark)] bg-[var(--production-surface)] text-[var(--production-ink-muted)] shadow-sm hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700'
                        : 'border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] text-[var(--darkroom-muted)] hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-300',
                    ].join(' ')}
                  >
                    ×
                  </span>
                </button>
              ) : null}
            </div>
          )
          })}
        </div>

        {canEdit ? (
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={busy === 'add' || addOutcomeUnknown}
            className={paper
              ? 'kuiper-dashboard-secondary flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-[14px] font-semibold text-[var(--process-cyan-strong)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'
              : 'flex min-h-11 shrink-0 items-center gap-1.5 rounded-input border border-primary-500/40 bg-primary-500/5 px-3 py-1.5 text-sm text-primary-400 transition-colors hover:border-primary-500/60 hover:bg-primary-500/15 hover:text-primary-300 disabled:cursor-not-allowed disabled:opacity-50'}
          >
            <AppIcon name="plus" className="h-3.5 w-3.5" />
            <span>{busy === 'add' ? t('adding') : t('add')}</span>
          </button>
        ) : null}
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-rose-400/35 bg-rose-400/10 px-[var(--workspace-gutter)] py-2 text-[13px] text-[var(--production-danger)]"
        >
          <span>{errorMessage}</span>
          {addOutcomeUnknown ? (
            <button
              type="button"
              onClick={() => void handleCheckAddOutcome()}
              disabled={busy === 'add'}
              className="min-h-11 rounded-[9px] px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:opacity-50"
            >
              {busy === 'add' ? t('checkingAddOutcome') : t('checkAddOutcome')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="min-h-11 rounded-[9px] px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
            >
              {t('dismissError')}
            </button>
          )}
        </div>
      ) : null}
    </>
  )
}

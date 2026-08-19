'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'

export type ScreenplaySaveIssueKind =
  | 'offline'
  | 'network'
  | 'session'
  | 'access'
  | 'create-unknown'
  | 'server'

export interface ScreenplaySaveIssue {
  kind: ScreenplaySaveIssueKind
  status?: number
}

interface DraftEntry {
  value: string
  serverText: string
  saving: boolean
  issue: ScreenplaySaveIssue | null
}

interface UseScreenplayDraftControllerInput {
  projectId: string
  episodeId: string | null
  sourceText: string | null | undefined
  canEdit: boolean
}

export interface ScreenplayDraftSnapshot {
  sourceKey: string
  episodeId: string | null
  value: string
}

export interface ScreenplaySaveResult {
  ok: boolean
  issue?: ScreenplaySaveIssue
}

const NEW_EPISODE_KEY = '__new_episode__'

function createDraft(serverText: string): DraftEntry {
  return {
    value: serverText,
    serverText,
    saving: false,
    issue: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Patch the exact episode without inventing missing project or episode data. */
function patchEpisodeText(cache: unknown, episodeId: string, novelText: string): unknown {
  if (!isRecord(cache) || !isRecord(cache.novelPromotionData)) return cache
  const novelPromotionData = cache.novelPromotionData
  if (!Array.isArray(novelPromotionData.episodes)) return cache

  let found = false
  const episodes = novelPromotionData.episodes.map((episode) => {
    if (!isRecord(episode) || episode.id !== episodeId) return episode
    found = true
    return { ...episode, novelText }
  })
  if (!found) return cache

  return {
    ...cache,
    novelPromotionData: {
      ...novelPromotionData,
      episodes,
    },
  }
}

function responseIssue(status: number): ScreenplaySaveIssue {
  if (status === 401) return { kind: 'session', status }
  if (status === 403) return { kind: 'access', status }
  return { kind: 'server', status }
}

function isPersistentBlockingIssue(issue: ScreenplaySaveIssue | null): boolean {
  return issue?.kind === 'session' || issue?.kind === 'access' || issue?.kind === 'create-unknown'
}

/**
 * Episode-scoped screenplay drafts.
 *
 * A save response only updates the episode/key that initiated it. The current
 * editor can therefore switch episodes while a request is in flight without a
 * late response changing the newly selected episode's baseline or status.
 */
export function useScreenplayDraftController({
  projectId,
  episodeId,
  sourceText,
  canEdit,
}: UseScreenplayDraftControllerInput) {
  const queryClient = useQueryClient()
  const currentKey = episodeId ?? NEW_EPISODE_KEY
  const normalizedSource = sourceText ?? ''
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({})
  const draftsRef = useRef(drafts)
  const currentKeyRef = useRef(currentKey)
  const currentValueRef = useRef(normalizedSource)
  const inFlightRef = useRef(new Map<string, number>())
  const requestSequenceRef = useRef(0)

  const updateDrafts = useCallback((updater: (previous: Record<string, DraftEntry>) => Record<string, DraftEntry>) => {
    setDrafts((previous) => {
      const next = updater(previous)
      draftsRef.current = next
      return next
    })
  }, [])

  const currentDraft = drafts[currentKey] ?? createDraft(normalizedSource)
  currentKeyRef.current = currentKey
  currentValueRef.current = currentDraft.value

  // Adopt a newer server snapshot only when this episode has no local work.
  useEffect(() => {
    updateDrafts((previous) => {
      const existing = previous[currentKey]
      if (!existing) {
        return { ...previous, [currentKey]: createDraft(normalizedSource) }
      }
      if (
        existing.saving
        || existing.issue
        || existing.value !== existing.serverText
        || existing.serverText === normalizedSource
      ) {
        return previous
      }
      return { ...previous, [currentKey]: createDraft(normalizedSource) }
    })
  }, [currentKey, normalizedSource, updateDrafts])

  const setValue = useCallback((value: string) => {
    const key = currentKeyRef.current
    updateDrafts((previous) => {
      const existing = previous[key] ?? createDraft(key === currentKey ? normalizedSource : '')
      return {
        ...previous,
        [key]: {
          ...existing,
          value,
          // Typing is not proof that an expired session or revoked role has
          // recovered. Keep those issues visible until an explicit recheck.
          issue: isPersistentBlockingIssue(existing.issue) ? existing.issue : null,
        },
      }
    })
  }, [currentKey, normalizedSource, updateDrafts])

  const captureSnapshot = useCallback((): ScreenplayDraftSnapshot => ({
    sourceKey: currentKeyRef.current,
    episodeId: currentKeyRef.current === NEW_EPISODE_KEY ? null : currentKeyRef.current,
    value: currentValueRef.current,
  }), [])

  const captureSnapshotForEpisode = useCallback((targetEpisodeId: string): ScreenplayDraftSnapshot | null => {
    const target = draftsRef.current[targetEpisodeId]
    if (!target) return null
    return {
      sourceKey: targetEpisodeId,
      episodeId: targetEpisodeId,
      value: target.value,
    }
  }, [])

  const reportIssue = useCallback((
    issue: ScreenplaySaveIssue,
    captured?: ScreenplayDraftSnapshot,
  ) => {
    const key = captured?.sourceKey ?? currentKeyRef.current
    const fallbackValue = captured?.value ?? currentValueRef.current
    updateDrafts((previous) => {
      const existing = previous[key] ?? createDraft(fallbackValue)
      return {
        ...previous,
        [key]: { ...existing, saving: false, issue },
      }
    })
  }, [updateDrafts])

  const adoptSnapshotForEpisode = useCallback((
    targetEpisodeId: string,
    captured: ScreenplayDraftSnapshot,
  ) => {
    updateDrafts((previous) => {
      const target = previous[targetEpisodeId] ?? createDraft('')
      return {
        ...previous,
        [targetEpisodeId]: {
          ...target,
          value: captured.value,
          saving: false,
          issue: null,
        },
      }
    })
  }, [updateDrafts])

  const saveToEpisode = useCallback(async (
    targetEpisodeId: string,
    captured?: ScreenplayDraftSnapshot,
    verifiedIssue?: 'session' | 'access' | 'create-unknown',
  ): Promise<ScreenplaySaveResult> => {
    if (!canEdit || inFlightRef.current.has(targetEpisodeId)) return { ok: false }

    const sourceKey = captured?.sourceKey ?? currentKeyRef.current
    const existingSource = draftsRef.current[sourceKey]
    const existingTarget = draftsRef.current[targetEpisodeId]
    const sourceIssue = existingSource?.issue ?? null
    const targetIssue = existingTarget?.issue ?? null
    const blockingIssue = [sourceIssue, targetIssue].find((issue) => (
      isPersistentBlockingIssue(issue) && issue?.kind !== verifiedIssue
    ))
    if (blockingIssue) {
      return { ok: false, issue: blockingIssue }
    }
    const snapshot = captured?.value ?? currentValueRef.current
    const targetKeys = Array.from(new Set([sourceKey, targetEpisodeId]))

    const markIssue = (issue: ScreenplaySaveIssue) => {
      updateDrafts((previous) => {
        const next = { ...previous }
        for (const key of targetKeys) {
          const existing = next[key] ?? createDraft(snapshot)
          next[key] = { ...existing, saving: false, issue }
        }
        return next
      })
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const issue: ScreenplaySaveIssue = { kind: 'offline' }
      markIssue(issue)
      return { ok: false, issue }
    }

    const requestId = ++requestSequenceRef.current
    inFlightRef.current.set(targetEpisodeId, requestId)
    updateDrafts((previous) => {
      const next = { ...previous }
      for (const key of targetKeys) {
        const existing = next[key] ?? createDraft(snapshot)
        next[key] = { ...existing, saving: true, issue: null }
      }
      return next
    })

    try {
      const response = await fetch(
        `/api/novel-promotion/${projectId}/episodes/${targetEpisodeId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ novelText: snapshot }),
        },
      )
      if (!response.ok) {
        const issue = responseIssue(response.status)
        markIssue(issue)
        return { ok: false, issue }
      }

      // Ignore any superseded response for the same target episode.
      if (inFlightRef.current.get(targetEpisodeId) !== requestId) return { ok: false }

      updateDrafts((previous) => {
        const next = { ...previous }
        for (const key of targetKeys) {
          const existing = next[key] ?? createDraft(snapshot)
          next[key] = {
            ...existing,
            serverText: snapshot,
            saving: false,
            issue: null,
          }
        }
        return next
      })
      queryClient.setQueryData(
        queryKeys.projectData(projectId),
        (cache: unknown) => patchEpisodeText(cache, targetEpisodeId, snapshot),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
      return { ok: true }
    } catch {
      const issue: ScreenplaySaveIssue = {
        kind: typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'offline'
          : 'network',
      }
      markIssue(issue)
      return { ok: false, issue }
    } finally {
      if (inFlightRef.current.get(targetEpisodeId) === requestId) {
        inFlightRef.current.delete(targetEpisodeId)
      }
    }
  }, [canEdit, projectId, queryClient, updateDrafts])

  const clearBlockingIssue = useCallback((verifiedKind: 'session' | 'access' | 'create-unknown') => {
    if (!canEdit) return
    updateDrafts((previous) => {
      let changed = false
      const next = { ...previous }
      for (const [key, existing] of Object.entries(previous)) {
        if (existing.issue?.kind !== verifiedKind) continue
        next[key] = { ...existing, issue: null }
        changed = true
      }
      return changed ? next : previous
    })
  }, [canEdit, updateDrafts])

  const isDirty = currentDraft.value !== currentDraft.serverText
  const isBlocked = isPersistentBlockingIssue(currentDraft.issue)
  const exactSaved = Boolean(
    episodeId
    && !currentDraft.saving
    && !currentDraft.issue
    && !isDirty,
  )

  return {
    value: currentDraft.value,
    setValue,
    isDirty,
    isSaving: currentDraft.saving,
    issue: currentDraft.issue,
    exactSaved,
    canSave: canEdit && !currentDraft.saving && !isBlocked && isDirty,
    captureSnapshot,
    captureSnapshotForEpisode,
    adoptSnapshotForEpisode,
    reportIssue,
    saveToEpisode,
    clearBlockingIssue,
  }
}

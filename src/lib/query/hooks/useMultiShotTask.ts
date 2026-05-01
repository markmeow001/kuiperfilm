'use client'

import { useQuery, type Query } from '@tanstack/react-query'

/**
 * Stage 1 chip-rail consumer.
 *
 * Fetches a single task record (`/api/tasks/[taskId]`) and surfaces
 * `task.result.bindings` for the multi-shot video B-path. Polls every
 * 3s until terminal status, then stops.
 *
 * The bindings payload is produced by the worker
 * (`multi-shot-video-b-path.ts`) and contains the entity references
 * Tencent SubjectInfos.N actually anchored against — i.e. the truth
 * of "which appearance / which view did this video use." Surfacing
 * it lets the UI render Seedance-style chips instead of a blind
 * "請信我" video player.
 *
 * Contract reference: project_kuiperfilm_b_path_bindings_api.md
 */

export interface MultiShotCharacterBinding {
  id: string
  name: string
  appearanceId: string | null
  appearanceLabel: string | null
  imageUrl: string
}

export interface MultiShotSceneBinding {
  id: string
  name: string
  viewName: string | null
  imageUrl: string
}

export interface MultiShotBindings {
  characters: MultiShotCharacterBinding[]
  scenes: MultiShotSceneBinding[]
}

export interface MultiShotTaskRecord {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  progress?: number | null
  result?: {
    bindings?: MultiShotBindings | null
    multiShotVideoUrl?: string | null
    storyboardId?: string | null
    shotCount?: number | null
    subjectCount?: number | null
    multiShotMode?: string | null
  } | null
  error?: { code: string; message: string } | null
  errorMessage?: string | null
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function parseBindings(raw: unknown): MultiShotBindings | null {
  if (!isRecord(raw)) return null
  const result = isRecord(raw.result) ? raw.result : null
  if (!result) return null
  const b = isRecord(result.bindings) ? result.bindings : null
  if (!b) return null
  const charactersRaw = Array.isArray(b.characters) ? b.characters : []
  const scenesRaw = Array.isArray(b.scenes) ? b.scenes : []
  const characters: MultiShotCharacterBinding[] = []
  for (const item of charactersRaw) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.imageUrl !== 'string') continue
    characters.push({
      id: item.id,
      name: item.name,
      appearanceId: typeof item.appearanceId === 'string' ? item.appearanceId : null,
      appearanceLabel: typeof item.appearanceLabel === 'string' ? item.appearanceLabel : null,
      imageUrl: item.imageUrl,
    })
  }
  const scenes: MultiShotSceneBinding[] = []
  for (const item of scenesRaw) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.imageUrl !== 'string') continue
    scenes.push({
      id: item.id,
      name: item.name,
      viewName: typeof item.viewName === 'string' ? item.viewName : null,
      imageUrl: item.imageUrl,
    })
  }
  return { characters, scenes }
}

export function useMultiShotTask(taskId: string | null | undefined) {
  return useQuery({
    queryKey: ['multi-shot-task', taskId ?? ''] as const,
    enabled: !!taskId,
    staleTime: 1500,
    refetchInterval: (query: Query<MultiShotTaskRecord | null>) => {
      const data = query.state.data
      if (!data) return 3000
      if (TERMINAL.has(data.status)) return false
      return 3000
    },
    queryFn: async (): Promise<MultiShotTaskRecord | null> => {
      if (!taskId) return null
      const res = await fetch(`/api/tasks/${taskId}`)
      if (!res.ok) {
        if (res.status === 404) return null
        throw new Error(`Failed to load multi-shot task ${taskId}`)
      }
      const json = (await res.json()) as { task?: unknown }
      if (!isRecord(json) || !isRecord(json.task)) return null
      const t = json.task
      return {
        id: typeof t.id === 'string' ? t.id : taskId,
        status: typeof t.status === 'string' ? t.status : 'unknown',
        progress: typeof t.progress === 'number' ? t.progress : null,
        result: isRecord(t.result)
          ? {
              bindings: parseBindings(t),
              multiShotVideoUrl:
                typeof t.result.multiShotVideoUrl === 'string' ? t.result.multiShotVideoUrl : null,
              storyboardId:
                typeof t.result.storyboardId === 'string' ? t.result.storyboardId : null,
              shotCount: typeof t.result.shotCount === 'number' ? t.result.shotCount : null,
              subjectCount:
                typeof t.result.subjectCount === 'number' ? t.result.subjectCount : null,
              multiShotMode:
                typeof t.result.multiShotMode === 'string' ? t.result.multiShotMode : null,
            }
          : null,
        error: isRecord(t.error)
          ? {
              code: typeof t.error.code === 'string' ? t.error.code : 'UNKNOWN',
              message: typeof t.error.message === 'string' ? t.error.message : '',
            }
          : null,
        errorMessage: typeof t.errorMessage === 'string' ? t.errorMessage : null,
      }
    },
  })
}

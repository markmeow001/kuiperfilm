'use client'

import { useEffect, useRef, useState } from 'react'
import { requestJsonWithError } from '@/lib/query/mutations/mutation-shared'
import { waitForTaskResult } from '@/lib/task/client'
import type { Locale } from '@/i18n/routing'
import {
  DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS,
  DEPTH_SCENE_DESCRIPTION_MAX_CHARS,
} from './lib/depth-rebuild-workflow'

type DescriptionAssistKind = 'character' | 'scene'

interface UseDepthRebuildDescriptionAssistOptions {
  locale: Locale
  scopeKey: string
  onError: (message: string | null) => void
}

interface SubmitTextTaskResponse {
  taskId?: string
}

interface PendingDescriptionAssist {
  kind: DescriptionAssistKind
  brief: string
  requestKey: string
  taskId?: string
}

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === 'AbortError'
}

function pendingStorageKey(scopeKey: string, targetId: string): string {
  return `kuiper:depth-description-assist:${encodeURIComponent(scopeKey)}:${encodeURIComponent(targetId)}`
}

function readPendingAssist(key: string): PendingDescriptionAssist | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      (parsed.kind !== 'character' && parsed.kind !== 'scene')
      || typeof parsed.brief !== 'string'
      || typeof parsed.requestKey !== 'string'
      || (parsed.taskId !== undefined && typeof parsed.taskId !== 'string')
    ) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return {
      kind: parsed.kind,
      brief: parsed.brief,
      requestKey: parsed.requestKey,
      ...(typeof parsed.taskId === 'string' ? { taskId: parsed.taskId } : {}),
    }
  } catch {
    return null
  }
}

function writePendingAssist(key: string, pending: PendingDescriptionAssist): boolean {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(pending))
    return true
  } catch {
    return false
  }
}

function clearPendingAssist(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // Storage cleanup is best-effort only.
  }
}

type DescriptionAssistTaskDisposition =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'missing'
  | 'unknown'

async function readTaskDisposition(taskId: string): Promise<DescriptionAssistTaskDisposition> {
  try {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: 'GET',
      cache: 'no-store',
    })
    if (response.status === 404) return 'missing'
    if (!response.ok) return 'unknown'
    const payload = (await response.json()) as {
      task?: { status?: unknown } | null
    }
    const status = payload.task?.status
    if (
      status === 'queued'
      || status === 'processing'
      || status === 'completed'
      || status === 'failed'
    ) {
      return status
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export function useDepthRebuildDescriptionAssist({
  locale,
  scopeKey,
  onError,
}: UseDepthRebuildDescriptionAssistOptions) {
  const [target, setTarget] = useState<string | null>(null)
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    abortRef.current?.abort()
  }, [])

  async function assist(
    kind: DescriptionAssistKind,
    targetId: string,
    brief: string,
  ): Promise<string | null> {
    const text = brief.trim()
    if (!text) {
      onError(kind === 'character' ? '請先寫幾句角色構想' : '請先寫幾句場景構想')
      return null
    }
    if (inFlightRef.current) {
      onError('已有一項 AI 描述補全正在進行')
      return null
    }

    const abortController = new AbortController()
    abortRef.current = abortController
    inFlightRef.current = true
    setTarget(targetId)
    onError(null)
    const storageKey = pendingStorageKey(scopeKey, targetId)
    let taskId: string | null = null
    try {
      let pending = readPendingAssist(storageKey)
      if (pending?.kind !== kind || pending.brief !== text) {
        pending = {
          kind,
          brief: text,
          requestKey: crypto.randomUUID(),
        }
        if (!writePendingAssist(storageKey, pending)) {
          throw new Error(
            '瀏覽器無法安全保存這次 AI 任務，已停止送出；請確認未停用工作階段儲存空間後重試',
          )
        }
      }
      taskId = pending.taskId ?? null
      if (!taskId) {
        const submitted = await requestJsonWithError<SubmitTextTaskResponse>(
          '/api/canvas/text',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              mode: kind === 'character' ? 'r2v_character' : 'r2v_scene_motion',
              locale,
              requestKey: pending.requestKey,
            }),
            signal: abortController.signal,
          },
          'AI 描述補全送出失敗',
        )
        if (!submitted.taskId) throw new Error('AI 描述補全沒有建立有效任務')
        taskId = submitted.taskId
        pending = { ...pending, taskId }
        writePendingAssist(storageKey, pending)
      }
      const result = await waitForTaskResult(taskId, {
        intervalMs: 1200,
        timeoutMs: 0,
        signal: abortController.signal,
      })
      const description = typeof result.text === 'string' ? result.text.trim() : ''
      if (!description) throw new Error('AI 沒有回傳可用描述')
      const maxChars = kind === 'character'
        ? DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS
        : DEPTH_SCENE_DESCRIPTION_MAX_CHARS
      if (description.length > maxChars) {
        throw new Error(`AI 回傳 ${description.length} 字，超過欄位上限 ${maxChars} 字；請縮短構想後重試`)
      }
      clearPendingAssist(storageKey)
      return description
    } catch (caught) {
      if (!isAbortError(caught)) {
        const disposition = taskId ? await readTaskDisposition(taskId) : 'unknown'
        if (disposition === 'failed' || disposition === 'missing') {
          clearPendingAssist(storageKey)
        }
        onError(caught instanceof Error ? caught.message : 'AI 描述補全失敗')
      }
      return null
    } finally {
      if (abortRef.current === abortController) abortRef.current = null
      inFlightRef.current = false
      setTarget(null)
    }
  }

  return {
    target,
    assistCharacter: (characterId: string, brief: string) => (
      assist('character', `character:${characterId}`, brief)
    ),
    assistScene: (brief: string) => assist('scene', 'scene', brief),
  }
}

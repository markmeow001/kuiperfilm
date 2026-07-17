'use client'

/**
 * Stale storyboard cleanup modal.
 *
 * Lists every storyboard belonging to the current episode with a
 * one-line preview (location + characters + first 80 chars of the
 * first panel's description). User clicks 刪除 on the storyboard they
 * want gone — the API cascades the delete down to all child panels +
 * supplementary panels via Prisma onDelete: Cascade.
 *
 * 2026-05-13 — built to recover from partial script_to_storyboard
 * re-analyze where one clip failed in phase2 / phase3 and left its
 * old panels in the DB while sibling clips were replaced. Result was
 * stale panels mixed into the timeline / multi-shot view, polluting
 * auto-group output with the wrong scene order.
 */

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface StoryboardSummary {
  id: string
  clipId: string
  createdAt: string
  updatedAt: string
  panelCount: number
  lastError: string | null
  firstPanel: {
    id: string
    panelIndex: number
    description: string
    location: string
    characterNames: string[]
  } | null
}

interface StaleStoryboardCleanupModalProps {
  projectId: string
  episodeId: string
  open: boolean
  onClose: () => void
  /** Called after a successful delete so parent can refresh storyboard data. */
  onAfterDelete: () => void
}

export function StaleStoryboardCleanupModal({
  projectId,
  episodeId,
  open,
  onClose,
  onAfterDelete,
}: StaleStoryboardCleanupModalProps) {
  const [loading, setLoading] = useState<boolean>(false)
  const [storyboards, setStoryboards] = useState<StoryboardSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(
      `/api/novel-promotion/${projectId}/episodes/${episodeId}/storyboards`,
      { method: 'GET' },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ storyboards: StoryboardSummary[] }>
      })
      .then((data) => {
        if (cancelled) return
        setStoryboards(data.storyboards ?? [])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '載入失敗')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId, episodeId])

  async function handleDelete(storyboardId: string, panelCount: number): Promise<void> {
    const confirmed = window.confirm(
      `確認刪除這個分鏡來源? 將會永久移除 ${panelCount} 個分鏡 (含對應圖片/影片連結)，動作不可復原。`,
    )
    if (!confirmed) return
    setDeletingId(storyboardId)
    setError(null)
    try {
      const res = await fetch(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}/storyboards/${storyboardId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)
      }
      setStoryboards((prev) => prev.filter((s) => s.id !== storyboardId))
      onAfterDelete()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setDeletingId(null)
    }
  }

  if (!open) return null

  return (
    <div
      className="kuiper-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="kuiper-modal-surface max-h-[85vh] w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-3">
          <div className="flex items-center gap-2">
            <AppIcon name="sparklesAlt" className="h-3 w-3 text-primary-400" />
            <h2 className="font-mono text-[14px] uppercase tracking-wider text-primary-300">
              整理分鏡來源
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-border-strong px-2 py-0.5 font-mono text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
          >
            關閉
          </button>
        </div>

        <div className="border-b border-border-soft bg-raised/40 px-5 py-2 font-serif-cn text-[12px] italic leading-relaxed text-text-secondary">
          每個 clip 的分鏡會落在自己的「分鏡來源」。再分析失敗時舊的分鏡會殘留在這裡，造成時間軸/多鏡頭模式順序錯亂。挑出
          <span className="text-primary-300">不該存在的那組</span>刪掉即可。
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-4">
          {loading ? (
            <div className="px-3 py-6 text-center font-mono text-[12px] text-text-tertiary">
              載入中…
            </div>
          ) : error ? (
            <div className="rounded-sm border border-red-700/40 bg-red-900/20 px-3 py-2 font-mono text-[12px] text-red-300">
              {error}
            </div>
          ) : storyboards.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-[12px] text-text-tertiary">
              這集沒有分鏡來源
            </div>
          ) : (
            <div className="space-y-3">
              {storyboards.map((sb, idx) => {
                const fp = sb.firstPanel
                return (
                  <div
                    key={sb.id}
                    className="rounded-sm border border-border-soft bg-raised/40 p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-primary-400">
                          來源 {String(idx + 1).padStart(2, '0')}
                          <span className="text-text-tertiary">
                            · {sb.panelCount} 鏡
                          </span>
                          {sb.lastError ? (
                            <span className="rounded-sm border border-red-700/40 bg-red-900/20 px-1.5 text-red-300">
                              last error
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-text-tertiary">
                          id {sb.id.slice(0, 8)} · clip {sb.clipId.slice(0, 8)} · 更新{' '}
                          {new Date(sb.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={deletingId === sb.id}
                        onClick={() => handleDelete(sb.id, sb.panelCount)}
                        className="rounded-sm border border-red-700/40 bg-red-900/20 px-2.5 py-1 font-mono text-[12px] tracking-wider text-red-300 transition-all hover:border-red-600/60 hover:bg-red-900/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingId === sb.id ? '刪除中…' : '刪除'}
                      </button>
                    </div>

                    {fp ? (
                      <div className="space-y-1 rounded-sm border border-border-soft bg-black/20 p-2">
                        <div className="font-mono text-[11px] tracking-wider text-text-secondary">
                          首鏡預覽
                        </div>
                        {fp.location ? (
                          <div className="font-serif-cn text-[12px] text-emerald-300">
                            場景：{fp.location}
                          </div>
                        ) : null}
                        {fp.characterNames.length > 0 ? (
                          <div className="font-serif-cn text-[12px] text-primary-300">
                            出場：{fp.characterNames.join('、')}
                          </div>
                        ) : null}
                        {fp.description ? (
                          <div className="font-serif-cn text-[12px] leading-relaxed text-text-secondary">
                            {fp.description}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-sm border border-border-soft bg-black/20 p-2 font-mono text-[11px] italic text-text-tertiary">
                        (空分鏡來源 — 無 panel 可預覽)
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

/**
 * Phase 12.5 — request edit access modal.
 *
 * Triggered when a viewer wants write access. Submits POST to
 * /api/projects/[id]/edit-requests with optional message.
 *
 * Server-side handles dedupe (existing pending request → 200 with
 * alreadyPending: true) and rate limits (RATE_LIMIT error). We display
 * the friendly message in error.details.reason if present.
 */

import { useState } from 'react'

interface RequestEditAccessModalProps {
  projectId: string
  projectName: string
  ownerName?: string | null
  onClose: () => void
  onSubmitted?: () => void
}

export function RequestEditAccessModal({
  projectId,
  projectName,
  ownerName,
  onClose,
  onSubmitted,
}: RequestEditAccessModalProps) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const [success, setSuccess] = useState<'created' | 'already-pending' | null>(null)

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setErrorReason(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/edit-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() || undefined }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        request?: unknown
        alreadyPending?: boolean
        error?: { code?: string; details?: { reason?: string } }
      }
      if (!res.ok) {
        const reason = body.error?.details?.reason
          || (body.error?.code === 'ALREADY_HAS_ACCESS'
            ? '你已經有編輯權限，無需請求'
            : body.error?.code === 'OWNER_CANNOT_REQUEST'
              ? '你是專案擁有者'
              : '請求失敗，請稍後再試')
        setErrorReason(reason)
        return
      }
      setSuccess(body.alreadyPending ? 'already-pending' : 'created')
      if (onSubmitted) onSubmitted()
    } catch (err) {
      setErrorReason(err instanceof Error ? err.message : '網路錯誤')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-sm border border-amber-900/30 bg-stone-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-cn text-lg text-stone-100">請求編輯權限</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-sm text-stone-500 transition-colors hover:text-stone-300"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 space-y-1 font-fraunces text-sm text-stone-400">
          <div>專案: <span className="text-stone-200">《{projectName}》</span></div>
          {ownerName ? <div>擁有者: <span className="text-stone-200">@{ownerName}</span></div> : null}
        </div>

        {success === 'created' ? (
          <div className="rounded-sm border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 font-fraunces text-sm text-emerald-300">
            ✓ 請求已送出，擁有者回應後你會收到通知
          </div>
        ) : success === 'already-pending' ? (
          <div className="rounded-sm border border-amber-600/40 bg-amber-600/10 px-3 py-2 font-fraunces text-sm text-amber-300">
            ⓘ 你已經對此專案送出過請求，等待擁有者回應中
          </div>
        ) : (
          <>
            <label className="block font-fraunces text-xs italic text-stone-500">
              留言（選填，給擁有者參考）
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="例如：我想幫你改 EP02 對白…"
              className="mt-1 w-full rounded-sm border border-stone-700 bg-stone-900 px-3 py-2 font-serif-cn text-sm text-stone-200 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
              disabled={submitting}
            />
            <div className="mt-1 text-right font-mono text-[10px] text-stone-600">
              {message.length}/500
            </div>

            {errorReason ? (
              <div className="mt-2 rounded-sm border border-rose-600/40 bg-rose-600/10 px-3 py-2 font-fraunces text-xs text-rose-300">
                {errorReason}
              </div>
            ) : null}

            <div className="mt-3 font-fraunces text-[11px] italic text-stone-500">
              ⓘ 擁有者批准後你會收到通知
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-stone-700 bg-transparent px-4 py-1.5 font-serif-cn text-sm text-stone-300 transition-colors hover:bg-stone-900"
          >
            {success ? '關閉' : '取消'}
          </button>
          {!success ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-sm bg-amber-500 px-4 py-1.5 font-serif-cn text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '送出中…' : '送出請求'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

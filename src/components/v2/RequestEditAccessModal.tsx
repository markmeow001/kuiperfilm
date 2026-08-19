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
import { useTranslations } from 'next-intl'
import { Modal } from './Modal'

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
  const t = useTranslations('collab.requestModal')
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
        // Prefer server-localised error reason when present; otherwise
        // fall back to a static localised string per known code.
        const reason = body.error?.details?.reason
          || (body.error?.code === 'ALREADY_HAS_ACCESS'
            ? t('errorAlreadyHasAccess')
            : body.error?.code === 'OWNER_CANNOT_REQUEST'
              ? t('errorOwnerCannotRequest')
              : t('errorFallback'))
        setErrorReason(reason)
        return
      }
      setSuccess(body.alreadyPending ? 'already-pending' : 'created')
      if (onSubmitted) onSubmitted()
    } catch (err) {
      setErrorReason(err instanceof Error ? err.message : t('errorNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <Modal.Header
        heading={t('title')}
        onClose={onClose}
        closeAriaLabel={t('closeAria')}
      />
      <Modal.Body>
        <div className="mb-4 space-y-1 font-fraunces text-sm text-[var(--production-ink-muted)]">
          <div>{t('projectLabel')} <span className="text-[var(--production-ink)]">《{projectName}》</span></div>
          {ownerName ? <div>{t('ownerLabel')} <span className="text-[var(--production-ink)]">@{ownerName}</span></div> : null}
        </div>

        {success === 'created' ? (
          <div className="rounded-[10px] border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 font-fraunces text-sm text-emerald-200" role="status">
            {t('successCreated')}
          </div>
        ) : success === 'already-pending' ? (
          <div className="rounded-[10px] border border-amber-500/35 bg-amber-500/10 px-3 py-2 font-fraunces text-sm text-amber-200" role="status">
            {t('successAlreadyPending')}
          </div>
        ) : (
          <>
            <label className="block font-fraunces text-xs italic text-[var(--production-ink-muted)]">
              {t('messageLabel')}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder={t('messagePlaceholder')}
              className="mt-1 w-full rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)] px-3 py-2 font-serif-cn text-sm text-[var(--production-ink)] outline-none placeholder:text-[color-mix(in_srgb,var(--production-ink-muted)_68%,transparent)] hover:border-[var(--production-border-dark)] focus-visible:border-[var(--production-focus)] focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.24)]"
              disabled={submitting}
            />
            <div className="mt-1 text-right font-mono text-[11px] text-[var(--production-ink-muted)]">
              {t('messageCounter', { count: message.length })}
            </div>

            {errorReason ? (
              <div className="mt-2 rounded-[10px] border border-rose-500/35 bg-rose-500/10 px-3 py-2 font-fraunces text-xs text-rose-200" role="alert">
                {errorReason}
              </div>
            ) : null}

            <div className="mt-3 font-fraunces text-[12px] italic text-[var(--production-ink-muted)]">
              {t('tip')}
            </div>
          </>
        )}

      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-[10px] border border-[var(--production-border)] bg-transparent px-4 py-2 font-serif-cn text-sm text-[var(--production-ink-muted)] transition-colors hover:border-[var(--production-border-dark)] hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
        >
          {success ? t('close') : t('cancel')}
        </button>
        {!success ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="min-h-11 rounded-[10px] bg-[var(--production-blue)] px-4 py-2 font-serif-cn text-sm font-semibold text-white transition-colors hover:bg-[var(--production-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--production-surface)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        ) : null}
      </Modal.Footer>
    </Modal>
  )
}

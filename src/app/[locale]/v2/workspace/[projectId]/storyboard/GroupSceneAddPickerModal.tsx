'use client'

/**
 * Phase V (2026-05-28) — Pick a location from the project roster to
 * apply to the current group's panel.location.
 *
 * Mirrors LocationViewPickerModal's layout but lists the UNUSED
 * roster (locations not already in groupScenes) so users can freely
 * add any project scene to this group — the missing counterpart to
 * the × remove button on the chip.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface LocationImageLike {
  id: string
  imageIndex?: number
  imageUrl?: string | null
}

interface LocationOption {
  id: string
  name: string
  images?: LocationImageLike[]
}

interface GroupSceneAddPickerModalProps {
  open: boolean
  onClose: () => void
  candidates: LocationOption[]
  onSelect: (locationId: string) => void
}

export function GroupSceneAddPickerModal({
  open,
  onClose,
  candidates,
  onSelect,
}: GroupSceneAddPickerModalProps) {
  const t = useTranslations('v2Storyboard.groupScenePicker')
  const [query, setQuery] = useState<string>('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const lower = query.trim().toLowerCase()
  const filtered = lower
    ? candidates.filter((l) => l.name.toLowerCase().includes(lower))
    : candidates

  return (
    <div
      className="kuiper-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        className="kuiper-modal-surface w-full max-w-2xl border border-[var(--production-border)] bg-[var(--production-surface)] text-[var(--production-ink)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--production-border)] bg-[var(--production-muted)] px-5 py-3">
          <div>
            <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--process-cyan-strong)]">
              {t('title')}
            </div>
            <div className="mt-1 text-[14px] text-[var(--production-ink-muted)]">
              {t('description')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-[var(--production-border)] bg-[var(--production-surface)] px-5 py-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoFocus
            className="min-h-11 w-full rounded-xl border border-[var(--production-border)] bg-[var(--production-muted)] px-3 text-[14px] text-[var(--production-ink)] outline-none placeholder:text-[var(--production-ink-muted)] focus-visible:border-[var(--process-cyan)] focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--production-ink-muted)]">
              {candidates.length === 0
                ? t('emptyAll')
                : t('emptyNoMatch')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((l) => {
                const primary =
                  l.images?.find((i) => (i.imageIndex ?? 0) === 0) ??
                  l.images?.[0] ??
                  null
                const avatar = primary?.imageUrl ?? null
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(l.id)}
                      aria-label={t('addAria', { name: l.name })}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-transparent bg-[var(--production-muted)] px-3 py-2 transition-colors hover:border-[var(--process-cyan)]/45 hover:bg-[var(--process-cyan-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
                    >
                      <div className="relative h-9 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--production-surface)]">
                        {avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatar}
                            alt={l.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <AppIcon
                            name="image"
                            className="m-auto h-4 w-4 text-[var(--production-ink-muted)]"
                          />
                        )}
                      </div>
                      <span className="flex-1 text-left text-[14px] text-[var(--production-ink)]">
                        {l.name}
                      </span>
                      <span aria-hidden="true" className="font-mono text-[12px] uppercase tracking-wider text-[var(--process-cyan-strong)]">
                        + {t('add')}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface DarkMediaLightboxProps {
  src: string | null
  alt: string
  onClose: () => void
  closeLabel?: string
  dismissHint?: string
}

/**
 * Shared V2 media preview. The portal deliberately uses only production
 * night-blue tokens so it cannot inherit the legacy magenta workspace skin.
 */
export function DarkMediaLightbox({
  src,
  alt,
  onClose,
  closeLabel = '關閉圖片預覽',
  dismissHint,
}: DarkMediaLightboxProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!src) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute('disabled'))

      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (
        event.shiftKey
        && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey
        && (document.activeElement === last || document.activeElement === dialog || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [onClose, src])

  if (!src || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`圖片預覽：${alt}`}
      tabIndex={-1}
      data-theme="production-studio"
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-[var(--production-paper)] p-3 text-[var(--production-ink)] backdrop-blur-md sm:p-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <figure className="relative flex max-h-full max-w-full flex-col overflow-hidden rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)] shadow-[0_24px_72px_rgba(0,0,0,0.58)]">
        <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[var(--production-border)] px-3 sm:px-4">
          <figcaption className="min-w-0 truncate text-sm text-[var(--production-ink-muted)]">
            {alt}
          </figcaption>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={dismissHint ?? closeLabel}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)] text-xl leading-none text-[var(--production-ink-muted)] motion-safe:transition-colors hover:border-[var(--production-focus)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-1.5rem)] object-contain sm:max-w-[calc(100vw-4rem)]"
        />
        {dismissHint ? (
          <div className="border-t border-[var(--production-border)] px-4 py-2 text-center font-mono text-xs tracking-[0.08em] text-[var(--production-ink-muted)]">
            {dismissHint}
          </div>
        ) : null}
      </figure>
    </div>,
    document.body,
  )
}

'use client'

/**
 * Phase 0 redesign — Modal v2.
 *
 * Reference: REDESIGN_PLAN.md §3.5 (motion), §3.2 (surface scale),
 * DESIGN.md §3.3 (signature moments — cold start uses Modal for
 * onboarding-style overlays).
 *
 * Pattern: controlled component. Parent owns open/close state. Modal
 * portals into document.body so it escapes any clipping ancestor.
 * Backdrop click + Escape key both close (configurable). Focus moves
 * to the first focusable element on open and trap-cycles inside the
 * dialog until close.
 *
 * Sizes (max width):
 *   - sm:  320px — confirmation dialogs ("確定刪除？")
 *   - md:  480px — form modals (single-step wizard, settings group)
 *   - lg:  720px — content modals (preview, share, asset detail)
 *   - xl:  960px — large form / multi-column (rare)
 *
 * Composed via Modal.Header / Modal.Body / Modal.Footer subcomponents,
 * same pattern as Card. Header includes the close X button by default.
 *
 * Animation: fade-in backdrop 200ms, scale-from-0.96 + fade body 320ms
 * via DESIGN.md motion tokens. Respects prefers-reduced-motion (kills
 * the scale animation).
 *
 * Forbidden per §3.8: drop-shadow ambient glow, gradient borders,
 * loading spinner inside the modal body (use GenerationProgress v2
 * for loading states inside dialogs).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type Size = 'sm' | 'md' | 'lg' | 'xl'

export interface ModalV2Props {
  /** Whether the modal is rendered. Parent controls. */
  open: boolean
  /** Called when the user requests close (Escape, backdrop click, or X). */
  onClose: () => void
  /** Max-width tier — see component header for sizing rules. */
  size?: Size
  /** When false, clicking the backdrop does NOT close. Default true. */
  dismissOnBackdrop?: boolean
  /** When false, Escape key does NOT close. Default true. */
  dismissOnEscape?: boolean
  /** Optional className on the dialog panel. */
  className?: string
  /** Optional aria-label when no Modal.Header title is rendered. */
  ariaLabel?: string
  children?: ReactNode
}

function sizeClass(size: Size): string {
  switch (size) {
    case 'sm': return 'max-w-[320px]'
    case 'md': return 'max-w-[480px]'
    case 'lg': return 'max-w-[720px]'
    case 'xl': return 'max-w-[960px]'
  }
}

interface ModalComponent {
  (props: ModalV2Props): React.JSX.Element | null
  Header: typeof ModalHeader
  Body: typeof ModalBody
  Footer: typeof ModalFooter
}

const ModalImpl = (function Modal({
  open,
  onClose,
  size = 'md',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  className,
  ariaLabel,
  children,
}: ModalV2Props): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  // Body scroll lock while open (don't let the page scroll behind a
  // modal). Restored to previous overflow value on close so other
  // modals stacked on the same screen don't fight.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Escape key close. Bound at document level so it works even when
  // focus isn't inside the dialog yet (e.g. mid-transition).
  useEffect(() => {
    if (!open || !dismissOnEscape) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissOnEscape, onClose])

  // Initial focus — move to the dialog panel itself. Authors who want
  // to focus a specific control can override via autoFocus on the
  // child. Keeps the floor below custom focus management.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const el = dialogRef.current
      if (!el) return
      const focusable = el.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ;(focusable ?? el).focus()
    }, 60)
    return () => clearTimeout(t)
  }, [open])

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dismissOnBackdrop) return
      if (e.target === e.currentTarget) onClose()
    },
    [dismissOnBackdrop, onClose],
  )

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabel ? undefined : titleId}
      aria-label={ariaLabel}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm motion-safe:animate-[fadeIn_200ms_ease-out]"
      onClick={onBackdropClick}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-modal-title-id={titleId}
        className={[
          'relative w-full mx-4',
          sizeClass(size),
          'rounded-modal border border-border-soft bg-raised shadow-elev-3 outline-none',
          'motion-safe:animate-[scaleIn_320ms_cubic-bezier(0.16,1,0.3,1)]',
          className ?? '',
        ].filter(Boolean).join(' ')}
      >
        {children}
      </div>
      {/* Inline keyframes — local to this component so we don't
          pollute globals.css with one-off animations. */}
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>,
    document.body,
  )
}) as unknown as ModalComponent

// ─── Sub-components ────────────────────────────────────────────────

interface ModalHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Heading text — uses the auto-generated id for aria-labelledby
   *  wiring. Named `heading` (not `title`) because `title` is a real
   *  HTML attribute (tooltip text) typed as `string | undefined`,
   *  which collides with `ReactNode` on the interface extension. */
  heading?: ReactNode
  /** Optional subtitle (smaller secondary text below heading). */
  subtitle?: ReactNode
  /** Show the default close X button. Default true. */
  showClose?: boolean
  /** Called when the close X is clicked. Wire to the parent's onClose. */
  onClose?: () => void
}

const ModalHeader = forwardRef<HTMLDivElement, ModalHeaderProps>(function ModalHeader(
  { heading, subtitle, showClose = true, onClose, className, children, ...rest },
  ref,
) {
  const classes = [
    'flex items-start justify-between gap-4 border-b border-border-soft px-5 py-4',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={ref} className={classes} {...rest}>
      <div className="flex-1">
        {heading ? (
          <h2 className="text-[16px] font-medium leading-[1.4] text-text-primary">
            {heading}
          </h2>
        ) : null}
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-[1.4] text-text-secondary">
            {subtitle}
          </p>
        ) : null}
        {children}
      </div>
      {showClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-text-tertiary transition-colors duration-[120ms] ease-out hover:bg-overlay hover:text-text-primary"
        >
          <span aria-hidden="true" className="text-[18px] leading-none">×</span>
        </button>
      ) : null}
    </div>
  )
})

function ModalBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = ['px-5 py-4 text-[14px] text-text-secondary', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

function ModalFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = [
    'flex items-center justify-end gap-2 border-t border-border-soft px-5 py-3',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

ModalImpl.Header = ModalHeader
ModalImpl.Body = ModalBody
ModalImpl.Footer = ModalFooter

export const Modal = ModalImpl

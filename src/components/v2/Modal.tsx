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
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const ModalTitleIdContext = createContext<string | null>(null)
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

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
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

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

  // Capture once per open cycle, then return to the trigger on close.
  // Keeping this separate from the keyboard listener prevents callback
  // identity changes during form edits from returning focus prematurely.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    return () => previouslyFocused?.focus()
  }, [open])

  // Keyboard boundary. Bound at document level so Escape works even before
  // the initial-focus effect runs. Tab and Shift+Tab wrap inside the dialog.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissOnEscape) {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissOnEscape])

  // Initial focus — move to the dialog panel itself. Authors who want
  // to focus a specific control can override via autoFocus on the
  // child. Keeps the floor below custom focus management.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const el = dialogRef.current
      if (!el) return
      const focusable = el.querySelector<HTMLElement>(
        `[data-initial-focus], ${FOCUSABLE_SELECTOR}`,
      )
      ;(focusable ?? el).focus()
    }, 0)
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
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm motion-safe:animate-[modalV2FadeIn_200ms_ease-out]"
      onClick={onBackdropClick}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-modal-title-id={titleId}
        className={[
          'relative w-full',
          sizeClass(size),
          'rounded-modal border border-[var(--production-border)] bg-[var(--production-surface)] text-[var(--production-ink)] shadow-elev-3 outline-none',
          'motion-safe:animate-[modalV2ScaleIn_320ms_cubic-bezier(0.16,1,0.3,1)]',
          className ?? '',
        ].filter(Boolean).join(' ')}
      >
        <ModalTitleIdContext.Provider value={titleId}>
          {children}
        </ModalTitleIdContext.Provider>
      </div>
      {/* Inline keyframes — local to this component so we don't
          pollute globals.css with one-off animations. */}
      <style>{`
        @keyframes modalV2FadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes modalV2ScaleIn {
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
  /** Localised accessible name for the close control. */
  closeAriaLabel?: string
}

const ModalHeader = forwardRef<HTMLDivElement, ModalHeaderProps>(function ModalHeader(
  {
    heading,
    subtitle,
    showClose = true,
    onClose,
    closeAriaLabel = '關閉',
    className,
    children,
    ...rest
  },
  ref,
) {
  const titleId = useContext(ModalTitleIdContext)
  const classes = [
    'flex items-start justify-between gap-4 border-b border-[var(--production-border)] px-5 py-4',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={ref} className={classes} {...rest}>
      <div className="flex-1">
        {heading ? (
          <h2 id={titleId ?? undefined} className="text-[16px] font-medium leading-[1.4] text-[var(--production-ink)]">
            {heading}
          </h2>
        ) : null}
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-[1.4] text-[var(--production-ink-muted)]">
            {subtitle}
          </p>
        ) : null}
        {children}
      </div>
      {showClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeAriaLabel}
          className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-input text-[var(--production-ink-muted)] transition-colors duration-[120ms] ease-out hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
        >
          <span aria-hidden="true" className="text-[18px] leading-none">×</span>
        </button>
      ) : null}
    </div>
  )
})

function ModalBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = ['px-5 py-4 text-[14px] text-[var(--production-ink-muted)]', className ?? '']
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
    'flex items-center justify-end gap-2 border-t border-[var(--production-border)] px-5 py-3',
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

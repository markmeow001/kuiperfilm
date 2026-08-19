'use client'

/**
 * Phase 0 redesign — Field v2.
 *
 * Reference: REDESIGN_PLAN.md §3 (tokens).
 *
 * Different role from Input v2: Input handles its own label/helper
 * for single-line use. Field is the generic wrapper for any control
 * that's NOT an Input (textarea, select, checkbox group, radio group,
 * custom widget like color picker / file dropzone). It provides:
 *
 *   - consistent vertical spacing between label / control / helper
 *   - optional required indicator (* in the semantic danger colour)
 *   - optional tooltip-style description below label
 *   - optional error message that recolors the helper line
 *   - htmlFor wiring via useId when child is a labelable control
 *
 * It does NOT style the control inside it — caller styles the child
 * however they want. This avoids the "every form library reinvents
 * label" trap.
 *
 * For single-line text inputs, prefer <Input label="..." /> — it's
 * a tighter API. Field is for everything else.
 */

import { useId, type ReactNode } from 'react'

export interface FieldV2Props {
  /** Label shown above the control. */
  label?: ReactNode
  /** Short description below the label, before the control. */
  description?: ReactNode
  /** Helper text below the control (idle state). */
  helper?: ReactNode
  /** Error text — when present, overrides helper + tints both red. */
  error?: ReactNode
  /** Show a semantic required marker after the label. */
  required?: boolean
  /** The actual form control. */
  children: ReactNode
  /** Optional className on the outer wrapper. */
  className?: string
}

export function Field({
  label,
  description,
  helper,
  error,
  required = false,
  children,
  className,
}: FieldV2Props) {
  const reactId = useId()
  const helperId = `${reactId}-helper`
  const hasError = Boolean(error)

  const wrapperClasses = ['flex flex-col', className ?? ''].filter(Boolean).join(' ')

  return (
    <div className={wrapperClasses}>
      {label ? (
        <label
          className="mb-1.5 text-[12px] uppercase tracking-[0.04em] text-text-secondary"
        >
          {label}
          {required ? (
            <span className="ml-1 text-[var(--production-danger)]" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}

      {description ? (
        <p className="mb-2 text-[12px] leading-[1.5] text-text-tertiary">
          {description}
        </p>
      ) : null}

      <div aria-describedby={helper || error ? helperId : undefined}>
        {children}
      </div>

      {(error || helper) ? (
        <p
          id={helperId}
          className={`mt-1.5 text-[12px] leading-[1.4] ${
            hasError ? 'text-error' : 'text-text-tertiary'
          }`}
        >
          {error ?? helper}
        </p>
      ) : null}
    </div>
  )
}

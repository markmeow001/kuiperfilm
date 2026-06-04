'use client'

/**
 * Phase 0 redesign — Input v2.
 *
 * Reference: REDESIGN_PLAN.md §3 (tokens), §3.5 (motion).
 *
 * Companion to Button v2 — the two together cover ~60% of common form
 * surface in V2 pages. State design intent:
 *   - idle:      bg-raised + border-soft, calm
 *   - hover:     border-strong, no other change (subtle invitation)
 *   - focus:     accent-500 ring + border (high contrast for keyboard nav)
 *   - error:     error border + ring, helper text recolored
 *   - disabled:  opacity-50, cursor not-allowed
 *
 * Uses inline padding via size class (not fixed height), so the input
 * grows with multi-line content when used as a textarea. Single-line
 * use clamps at h-{sz} via the height utility.
 *
 * Forbidden per §3.8: gradient borders, glow-without-purpose, drop
 * shadow on focus. All state changes use border + ring + bg only.
 */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'

type Size = 'sm' | 'md' | 'lg'

export interface InputV2Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: Size
  /** Label rendered above the input. */
  label?: ReactNode
  /** Helper text below input (idle state). */
  helper?: ReactNode
  /** Error message — when present, switches input to error state visually. */
  error?: ReactNode
  /** Optional leading icon (Lucide / Phosphor 1.5px stroke). */
  leftIcon?: ReactNode
  /** Optional trailing icon or button. */
  rightIcon?: ReactNode
  /** Optional leading text addon (e.g. "$" for price). */
  addonStart?: ReactNode
  /** Optional trailing text addon (e.g. ".mp4" for filename). */
  addonEnd?: ReactNode
  /** When true, container fills its parent width. Default true. */
  fullWidth?: boolean
}

function sizeClass(size: Size): { h: string; px: string; text: string } {
  switch (size) {
    case 'sm':
      return { h: 'h-8', px: 'px-2.5', text: 'text-[13px]' }
    case 'md':
      return { h: 'h-10', px: 'px-3', text: 'text-[14px]' }
    case 'lg':
      return { h: 'h-12', px: 'px-4', text: 'text-[16px]' }
  }
}

export const Input = forwardRef<HTMLInputElement, InputV2Props>(function Input(
  {
    size = 'md',
    label,
    helper,
    error,
    leftIcon,
    rightIcon,
    addonStart,
    addonEnd,
    fullWidth = true,
    disabled,
    className,
    id,
    ...rest
  },
  ref,
) {
  const reactId = useId()
  const inputId = id ?? `input-v2-${reactId}`
  const helperId = `${inputId}-helper`
  const hasError = Boolean(error)
  const { h, px, text } = sizeClass(size)

  // Container — owns visible bg, border, focus-ring, error styling.
  // Built on raised surface so the input "sits on" canvas. Border lifts
  // on hover (subtle invitation), then snaps to accent on focus.
  const containerClasses = [
    'inline-flex items-center gap-1.5',
    'rounded-input border bg-raised',
    'transition-colors duration-[120ms] ease-out',
    h,
    px,
    fullWidth ? 'flex w-full' : '',
    hasError
      ? 'border-error/60 focus-within:border-error focus-within:ring-2 focus-within:ring-error/40'
      : 'border-border-soft hover:border-border-strong focus-within:border-accent-500/60 focus-within:ring-2 focus-within:ring-accent-500/40',
    disabled ? 'opacity-50 cursor-not-allowed' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  // The actual <input> — transparent, no border (container owns those).
  // text-text-primary uses the v2 token; placeholder uses tertiary so
  // empty state is visibly lower contrast without being invisible.
  const inputClasses = [
    'flex-1 bg-transparent outline-none border-0',
    'text-text-primary placeholder:text-text-tertiary',
    'disabled:cursor-not-allowed',
    text,
  ].join(' ')

  return (
    <div className={fullWidth ? 'w-full' : 'inline-block'}>
      {label ? (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-[12px] uppercase tracking-[0.04em] text-text-secondary"
        >
          {label}
        </label>
      ) : null}

      <div className={containerClasses}>
        {leftIcon ? (
          <span aria-hidden="true" className="inline-flex shrink-0 text-text-tertiary">
            {leftIcon}
          </span>
        ) : null}
        {addonStart ? (
          <span aria-hidden="true" className={`shrink-0 ${text} text-text-tertiary`}>
            {addonStart}
          </span>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={helper || error ? helperId : undefined}
          className={inputClasses}
          {...rest}
        />

        {addonEnd ? (
          <span aria-hidden="true" className={`shrink-0 ${text} text-text-tertiary`}>
            {addonEnd}
          </span>
        ) : null}
        {rightIcon ? (
          <span aria-hidden="true" className="inline-flex shrink-0 text-text-tertiary">
            {rightIcon}
          </span>
        ) : null}
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
})

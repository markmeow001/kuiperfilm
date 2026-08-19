'use client'

/**
 * Phase 0 redesign — Button v2.
 *
 * Reference: REDESIGN_PLAN.md §3 (token spec), §3.5 (motion/easing),
 * §3.8 anti-patterns (no gradient bg, no emoji, no shadow in dark).
 *
 * This is the FIRST component of the v2 component library. It validates
 * the tokens-v2.css system end-to-end:
 *   - color: production blue action + cyan keyboard focus
 *   - radius: r-input (8px)
 *   - motion: ease-out + d-hover (120ms) for color, d-state (200ms) for
 *     pressed state ring
 *   - text: ui line-height (1.45), CJK-safe (no font-feature drift)
 *   - states: idle / hover / pressed / focus-visible / disabled / loading
 *
 * Coexistence: legacy <button> + <Button> from existing UI lib are
 * untouched. Migration is opt-in per page during Phase 1.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonV2Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** Optional leading icon (Lucide component, 16px stroked). */
  leftIcon?: ReactNode
  /** Optional trailing icon. */
  rightIcon?: ReactNode
  /** When true, button width fills its container. Default false. */
  fullWidth?: boolean
}

// Variant classes derived directly from tokens-v2.css via @theme inline
// in globals.css. No inline color literals — single source of truth in
// the token CSS file.
function variantClass(variant: Variant): string {
  switch (variant) {
    case 'primary':
      return [
        // base
        'bg-[var(--production-blue)] text-white',
        // hover — 120ms color shift to 400
        'hover:bg-[var(--production-blue-hover)]',
        // active — pressed darkens to 600
        'active:bg-[color-mix(in_srgb,var(--production-blue)_84%,black)]',
        'focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--darkroom-canvas)]',
      ].join(' ')
    case 'secondary':
      // raised surface + soft border. Matches §3.5 elevation: lift via
      // surface, not shadow.
      return [
        'border border-[var(--darkroom-border)] bg-[var(--darkroom-surface)] text-[var(--darkroom-text)]',
        'hover:bg-[var(--darkroom-raised)] hover:border-[var(--process-cyan)]/45',
        'active:bg-[var(--darkroom-surface)] active:border-[var(--darkroom-border)]',
        'focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--darkroom-canvas)]',
      ].join(' ')
    case 'ghost':
      // transparent. Hover lifts into overlay surface. For toolbars,
      // chip rails, inline actions.
      return [
        'bg-transparent text-[var(--darkroom-muted)]',
        'hover:bg-[var(--darkroom-raised)] hover:text-[var(--darkroom-text)]',
        'active:bg-[var(--darkroom-raised)]',
        'focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--darkroom-canvas)]',
      ].join(' ')
    case 'danger':
      // semantic error variant for destructive confirm flows.
      return [
        'bg-error text-neutral-50',
        'hover:bg-error/90',
        'active:bg-error/80',
        'focus-visible:ring-2 focus-visible:ring-error/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--darkroom-canvas)]',
      ].join(' ')
  }
}

function sizeClass(size: Size): string {
  switch (size) {
    case 'sm':
      return 'h-8 px-3 text-[13px] gap-1.5'
    case 'md':
      return 'h-10 px-4 text-[14px] gap-2'
    case 'lg':
      return 'h-12 px-5 text-[16px] gap-2'
  }
}

export const Button = forwardRef<HTMLButtonElement, ButtonV2Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading

  const classes = [
    // base — applies to all variants
    'inline-flex items-center justify-center select-none',
    'rounded-input font-medium leading-[1.45]',
    'transition-colors duration-[120ms] ease-out',
    'focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    fullWidth ? 'w-full' : '',
    sizeClass(size),
    variantClass(variant),
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {loading ? (
        // Spinner — 1.5px stroke per §3.6 iconography rule. Matches
        // current button height via aspect-square w-4/h-4.
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-80"
        />
      ) : leftIcon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {leftIcon}
        </span>
      ) : null}
      {children}
      {!loading && rightIcon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {rightIcon}
        </span>
      ) : null}
    </button>
  )
})

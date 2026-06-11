'use client'

/**
 * Phase 0 redesign — Card v2.
 *
 * Reference: REDESIGN_PLAN.md §3.2 (surfaces), §3.5 (elevation),
 * §3.8 #5 (no drop-shadow dark cards — use border + surface lift).
 *
 * Replaces the legacy `.card-base` utility in globals.css. Coexists
 * with it: legacy class still works for unmigrated pages; new code
 * uses `<Card />`. Migration is opt-in per page during Phase 1.
 *
 * Variants follow the 3-surface rule (§3.2: ≤3 neutrals per view):
 *   - raised  — default content container, sits on canvas
 *   - overlay — for popovers, dropdowns, side panels (sits on raised)
 *   - hero    — large feature surfaces (24px radius, heavier elevation)
 *
 * Padding is independently scaled so a small chip-tile card can use
 * `padding="sm"` while a project-detail card uses `padding="lg"`,
 * without redefining variant per use case.
 *
 * For composition (header + body + footer split), users compose via
 * the `<Card.Header />` / `<Card.Body />` / `<Card.Footer />`
 * sub-components, which apply consistent spacing without extra props.
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type Variant = 'raised' | 'overlay' | 'hero'
type Padding = 'none' | 'sm' | 'md' | 'lg'
type Elevation = 0 | 1 | 2 | 3

export interface CardV2Props extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  padding?: Padding
  /** Elevation level. 0 = flat border only (default for raised), 1-3 for popovers/heroes. */
  elevation?: Elevation
  /** When true, suppresses the default border. Use for full-bleed media cards. */
  borderless?: boolean
  /** Optional click-to-focus affordance. When true, applies hover:bg-overlay. */
  interactive?: boolean
  children?: ReactNode
}

function variantClass(variant: Variant): string {
  switch (variant) {
    case 'raised':
      return 'bg-raised rounded-card'
    case 'overlay':
      return 'bg-overlay rounded-card'
    case 'hero':
      return 'bg-raised rounded-hero'
  }
}

function paddingClass(p: Padding): string {
  switch (p) {
    case 'none': return ''
    case 'sm':   return 'p-3'
    case 'md':   return 'p-4'
    case 'lg':   return 'p-6'
  }
}

function elevationClass(e: Elevation): string {
  switch (e) {
    case 0: return ''
    case 1: return 'shadow-elev-1'
    case 2: return 'shadow-elev-2'
    case 3: return 'shadow-elev-3'
  }
}

interface CardComponent
  extends React.ForwardRefExoticComponent<CardV2Props & React.RefAttributes<HTMLDivElement>> {
  Header: typeof CardHeader
  Body: typeof CardBody
  Footer: typeof CardFooter
}

const CardImpl = forwardRef<HTMLDivElement, CardV2Props>(function Card(
  {
    variant = 'raised',
    padding = 'md',
    elevation = 0,
    borderless = false,
    interactive = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  const classes = [
    variantClass(variant),
    paddingClass(padding),
    elevationClass(elevation),
    borderless ? '' : 'border border-border-soft',
    interactive
      ? 'transition-colors duration-[120ms] ease-out hover:bg-overlay cursor-pointer'
      : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  )
})

// Sub-components for composed cards. They don't need ref forwarding —
// they're just semantic + spacing wrappers around children.
function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = [
    'flex items-center justify-between gap-3 pb-3 border-b border-border-soft',
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

function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = ['py-3', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = [
    'flex items-center justify-end gap-2 pt-3 border-t border-border-soft',
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

export const Card = CardImpl as CardComponent
Card.Header = CardHeader
Card.Body = CardBody
Card.Footer = CardFooter

'use client'

/**
 * Phase 0 redesign — Inspector v2.
 *
 * Reference: REDESIGN_PLAN.md §3.4 (Workspace layout standard:
 * Sidebar 256 + Canvas fluid + Inspector 360 collapsible).
 *
 * Pattern: parent-controlled collapsible side panel. Sits on the
 * right (or left) edge of a workspace layout. When collapsed,
 * shrinks to a 40px rail showing only the expand affordance —
 * preserves vertical real estate for the canvas without rebuilding
 * the layout grid.
 *
 * Sub-components mirror Card / Modal patterns: Inspector.Header /
 * Inspector.Body / Inspector.Footer. Header includes a default
 * collapse button that calls onCollapseChange.
 *
 * Sizing: width comes from REDESIGN_PLAN spec (360px default,
 * 40px collapsed). Overridable via prop when a page needs wider
 * (e.g. 420px for storyboard inspector with bigger thumbnails).
 *
 * Forbidden per §3.8: overlay glassmorphism, drop shadow on the
 * panel edge (use border-l + border-soft instead).
 */

import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

type Position = 'left' | 'right'

export interface InspectorV2Props extends HTMLAttributes<HTMLElement> {
  /** Whether the inspector is open or collapsed. Parent controls. */
  open: boolean
  /** Called when the user clicks the collapse / expand affordance. */
  onCollapseChange?: (next: boolean) => void
  /** Edge this inspector docks to. Default 'right'. */
  position?: Position
  /** Expanded width in px. Default 360 per REDESIGN_PLAN §3.4. */
  width?: number
  /** Collapsed width in px. Default 40. */
  collapsedWidth?: number
  children?: ReactNode
}

interface InspectorComponent
  extends React.ForwardRefExoticComponent<
    InspectorV2Props & React.RefAttributes<HTMLElement>
  > {
  Header: typeof InspectorHeader
  Body: typeof InspectorBody
  Footer: typeof InspectorFooter
}

const InspectorImpl = forwardRef<HTMLElement, InspectorV2Props>(function Inspector(
  {
    open,
    onCollapseChange,
    position = 'right',
    width = 360,
    collapsedWidth = 40,
    className,
    style,
    children,
    ...rest
  },
  ref,
) {
  const isRight = position === 'right'
  const borderClass = isRight ? 'border-l' : 'border-r'

  const classes = [
    'relative flex h-full flex-col bg-raised border-border-soft overflow-hidden',
    borderClass,
    'transition-[width] duration-[320ms]',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const w = open ? width : collapsedWidth

  return (
    <aside
      ref={ref}
      aria-expanded={open}
      data-inspector-position={position}
      className={classes}
      style={{ width: `${w}px`, ...style }}
      {...rest}
    >
      {open ? (
        children
      ) : (
        <button
          type="button"
          onClick={() => onCollapseChange?.(true)}
          aria-label="展開檢視器"
          className="flex h-full w-full items-center justify-center text-text-tertiary transition-colors duration-[120ms] ease-out hover:bg-overlay hover:text-text-primary"
        >
          <span aria-hidden="true" className="text-[14px]">
            {isRight ? '◀' : '▶'}
          </span>
        </button>
      )}
    </aside>
  )
})

// ─── Sub-components ────────────────────────────────────────────────

interface InspectorHeaderProps extends HTMLAttributes<HTMLDivElement> {
  heading?: ReactNode
  subtitle?: ReactNode
  /** When provided, renders a default collapse button calling this with `false`. */
  onCollapseChange?: (next: boolean) => void
  /** Inspector docking edge (informs which arrow to use). Default 'right'. */
  position?: Position
}

function InspectorHeader({
  heading,
  subtitle,
  onCollapseChange,
  position = 'right',
  className,
  children,
  ...rest
}: InspectorHeaderProps) {
  const arrow = position === 'right' ? '▶' : '◀'
  const classes = [
    'flex items-start justify-between gap-3 border-b border-border-soft px-4 py-3',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} {...rest}>
      <div className="flex-1">
        {heading ? (
          <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
            {heading}
          </div>
        ) : null}
        {subtitle ? (
          <div className="mt-0.5 text-[14px] font-medium text-text-primary leading-[1.35]">
            {subtitle}
          </div>
        ) : null}
        {children}
      </div>
      {onCollapseChange ? (
        <button
          type="button"
          onClick={() => onCollapseChange(false)}
          aria-label="收合檢視器"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-text-tertiary transition-colors duration-[120ms] ease-out hover:bg-overlay hover:text-text-primary"
        >
          <span aria-hidden="true" className="text-[12px]">
            {arrow}
          </span>
        </button>
      ) : null}
    </div>
  )
}

function InspectorBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = ['flex-1 overflow-y-auto px-4 py-3', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

function InspectorFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = [
    'flex items-center justify-end gap-2 border-t border-border-soft px-4 py-3',
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

export const Inspector = InspectorImpl as InspectorComponent
Inspector.Header = InspectorHeader
Inspector.Body = InspectorBody
Inspector.Footer = InspectorFooter

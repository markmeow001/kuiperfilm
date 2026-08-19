'use client'

/**
 * Phase 0 redesign — EmptyState v2 (§3.7.3 signature moment).
 *
 * Reference: DESIGN.md §3.3 (signature moment "Empty / cold start"),
 * REDESIGN_PLAN.md §3.8 anti-patterns #10 (no stock 3D, no isometric,
 * no AI mascot).
 *
 * The spec:
 *   - ONE commissioned line illustration (primary gold accent)
 *   - ONE line of display type ("你的第一部短劇從這裡開始")
 *   - ONE primary CTA
 *
 * Forbidden:
 *   - Tips lists
 *   - Three example cards
 *   - Stock 3D / isometric / AI mascot
 *   - Hero photo / stock video
 *   - Multiple CTAs (confidence comes from restraint)
 *
 * This component enforces the structure via prop shape: exactly one
 * heading, one optional description (max ~30 chars), one CTA, and
 * one illustration slot. Multi-CTA / multi-tip patterns require a
 * different component (e.g. Card with header/body/footer composition).
 *
 * Sizes:
 *   - md: 9:16 / mobile-friendly compact
 *   - lg: full-bleed for first-run cold-start hero
 */

import { type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { Button } from './Button'

type Size = 'md' | 'lg'

export interface EmptyStateV2Props {
  /** Single illustration slot — pass a custom SVG or simple shape.
   *  AVOID: stock 3D renders, isometric humans, AI-generated mascots.
   *  PREFER: commissioned single-color line art, simple geometric
   *  primitives, or stylized icons. */
  illustration?: ReactNode
  /** Display-type heading. One line, ≤24 CJK chars. */
  heading: string
  /** Optional secondary line, ≤30 chars. Skip when possible. */
  description?: string
  /** Single primary CTA label. */
  ctaLabel?: string
  /** Single primary CTA handler. */
  onCta?: () => void
  /** Size variant. Default 'md'. */
  size?: Size
  className?: string
}

export function EmptyState({
  illustration,
  heading,
  description,
  ctaLabel,
  onCta,
  size = 'md',
  className,
}: EmptyStateV2Props) {
  const isLg = size === 'lg'

  const wrapperClasses = [
    'flex flex-col items-center justify-center text-center',
    isLg ? 'gap-6 px-8 py-20' : 'gap-4 px-6 py-12',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const headingClasses = [
    'font-medium text-text-primary',
    isLg
      ? 'text-[36px] leading-[1.1] tracking-[-0.02em]'
      : 'text-[24px] leading-[1.2]',
  ].join(' ')

  return (
    <div className={wrapperClasses} role="status" aria-live="polite">
      {illustration ? (
        <div
          aria-hidden="true"
          className={`text-[var(--process-cyan-strong)] ${isLg ? 'h-32 w-32' : 'h-20 w-20'} flex items-center justify-center`}
        >
          {illustration}
        </div>
      ) : (
        // Default minimal placeholder — a single-stroke square frame
        // sized to the cinema 9:16 aspect ratio, primary gold accent.
        // Replaces with commissioned line art when Phase 0.5 art lands.
        <DefaultPlaceholder size={isLg ? 'lg' : 'md'} />
      )}

      <div className="space-y-2">
        <h2 className={headingClasses}>{heading}</h2>
        {description ? (
          <p className="text-[14px] text-text-secondary">{description}</p>
        ) : null}
      </div>

      {ctaLabel && onCta ? (
        <Button
          variant="primary"
          size={isLg ? 'lg' : 'md'}
          onClick={onCta}
          className="mt-2"
        >
          {ctaLabel}
        </Button>
      ) : null}
    </div>
  )
}

function DefaultPlaceholder({ size }: { size: 'md' | 'lg' }) {
  const dimensionClass = size === 'lg' ? 'h-32 w-32' : 'h-20 w-20'
  return (
    <AppIcon
      name="clapperboard"
      aria-hidden="true"
      strokeWidth={1.25}
      className={`${dimensionClass} text-[var(--process-cyan-strong)]`}
    />
  )
}

'use client'

/**
 * Prompt bound-subject highlighting (2026-07-12, user request).
 *
 * A backdrop layer rendered UNDER the (transparent-background) prompt
 * textarea paints a colored rounded box behind every occurrence of a
 * bound subject name — so a pasted storyboard prompt visibly shows which
 * words actually bind. Matching comes from findElementNameMatches, which
 * mirrors the submit-time token replacement exactly: what lights up is
 * precisely what binds.
 *
 * The backdrop must keep IDENTICAL box metrics to the textarea (same
 * padding, border width, font, wrapping) or highlights drift — keep the
 * two class lists in VideoStudio in sync when touching either.
 */

import { useMemo, type RefObject } from 'react'
import { findElementNameMatches } from '@/lib/playground/element-tokens'

/** Translucent mark styles, one per subject (cycles past 6). */
export const ELEMENT_MARK_CLASSES = [
  'bg-amber-400/25 ring-1 ring-amber-400/60',
  'bg-violet-400/25 ring-1 ring-violet-400/60',
  'bg-emerald-400/25 ring-1 ring-emerald-400/60',
  'bg-sky-400/25 ring-1 ring-sky-400/60',
  'bg-rose-400/25 ring-1 ring-rose-400/60',
  'bg-lime-400/25 ring-1 ring-lime-400/60',
] as const

/** Solid dot styles matching ELEMENT_MARK_CLASSES by index. */
export const ELEMENT_DOT_CLASSES = [
  'bg-amber-400',
  'bg-violet-400',
  'bg-emerald-400',
  'bg-sky-400',
  'bg-rose-400',
  'bg-lime-400',
] as const

export function elementMarkClass(index: number): string {
  return ELEMENT_MARK_CLASSES[index % ELEMENT_MARK_CLASSES.length]
}

export function elementDotClass(index: number): string {
  return ELEMENT_DOT_CLASSES[index % ELEMENT_DOT_CLASSES.length]
}

interface PromptHighlightBackdropProps {
  prompt: string
  /** Bound subject names in BINDING ORDER (drives per-subject colors). */
  names: readonly string[]
  /** Ref for scroll-sync with the textarea (parent sets scrollTop). */
  backdropRef: RefObject<HTMLDivElement | null>
  /** Must reproduce the textarea's typography/box classes exactly. */
  className: string
}

export function PromptHighlightBackdrop({ prompt, names, backdropRef, className }: PromptHighlightBackdropProps) {
  const segments = useMemo(() => {
    const matches = findElementNameMatches(prompt, names)
    const parts: Array<{ text: string; markIndex: number | null }> = []
    let cursor = 0
    for (const m of matches) {
      if (m.start > cursor) parts.push({ text: prompt.slice(cursor, m.start), markIndex: null })
      parts.push({ text: prompt.slice(m.start, m.end), markIndex: m.nameIndex })
      cursor = m.end
    }
    if (cursor < prompt.length) parts.push({ text: prompt.slice(cursor), markIndex: null })
    return parts
  }, [prompt, names])

  return (
    <div ref={backdropRef} aria-hidden className={className}>
      {segments.map((seg, i) => (
        seg.markIndex === null ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <mark key={i} className={`rounded-[3px] box-decoration-clone text-transparent ${elementMarkClass(seg.markIndex)}`}>
            {seg.text}
          </mark>
        )
      ))}
      {/* trailing zero-width char keeps a final newline's height in sync */}
      {'​'}
    </div>
  )
}

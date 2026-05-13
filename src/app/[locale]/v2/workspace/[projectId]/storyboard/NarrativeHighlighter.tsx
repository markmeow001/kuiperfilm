'use client'

/**
 * Phase 12.5.4 — synced colored overlay for the segment-level narrative
 * editor.
 *
 * User pain point (2026-05-13): the cinematic narrative prompt contains
 * a mix of character refs, scene refs, and (soon) prop refs. Plain
 * monochrome text makes it hard to scan which entities are actually
 * bound. Three distinct colors per entity type let the editor see at a
 * glance "this paragraph mentions 王玄 + 洞府" without re-reading the
 * binding chips.
 *
 * Technique — synced overlay:
 *   1. A <pre> renders the value with entity spans (colored bg+fg) and
 *      sits absolutely positioned behind the textarea.
 *   2. The <textarea> sits on top with text-transparent + visible caret
 *      so the user edits text and sees the colored overlay through.
 *   3. Both layers share IDENTICAL font, size, leading, padding,
 *      border, and whitespace behaviour — any drift breaks alignment.
 *   4. Scroll events on the textarea are mirrored to the pre layer so
 *      long narratives stay aligned when scrolled.
 *
 * Layering note: the wrapper carries the visible bg + border. The pre
 * sits inside with transparent bg + transparent border. The textarea
 * also has transparent bg + transparent border (focus state is hoisted
 * to the wrapper via focus-within). This keeps the colored overlay
 * visible through the textarea instead of being painted over.
 *
 * Color scheme — must stay distinct under low-light editor theme:
 *   - characters → amber  (matches 出場角色 chip)
 *   - scenes     → emerald (matches 場景 chip)
 *   - props      → sky    (matches Stage 2 prop chip color)
 *
 * Entity matching:
 *   - Greedy longest-first to avoid e.g. "王玄" eating into "王玄Y"
 *   - Skip single-character names (length < 2). Worker also skips
 *     them in substituteImageRefs to avoid CJK substring collisions
 *     like 离 matching 离地半米.
 */

import { useEffect, useMemo, useRef } from 'react'

export interface NarrativeHighlighterProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
  rows: number
  placeholder?: string
  characterNames: string[]
  sceneNames: string[]
  propNames?: string[]
  flashing?: boolean
}

type EntityKind = 'character' | 'scene' | 'prop'

interface EntityToken {
  name: string
  kind: EntityKind
}

function classForKind(kind: EntityKind): string {
  switch (kind) {
    case 'character':
      return 'bg-amber-500/25 text-amber-200 rounded-sm px-0.5'
    case 'scene':
      return 'bg-emerald-500/25 text-emerald-200 rounded-sm px-0.5'
    case 'prop':
      return 'bg-sky-500/25 text-sky-200 rounded-sm px-0.5'
  }
}

interface Segment {
  text: string
  kind: EntityKind | null
}

function tokenize(value: string, tokens: EntityToken[]): Segment[] {
  if (tokens.length === 0 || value.length === 0) {
    return [{ text: value, kind: null }]
  }
  const sorted = [...tokens].sort((a, b) => b.name.length - a.name.length)
  const segments: Segment[] = []
  let cursor = 0
  while (cursor < value.length) {
    let matched: { token: EntityToken; index: number } | null = null
    let bestIndex = Number.POSITIVE_INFINITY
    for (const token of sorted) {
      const idx = value.indexOf(token.name, cursor)
      if (idx === -1) continue
      if (idx < bestIndex) {
        matched = { token, index: idx }
        bestIndex = idx
      }
    }
    if (!matched) {
      segments.push({ text: value.slice(cursor), kind: null })
      break
    }
    if (matched.index > cursor) {
      segments.push({ text: value.slice(cursor, matched.index), kind: null })
    }
    segments.push({ text: matched.token.name, kind: matched.token.kind })
    cursor = matched.index + matched.token.name.length
  }
  return segments
}

export function NarrativeHighlighter({
  textareaRef,
  value,
  onChange,
  rows,
  placeholder,
  characterNames,
  sceneNames,
  propNames,
  flashing,
}: NarrativeHighlighterProps) {
  const preRef = useRef<HTMLPreElement | null>(null)

  const tokens = useMemo<EntityToken[]>(() => {
    const out: EntityToken[] = []
    const seen = new Set<string>()
    const push = (name: string, kind: EntityKind) => {
      const t = name.trim()
      if (t.length < 2) return
      const key = `${kind}:${t.toLowerCase()}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ name: t, kind })
    }
    for (const n of characterNames) push(n, 'character')
    for (const n of sceneNames) push(n, 'scene')
    for (const n of propNames ?? []) push(n, 'prop')
    return out
  }, [characterNames, sceneNames, propNames])

  const segments = useMemo(() => tokenize(value, tokens), [value, tokens])

  useEffect(() => {
    const ta = textareaRef.current
    const pre = preRef.current
    if (!ta || !pre) return
    const sync = () => {
      pre.scrollTop = ta.scrollTop
      pre.scrollLeft = ta.scrollLeft
    }
    ta.addEventListener('scroll', sync)
    return () => ta.removeEventListener('scroll', sync)
  }, [textareaRef])

  // Wrapper owns the visible bg + border. Inner layers (pre, textarea)
  // are transparent so the colored overlay can shine through. Focus
  // state is hoisted to the wrapper via focus-within.
  const wrapperClasses = [
    'relative w-full rounded-sm border bg-stone-900/40 transition-colors',
    'focus-within:border-amber-500/40',
    flashing ? 'border-emerald-400/60 ring-2 ring-emerald-400/60' : 'border-stone-800',
  ].join(' ')

  // Both layers MUST share these classes verbatim. Padding/font/leading
  // drift = overlay misalignment, which is the whole failure mode.
  const sharedTypography =
    'font-serif-cn text-[12px] leading-relaxed whitespace-pre-wrap break-words'
  const sharedPadding = 'p-2.5'

  return (
    <div className={wrapperClasses}>
      <pre
        ref={preRef}
        aria-hidden="true"
        className={`${sharedTypography} ${sharedPadding} pointer-events-none absolute inset-0 m-0 overflow-hidden text-stone-200`}
      >
        {value.length === 0 ? (
          <span className="text-stone-600">{placeholder ?? ''}</span>
        ) : (
          segments.map((seg, i) =>
            seg.kind ? (
              <span key={i} className={classForKind(seg.kind)}>
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )
        )}
        {/* Trailing newline so pre height matches textarea when the
            user's last keystroke is Enter (otherwise pre shrinks by
            one line vs textarea). */}
        {'\n'}
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={value.length === 0 ? undefined : placeholder}
        spellCheck={false}
        className={`${sharedTypography} ${sharedPadding} relative w-full resize-y border-0 bg-transparent text-transparent caret-stone-100 outline-none`}
      />
    </div>
  )
}

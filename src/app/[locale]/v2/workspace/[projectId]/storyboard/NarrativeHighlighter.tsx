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

// Phase V (2026-05-28) — DROPPED px-0.5 from token spans.
//
// User report: clicking at the visual end of a line ending with 。 put
// the caret BEFORE the 。 instead of after. Root cause: the synced
// overlay technique requires the textarea and the pre to render text
// at IDENTICAL pixel positions. Token spans had `px-0.5` (2px L/R)
// which pushed every character AFTER an entity name (e.g. Kent) right
// by 4px in the colored pre layer — but the textarea below had no
// such padding, so its 。 sat 4px to the left of where the user saw
// it. Browsers hit-test against the textarea's text positions, so
// clicking visually-at-the-end-of-。 landed on the textarea's 「.」
// glyph's left-half (since textarea's 。 is 4px left of where the user
// thought it was), producing caret-before-。.
//
// The fix is to drop padding entirely so highlight bg sits tight
// against the entity text, no horizontal width drift. Slight visual
// loss (pills are tighter) but caret reliability is more important
// than chip aesthetics here.
function classForKind(kind: EntityKind): string {
  switch (kind) {
    case 'character':
      return 'bg-primary-500/25 text-primary-200 rounded-sm'
    case 'scene':
      return 'bg-emerald-500/25 text-emerald-200 rounded-sm'
    case 'prop':
      return 'bg-sky-500/25 text-sky-200 rounded-sm'
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
  // Case-insensitive matching (2026-05-28): users type "@vera" but the
  // roster name is "Vera". Match against a lowercased haystack, but slice
  // the ORIGINAL `value` for display so the chip covers the as-typed text
  // and casing is preserved. Mirrors the worker's case-insensitive
  // rawPrompt name-mining so what highlights here is what binds at gen.
  const haystack = value.toLowerCase()
  const segments: Segment[] = []
  let cursor = 0
  while (cursor < value.length) {
    let matched: { token: EntityToken; index: number } | null = null
    let bestIndex = Number.POSITIVE_INFINITY
    for (const token of sorted) {
      const idx = haystack.indexOf(token.name.toLowerCase(), cursor)
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
    // token.name.length === its lowercase length (Latin/CJK), so the span
    // is correct; slice the original to keep the user's casing on screen.
    const matchLen = matched.token.name.length
    segments.push({ text: value.slice(matched.index, matched.index + matchLen), kind: matched.token.kind })
    cursor = matched.index + matchLen
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

  // Wrapper owns the visible bg + "border". Inner layers (pre, textarea)
  // are transparent so the colored overlay can shine through. Focus
  // state is hoisted to the wrapper via focus-within.
  //
  // Phase V (2026-05-28) caret-alignment rewrite — the previous wrapper
  // used `border` (1px solid). Because pre was `absolute inset-0` it
  // overlapped the wrapper's border-box, while textarea was `relative
  // w-full` so its width subtracted the wrapper's 2px border (1px each
  // side). Net: textarea text rendered 1px to the right of pre text,
  // accumulating into multi-character caret drift over a few lines.
  // Switched to `ring-1 ring-inset` which is implemented as box-shadow
  // (does NOT participate in layout) — both pre and textarea now sit
  // identically inside the same border-box.
  const wrapperClasses = [
    'relative w-full rounded-sm bg-raised/40 transition-colors',
    'ring-1 ring-inset ring-border-soft focus-within:ring-primary-500/40',
    flashing ? 'ring-2 ring-emerald-400/60' : '',
  ].join(' ')

  // Both layers MUST share these classes verbatim. Padding/font/leading
  // drift = overlay misalignment, which is the whole failure mode.
  const sharedTypography =
    'font-serif-cn text-[12px] leading-relaxed whitespace-pre-wrap break-words'
  const sharedPadding = 'p-2.5'

  // Phase V (2026-05-28) — force identical layout/rendering pipeline.
  // - scrollbarGutter 'stable' reserves scrollbar space on BOTH layers
  //   so textarea narrowing-by-scrollbar can't drift content width vs
  //   pre. Critical for long narratives where the textarea scrollbar
  //   appears and silently shifts wrap positions by ~15px.
  // - fontKerning + fontFeatureSettings nail down CJK glyph spacing so
  //   the UA defaults for <pre> (often monospace-ish) and <textarea>
  //   (often system-ui) can't produce divergent character widths.
  // - boxSizing border-box is also Tailwind preflight default; declared
  //   here to be explicit in case the preflight is overridden.
  // Inline style wins over class so both synchronized layers use the same
    // Shared Kuiper UI font metrics on every route and device.
  const sharedSyncStyle: React.CSSProperties = {
    scrollbarGutter: 'stable',
    fontKerning: 'normal',
    fontFeatureSettings: 'normal',
    boxSizing: 'border-box',
    fontFamily:
      "var(--font-kuiper-sans), 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif",
    // Lock font metrics so subpixel rounding in pre vs textarea can't
    // diverge — both should rasterize CJK glyphs to identical positions.
    fontVariantEastAsian: 'normal',
    letterSpacing: 'normal',
    wordSpacing: 'normal',
    textRendering: 'auto',
  }

  return (
    <div className={wrapperClasses}>
      <pre
        ref={preRef}
        aria-hidden="true"
        className={`${sharedTypography} ${sharedPadding} pointer-events-none absolute inset-0 m-0 overflow-y-auto overflow-x-hidden text-text-primary`}
        style={sharedSyncStyle}
      >
        {value.length === 0 ? (
          <span className="text-text-tertiary">{placeholder ?? ''}</span>
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
        className={`${sharedTypography} ${sharedPadding} relative w-full resize-y border-0 bg-transparent text-transparent caret-text-primary outline-none`}
        style={sharedSyncStyle}
      />
    </div>
  )
}

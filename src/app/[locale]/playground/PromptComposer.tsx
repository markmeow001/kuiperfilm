'use client'

/**
 * Prompt composer (2026-07-12 adaptive left column) — the prompt textarea
 * with its bound-name highlight backdrop plus an @-mention menu: typing
 * `@` pops a candidate strip under the textarea (bound subjects / media
 * tokens per model family); clicking inserts at the caret. Also hosts the
 * collapsible 參考文字 row so the left column stays short.
 */

import { useMemo, useRef, useState } from 'react'
import { PromptHighlightBackdrop, elementDotClass } from './PromptHighlight'
import type { PlaygroundController } from './usePlaygroundController'

/** One @-menu entry. `insert` is what lands after the user's typed `@`. */
export interface AtMenuCandidate {
  label: string
  insert: string
  /** Highlight palette index for bound subjects; null = plain token. */
  colorIndex: number | null
}

// Backdrop box metrics MUST mirror the textarea's or the marks drift.
const PROMPT_TYPO = 'p-3 text-[14px] leading-relaxed whitespace-pre-wrap break-words'

/**
 * Measure the pixel position of a caret offset inside a textarea via a
 * throwaway mirror div (the standard textarea-caret-position technique):
 * clone the typography-affecting computed styles, fill text up to the
 * caret, and read a marker span's offset. Returns coordinates relative to
 * the textarea's border box (scroll NOT yet subtracted).
 */
function measureCaret(ta: HTMLTextAreaElement, caret: number): { top: number; left: number; lineHeight: number } {
  const mirror = document.createElement('div')
  const style = window.getComputedStyle(ta)
  for (const prop of [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'textIndent', 'wordBreak', 'overflowWrap',
  ] as const) {
    mirror.style[prop] = style[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.width = `${ta.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`
  mirror.textContent = ta.value.slice(0, caret)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const top = marker.offsetTop
  const left = marker.offsetLeft
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
  document.body.removeChild(mirror)
  return { top, left, lineHeight }
}

interface PromptComposerProps {
  ctrl: PlaygroundController
  candidates: AtMenuCandidate[]
  boundNames: readonly string[]
  onSubmitShortcut: () => void
}

export function PromptComposer({ ctrl, candidates, boundNames, onSubmitShortcut }: PromptComposerProps) {
  const { prompt, setPrompt, promptRef, refText, setRefText, isBusy } = ctrl
  const highlightRef = useRef<HTMLDivElement | null>(null)
  const [atMenuOpen, setAtMenuOpen] = useState(false)
  // Caret-anchored menu position (px, relative to the wrapper). null while
  // closed; recomputed on every open so it tracks wherever @ was typed.
  const [atMenuPos, setAtMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [refTextOpen, setRefTextOpen] = useState(false)

  const showRefText = refTextOpen || refText.trim().length > 0

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onSubmitShortcut()
      return
    }
    if (e.key === 'Escape') setAtMenuOpen(false)
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const ta = e.target
    const next = ta.value
    // Open the menu when the char just typed at the caret is '@'.
    const caret = ta.selectionStart ?? next.length
    if (candidates.length > 0 && caret > 0 && next[caret - 1] === '@' && next.length > prompt.length) {
      // Anchor the menu right under the caret (2026-07-13 fix — it used to
      // dock under the whole textarea, far from where @ was typed). Mirror
      // measurement is border-box relative; subtract scrollTop for the
      // visible position and clamp inside the wrapper width.
      const { top, left, lineHeight } = measureCaret(ta, caret)
      const menuWidth = 240
      setAtMenuPos({
        top: Math.max(0, top - ta.scrollTop + lineHeight + 4),
        left: Math.min(Math.max(0, left - 8), Math.max(0, ta.clientWidth - menuWidth)),
      })
      setAtMenuOpen(true)
    } else if (atMenuOpen && !next.includes('@')) {
      setAtMenuOpen(false)
    }
    setPrompt(next)
  }

  function pickCandidate(c: AtMenuCandidate) {
    const ta = promptRef.current
    setAtMenuOpen(false)
    if (!ta) {
      setPrompt((prev: string) => `${prev}${c.insert} `)
      return
    }
    const caret = ta.selectionStart ?? prompt.length
    // The user just typed '@' — the insert lands right after it (the @ is
    // swallowed on submit for subject names, and @imageN tokens carry it).
    const before = prompt.slice(0, caret)
    const after = prompt.slice(caret)
    const insert = `${c.insert} `
    setPrompt(before + insert + after)
    setTimeout(() => {
      ta.focus()
      const pos = caret + insert.length
      ta.setSelectionRange(pos, pos)
    }, 0)
  }

  const scrollSync = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) highlightRef.current.scrollTop = e.currentTarget.scrollTop
  }

  const placeholder = useMemo(() => (
    candidates.length > 0
      ? '描述影片場景與動作… 打 @ 引用綁定的主體 / 素材'
      : '描述你想生成的影片場景與動作…'
  ), [candidates.length])

  return (
    <div className="mb-4">
      <div className="relative rounded-lg bg-stone-950/60">
        {boundNames.length > 0 ? (
          <PromptHighlightBackdrop
            prompt={prompt}
            names={boundNames}
            backdropRef={highlightRef}
            className={`pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent text-transparent ${PROMPT_TYPO}`}
          />
        ) : null}
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onScroll={scrollSync}
          onBlur={() => setTimeout(() => setAtMenuOpen(false), 150)}
          rows={9}
          placeholder={placeholder}
          className={`relative min-h-[140px] w-full resize-y rounded-lg border border-stone-800 bg-transparent text-stone-200 outline-none focus:border-amber-500/40 ${PROMPT_TYPO}`}
        />
        {atMenuOpen && candidates.length > 0 ? (
          <div
            className="absolute z-30 flex w-[240px] flex-wrap gap-1.5 rounded-md border border-stone-700 bg-stone-900 p-2 shadow-xl"
            style={atMenuPos ? { top: atMenuPos.top, left: atMenuPos.left } : { top: '100%', left: 0 }}
          >
            {candidates.map((c) => (
              <button
                type="button"
                key={c.label}
                onMouseDown={(e) => { e.preventDefault(); pickCandidate(c) }}
                className="flex items-center gap-1.5 rounded-sm border border-stone-700 px-2 py-1 font-mono text-[11px] text-stone-300 hover:border-amber-500/60 hover:text-amber-300"
              >
                {c.colorIndex !== null ? (
                  <span className={`h-2 w-2 rounded-full ${elementDotClass(c.colorIndex)}`} />
                ) : null}
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 參考文字 — collapsed into a fold so the column stays short. */}
      {showRefText ? (
        <div className="mt-2">
          <input
            type="text"
            value={refText}
            onChange={(e) => setRefText(e.target.value)}
            disabled={isBusy}
            placeholder="風格 / 旁白 / 隱喻 等補充…"
            className="w-full rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-2 text-[13px] text-stone-300 outline-none placeholder:text-stone-600 focus:border-amber-500/40"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRefTextOpen(true)}
          className="mt-1 font-mono text-[11px] text-stone-600 hover:text-stone-400"
        >
          ＋ 參考文字（選填）
        </button>
      )}
    </div>
  )
}

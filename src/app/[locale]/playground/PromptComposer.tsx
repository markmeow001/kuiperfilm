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
    const next = e.target.value
    // Open the menu when the char just typed at the caret is '@'.
    const caret = e.target.selectionStart ?? next.length
    if (candidates.length > 0 && caret > 0 && next[caret - 1] === '@' && next.length > prompt.length) {
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
          <div className="absolute inset-x-0 top-full z-30 mt-1 flex flex-wrap gap-1.5 rounded-md border border-stone-700 bg-stone-900 p-2 shadow-xl">
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

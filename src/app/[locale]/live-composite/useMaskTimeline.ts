'use client'

import { useMemo, useState } from 'react'
import { applyMaskToEnd, applyMaskToStart, createMaskKeyframeFromCurrent, findExactMaskKeyframe, mergeAiMaskKeyframes, removeMaskKeyframe, resolveMaskKeyframe, upsertMaskKeyframe } from './lib/mask-keyframes'
import type { MaskKeyframe, MaskRaster, MaskStroke } from './live-composite-types'

interface TimelineSnapshot {
  keyframes: MaskKeyframe[]
}

interface TimelineState {
  keyframes: MaskKeyframe[]
  past: TimelineSnapshot[]
  future: TimelineSnapshot[]
}

const makeInitialKeyframes = (): MaskKeyframe[] => [{ id: 'mask-keyframe-0', time: 0, strokes: [] }]

const makeInitialState = (): TimelineState => ({ keyframes: makeInitialKeyframes(), past: [], future: [] })

export function useMaskTimeline(currentTime: number) {
  const [state, setState] = useState<TimelineState>(makeInitialState)
  const { keyframes, past, future } = state

  const resolved = useMemo(() => resolveMaskKeyframe(keyframes, currentTime), [currentTime, keyframes])
  const exact = useMemo(() => findExactMaskKeyframe(keyframes, currentTime), [currentTime, keyframes])

  // Every mutation computes the next keyframes from the CURRENT state inside a
  // functional update. Long-running flows (e.g. an AI scan holding a stale
  // `applyAiMasks` reference) therefore merge against the latest keyframes and
  // can never wipe edits made while they were in flight. Undo/redo history is
  // kept in the same state object so snapshots stay consistent with keyframes.
  const commit = (update: (current: MaskKeyframe[]) => MaskKeyframe[]) => {
    setState((current) => {
      const next = update(current.keyframes)
      if (next === current.keyframes) return current
      return {
        keyframes: next,
        past: [...current.past, { keyframes: current.keyframes }],
        future: [],
      }
    })
  }

  return {
    keyframes,
    activeKeyframe: resolved,
    exactKeyframe: exact,
    strokes: resolved?.strokes ?? [],
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    reset: () => setState(makeInitialState()),
    // Replace the whole timeline with persisted keyframes (project load).
    // History is intentionally cleared — undo must not cross a project load.
    load: (loaded: MaskKeyframe[]) => {
      if (loaded.length === 0) throw new Error('載入的遮罩時間軸是空的')
      setState({ keyframes: [...loaded].sort((a, b) => a.time - b.time), past: [], future: [] })
    },
    addKeyframe: () => commit((current) => createMaskKeyframeFromCurrent(current, currentTime, () => crypto.randomUUID())),
    deleteKeyframe: () => commit((current) => {
      const exactNow = findExactMaskKeyframe(current, currentTime)
      return exactNow ? removeMaskKeyframe(current, exactNow.id) : current
    }),
    commitStroke: (stroke: MaskStroke) => commit((current) => {
      const resolvedNow = resolveMaskKeyframe(current, currentTime)
      return upsertMaskKeyframe(current, currentTime, [...(resolvedNow?.strokes ?? []), stroke], () => crypto.randomUUID(), resolvedNow?.baseMask)
    }),
    applyAiMasks: (frames: Array<{ time: number; mask: MaskRaster }>) => {
      commit((current) => mergeAiMaskKeyframes(current, frames, () => crypto.randomUUID()))
    },
    clearCurrent: () => commit((current) => {
      const resolvedNow = resolveMaskKeyframe(current, currentTime)
      return upsertMaskKeyframe(current, currentTime, [], () => crypto.randomUUID(), resolvedNow?.baseMask)
    }),
    applyToStart: () => commit((current) => {
      const resolvedNow = resolveMaskKeyframe(current, currentTime)
      return applyMaskToStart(current, currentTime, resolvedNow?.strokes ?? [], () => crypto.randomUUID(), resolvedNow?.baseMask)
    }),
    applyToEnd: () => commit((current) => {
      const resolvedNow = resolveMaskKeyframe(current, currentTime)
      return applyMaskToEnd(current, currentTime, resolvedNow?.strokes ?? [], () => crypto.randomUUID(), resolvedNow?.baseMask)
    }),
    undo: () => setState((current) => {
      const previous = current.past.at(-1)
      if (!previous) return current
      return {
        keyframes: previous.keyframes,
        past: current.past.slice(0, -1),
        future: [{ keyframes: current.keyframes }, ...current.future],
      }
    }),
    redo: () => setState((current) => {
      const next = current.future[0]
      if (!next) return current
      return {
        keyframes: next.keyframes,
        past: [...current.past, { keyframes: current.keyframes }],
        future: current.future.slice(1),
      }
    }),
  }
}

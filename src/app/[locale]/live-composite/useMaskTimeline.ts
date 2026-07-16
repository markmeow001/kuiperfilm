'use client'

import { useMemo, useState } from 'react'
import { applyMaskToEnd, applyMaskToStart, createMaskKeyframeFromCurrent, findExactMaskKeyframe, mergeAiMaskKeyframes, removeMaskKeyframe, resolveMaskKeyframe, upsertMaskKeyframe } from './lib/mask-keyframes'
import type { MaskKeyframe, MaskRaster, MaskStroke } from './live-composite-types'

interface TimelineSnapshot {
  keyframes: MaskKeyframe[]
}

const makeInitialKeyframes = (): MaskKeyframe[] => [{ id: 'mask-keyframe-0', time: 0, strokes: [] }]

export function useMaskTimeline(currentTime: number) {
  const [keyframes, setKeyframes] = useState<MaskKeyframe[]>(makeInitialKeyframes)
  const [past, setPast] = useState<TimelineSnapshot[]>([])
  const [future, setFuture] = useState<TimelineSnapshot[]>([])

  const resolved = useMemo(() => resolveMaskKeyframe(keyframes, currentTime), [currentTime, keyframes])
  const exact = useMemo(() => findExactMaskKeyframe(keyframes, currentTime), [currentTime, keyframes])

  const commit = (next: MaskKeyframe[]) => {
    if (next === keyframes) return
    setPast((history) => [...history, { keyframes }])
    setKeyframes(next)
    setFuture([])
  }

  return {
    keyframes,
    activeKeyframe: resolved,
    exactKeyframe: exact,
    strokes: resolved?.strokes ?? [],
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    reset: () => {
      setKeyframes(makeInitialKeyframes())
      setPast([])
      setFuture([])
    },
    addKeyframe: () => commit(createMaskKeyframeFromCurrent(keyframes, currentTime, () => crypto.randomUUID())),
    deleteKeyframe: () => {
      if (!exact) return
      commit(removeMaskKeyframe(keyframes, exact.id))
    },
    commitStroke: (stroke: MaskStroke) => {
      const inherited = resolved?.strokes ?? []
      commit(upsertMaskKeyframe(keyframes, currentTime, [...inherited, stroke], () => crypto.randomUUID(), resolved?.baseMask))
    },
    applyAiMasks: (frames: Array<{ time: number; mask: MaskRaster }>) => {
      commit(mergeAiMaskKeyframes(keyframes, frames, () => crypto.randomUUID()))
    },
    clearCurrent: () => commit(upsertMaskKeyframe(keyframes, currentTime, [], () => crypto.randomUUID(), resolved?.baseMask)),
    applyToStart: () => commit(applyMaskToStart(keyframes, currentTime, resolved?.strokes ?? [], () => crypto.randomUUID(), resolved?.baseMask)),
    applyToEnd: () => commit(applyMaskToEnd(keyframes, currentTime, resolved?.strokes ?? [], () => crypto.randomUUID(), resolved?.baseMask)),
    undo: () => {
      const previous = past.at(-1)
      if (!previous) return
      setPast(past.slice(0, -1))
      setFuture((history) => [{ keyframes }, ...history])
      setKeyframes(previous.keyframes)
    },
    redo: () => {
      const next = future[0]
      if (!next) return
      setFuture(future.slice(1))
      setPast((history) => [...history, { keyframes }])
      setKeyframes(next.keyframes)
    },
  }
}

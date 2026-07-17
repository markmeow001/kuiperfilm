import type { Edge, Node } from '@xyflow/react'
import type { CanvasNodeData } from './canvas-types'

export interface CanvasSnapshot {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
}

export interface CanvasHistoryState {
  past: CanvasSnapshot[]
  future: CanvasSnapshot[]
}

export const EMPTY_CANVAS_HISTORY: CanvasHistoryState = { past: [], future: [] }
const HISTORY_LIMIT = 50

export function cloneCanvasSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return structuredClone(snapshot)
}

export function recordCanvasSnapshot(
  history: CanvasHistoryState,
  current: CanvasSnapshot,
): CanvasHistoryState {
  return {
    past: [...history.past.slice(-(HISTORY_LIMIT - 1)), cloneCanvasSnapshot(current)],
    future: [],
  }
}

export function undoCanvasSnapshot(
  history: CanvasHistoryState,
  current: CanvasSnapshot,
): { history: CanvasHistoryState; snapshot: CanvasSnapshot | null } {
  const previous = history.past.at(-1)
  if (!previous) return { history, snapshot: null }
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [cloneCanvasSnapshot(current), ...history.future],
    },
    snapshot: cloneCanvasSnapshot(previous),
  }
}

export function redoCanvasSnapshot(
  history: CanvasHistoryState,
  current: CanvasSnapshot,
): { history: CanvasHistoryState; snapshot: CanvasSnapshot | null } {
  const next = history.future[0]
  if (!next) return { history, snapshot: null }
  return {
    history: {
      past: [...history.past, cloneCanvasSnapshot(current)],
      future: history.future.slice(1),
    },
    snapshot: cloneCanvasSnapshot(next),
  }
}

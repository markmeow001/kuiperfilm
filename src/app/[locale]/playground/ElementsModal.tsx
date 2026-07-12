'use client'

/**
 * Elements modal (2026-07-12 adaptive left column) — the Kling 主體綁定
 * manager moved out of the left column into a dialog behind the
 * `[@ Elements (N/6)]` button (Higgsfield-style), so the column stays
 * short. Content is the existing ElementBindingsPanel unchanged.
 */

import { ElementBindingsPanel } from './ElementBindingsPanel'
import type { PlaygroundController } from './usePlaygroundController'

interface ElementsModalProps {
  ctrl: PlaygroundController
  open: boolean
  onClose: () => void
}

export function ElementsModal({ ctrl, open, onClose }: ElementsModalProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-stone-700 bg-stone-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[12px] uppercase tracking-wider text-stone-400">主體綁定（Elements）</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-stone-700 px-2 py-0.5 font-mono text-[11px] text-stone-400 hover:border-amber-500/60 hover:text-amber-300"
          >
            完成
          </button>
        </div>
        <ElementBindingsPanel ctrl={ctrl} />
      </div>
    </div>
  )
}

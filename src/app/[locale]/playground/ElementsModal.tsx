'use client'

/**
 * Elements modal (2026-07-12 adaptive left column) — the Kling 主體綁定
 * manager moved out of the left column into a dialog behind the
 * `[@ Elements (N/6)]` button (Higgsfield-style), so the column stays
 * short. Content is the existing ElementBindingsPanel unchanged.
 */

import { ElementBindingsPanel } from './ElementBindingsPanel'
import { useTranslations } from 'next-intl'
import type { PlaygroundController } from './usePlaygroundController'

interface ElementsModalProps {
  ctrl: PlaygroundController
  open: boolean
  onClose: () => void
}

export function ElementsModal({ ctrl, open, onClose }: ElementsModalProps) {
  const t = useTranslations('playground.video')
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="playground-elements-modal-title"
        className="max-h-[calc(100dvh-24px)] w-full max-w-md overflow-y-auto rounded-xl border border-white/[0.1] bg-overlay p-4 shadow-2xl [&_a]:min-h-11 [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="playground-elements-modal-title" className="font-mono text-[12px] tracking-wider text-text-secondary">{t('elementModalTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('elementModalClose')}
            className="min-h-11 min-w-11 rounded-lg border border-white/[0.12] px-3 font-mono text-[11px] text-text-secondary hover:border-primary-500/60 hover:text-primary-300"
          >
            {t('elementModalDone')}
          </button>
        </div>
        <ElementBindingsPanel ctrl={ctrl} />
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type {
  CandidateRegenerationSeedMode,
  CastingCandidateView,
} from './visual-development-types'
import { CandidatePromptControlModal } from './CandidatePromptControlModal'

interface CandidatePromptEditorProps {
  candidate: CastingCandidateView
  mediaType?: 'image' | 'video'
  disabled?: boolean
  isRegenerating: boolean
  onRegenerate: (
    candidateId: string,
    prompt: string,
    seedMode: CandidateRegenerationSeedMode,
  ) => void
}

export function CandidatePromptEditor({
  candidate,
  mediaType = 'image',
  disabled = false,
  isRegenerating,
  onRegenerate,
}: CandidatePromptEditorProps) {
  const t = useTranslations('visualDevelopment.workspace.candidatePrompt')
  const currentPrompt = candidate.prompt ?? ''
  const [draft, setDraft] = useState(currentPrompt)
  const [seedMode, setSeedMode] = useState<CandidateRegenerationSeedMode>('new')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => setDraft(currentPrompt), [candidate.id, currentPrompt])

  const hasPrompt = currentPrompt.trim().length > 0

  if (!hasPrompt) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-2 border-t border-white/[0.07] bg-black/[0.18] px-3 py-2.5 text-left transition-colors hover:bg-primary-500/[0.045] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary-500/60"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary-500/20 bg-primary-500/[0.07] text-primary-400">
          <AppIcon name="sliders" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[8px] tracking-[0.13em] text-primary-300">{t('panelButton')}</span>
          <span className="mt-0.5 block font-serif-cn text-[8px] text-text-tertiary">{t('panelButtonHint')}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[7px] text-text-tertiary">
          {t('versions', { count: (candidate.history?.length ?? 0) + 1 })}
          <AppIcon name="chevronRight" className="h-3 w-3" />
        </span>
      </button>

      <CandidatePromptControlModal
        candidate={candidate}
        mediaType={mediaType}
        open={isOpen}
        onClose={() => setIsOpen(false)}
        draft={draft}
        onDraftChange={setDraft}
        onReset={() => setDraft(currentPrompt)}
        seedMode={seedMode}
        onSeedModeChange={setSeedMode}
        disabled={disabled}
        isRegenerating={isRegenerating}
        onRegenerate={() => onRegenerate(candidate.id, draft.trim(), seedMode)}
      />
    </>
  )
}

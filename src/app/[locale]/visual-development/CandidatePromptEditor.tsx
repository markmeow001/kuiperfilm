'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type {
  CandidateRegenerationSeedMode,
  CastingCandidateView,
} from './visual-development-types'
import { VisualDevelopmentImage } from './VisualDevelopmentImage'

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
  const originPrompt = candidate.originPrompt ?? currentPrompt
  const [draft, setDraft] = useState(currentPrompt)
  const [seedMode, setSeedMode] = useState<CandidateRegenerationSeedMode>('new')
  const [copied, setCopied] = useState(false)

  useEffect(() => setDraft(currentPrompt), [candidate.id, currentPrompt])

  const history = candidate.history ?? []
  const hasPrompt = currentPrompt.trim().length > 0
  const generationActive = candidate.taskStatus === 'queued'
    || candidate.taskStatus === 'processing'
    || candidate.taskStatus === 'regenerating'
  const canSubmit = hasPrompt
    && draft.trim().length > 0
    && !disabled
    && !generationActive
    && !isRegenerating
  const promptChanged = useMemo(
    () => draft.trim() !== currentPrompt.trim(),
    [currentPrompt, draft],
  )

  if (!hasPrompt) return null

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      window.alert(t('copyFailed'))
    }
  }

  return (
    <details className="group/prompt border-t border-white/[0.07] bg-black/[0.18]">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5 marker:hidden">
        <AppIcon name="edit" className="mt-0.5 h-3 w-3 shrink-0 text-primary-400" />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[7px] tracking-[0.13em] text-primary-300">{t('originalTitle')}</span>
          <span className="mt-1 block line-clamp-2 font-serif-cn text-[9px] leading-4 text-text-tertiary">
            {originPrompt}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[7px] text-text-tertiary">
          {history.length > 0 ? t('versions', { count: history.length + 1 }) : t('expand')}
          <AppIcon name="chevronDown" className="h-3 w-3 transition-transform group-open/prompt:rotate-180" />
        </span>
      </summary>

      <div className="space-y-3 border-t border-white/[0.06] px-3 pb-3 pt-3">
        <section>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[7px] tracking-[0.12em] text-text-tertiary">{t('originalTitle')}</span>
            <span className="rounded border border-white/[0.07] px-1.5 py-0.5 font-mono text-[6px] tracking-[0.1em] text-text-tertiary">{t('readOnly')}</span>
          </div>
          <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-black/25 p-2 font-serif-cn text-[9px] leading-4 text-text-secondary">
            {originPrompt}
          </pre>
        </section>

        <label className="block">
          <span className="font-mono text-[7px] tracking-[0.12em] text-primary-300">{t('regenerateTitle')}</span>
          <textarea
            rows={7}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={disabled || generationActive || isRegenerating}
            className="mt-1.5 w-full resize-y rounded-lg border border-white/[0.09] bg-[#09090c] p-2 font-serif-cn text-[9px] leading-4 text-white outline-none focus:border-primary-500/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>

        {candidate.seedStatus === 'applied' && (
          <label className="block">
            <span className="font-mono text-[7px] tracking-[0.12em] text-text-tertiary">{t('seedMode')}</span>
            <select
              value={seedMode}
              onChange={(event) => setSeedMode(event.target.value as CandidateRegenerationSeedMode)}
              disabled={disabled || generationActive || isRegenerating}
              className="mt-1.5 h-8 w-full rounded-lg border border-white/[0.09] bg-[#09090c] px-2 text-[9px] text-white outline-none focus:border-primary-500/50"
            >
              <option value="new">{t('newSeed')}</option>
              <option value="reuse">{t('reuseSeed')}</option>
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => void copyPrompt()} className="flex h-7 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.035] px-2 text-[8px] text-text-secondary hover:text-white">
            <AppIcon name="copy" className="h-3 w-3" />
            {copied ? t('copied') : t('copy')}
          </button>
          <button type="button" disabled={!promptChanged || isRegenerating} onClick={() => setDraft(currentPrompt)} className="h-7 rounded-md border border-white/[0.08] bg-white/[0.035] px-2 text-[8px] text-text-secondary disabled:opacity-35">
            {t('reset')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onRegenerate(candidate.id, draft.trim(), seedMode)}
            className="ml-auto flex h-7 items-center gap-1 rounded-md bg-primary-500 px-2.5 text-[8px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
          >
            <AppIcon name="refresh" className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} />
            {isRegenerating ? t('regenerating') : t('regenerateOne')}
          </button>
        </div>

        {disabled && (
          <p className="rounded-lg border border-amber-300/15 bg-amber-300/[0.045] px-2 py-1.5 font-serif-cn text-[8px] leading-4 text-amber-100/70">
            {t('canonLockedHint')}
          </p>
        )}

        {history.length > 0 && (
          <section className="border-t border-white/[0.06] pt-3">
            <div className="flex items-center gap-1.5 font-mono text-[7px] tracking-[0.12em] text-text-tertiary">
              <AppIcon name="clock" className="h-3 w-3" />
              {t('historyTitle')}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {history.map((revision, index) => (
                <div key={revision.taskId} className="min-w-0">
                  <div className="aspect-square overflow-hidden rounded-md border border-white/[0.08] bg-[#111116]">
                    {revision.resultUrl ? mediaType === 'video' ? (
                      <video src={revision.resultUrl} controls playsInline className="h-full w-full object-cover" />
                    ) : (
                      <VisualDevelopmentImage src={revision.resultUrl} alt={`${candidate.code} v${history.length - index}`} />
                    ) : (
                      <div className="flex h-full items-center justify-center font-mono text-[6px] text-text-tertiary">{revision.taskStatus}</div>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-[6px] text-text-tertiary">
                    v{history.length - index} · {revision.requestedSeed ? revision.requestedSeed : 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </details>
  )
}

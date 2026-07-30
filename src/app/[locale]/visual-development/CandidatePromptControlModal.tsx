'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/v2/Modal'
import { AppIcon } from '@/components/ui/icons'
import type {
  CandidateRegenerationSeedMode,
  CastingCandidateView,
} from './visual-development-types'

interface CandidatePromptControlModalProps {
  candidate: CastingCandidateView
  mediaType: 'image' | 'video'
  open: boolean
  onClose: () => void
  draft: string
  onDraftChange: (value: string) => void
  onReset: () => void
  seedMode: CandidateRegenerationSeedMode
  onSeedModeChange: (value: CandidateRegenerationSeedMode) => void
  disabled: boolean
  isRegenerating: boolean
  onRegenerate: () => void
}

function metadataValue(value: string | number | null | undefined, fallback: string): string {
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function CandidatePromptControlModal({
  candidate,
  mediaType,
  open,
  onClose,
  draft,
  onDraftChange,
  onReset,
  seedMode,
  onSeedModeChange,
  disabled,
  isRegenerating,
  onRegenerate,
}: CandidatePromptControlModalProps) {
  const t = useTranslations('visualDevelopment.workspace.candidatePrompt')
  const [copied, setCopied] = useState(false)
  const currentPrompt = candidate.prompt ?? ''
  const originPrompt = candidate.originPrompt ?? currentPrompt
  const history = candidate.history ?? []
  const latestHistory = history.at(-1)
  const generationActive = candidate.taskStatus === 'queued'
    || candidate.taskStatus === 'processing'
    || candidate.taskStatus === 'regenerating'
  const canSubmit = draft.trim().length > 0
    && !disabled
    && !generationActive
    && !isRegenerating
  const promptChanged = draft.trim() !== currentPrompt.trim()
  const notAvailable = t('notAvailable')
  const model = candidate.modelKey
    ?? candidate.modelId
    ?? latestHistory?.modelKey
    ?? latestHistory?.modelId
  const aspectRatio = candidate.aspectRatio ?? latestHistory?.aspectRatio
  const resolution = candidate.resolution ?? latestHistory?.resolution

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
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      ariaLabel={t('panelTitle', { code: candidate.code })}
      className="flex max-h-[92vh] flex-col overflow-hidden border-primary-500/20 bg-[#0b0b0f]"
    >
      <Modal.Header
        heading={t('panelTitle', { code: candidate.code })}
        subtitle={t('panelDescription')}
        onClose={onClose}
        className="shrink-0 bg-[#0e0e13]"
      />

      <Modal.Body className="min-h-0 flex-1 overflow-y-auto p-0">
        <div className="grid min-h-0 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-white/[0.07] bg-black/20 p-4 lg:border-b-0 lg:border-r">
            <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#111116]">
              <div className="aspect-[3/4]">
                {candidate.resultUrl ? mediaType === 'video' ? (
                  <video src={candidate.resultUrl} controls playsInline className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.resultUrl} alt={candidate.code} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-text-tertiary">
                    <AppIcon name={mediaType === 'video' ? 'video' : 'image'} className="h-5 w-5" />
                    <span className="font-mono text-[8px] tracking-[0.12em]">{candidate.taskStatus}</span>
                  </div>
                )}
              </div>
              <div className="border-t border-white/[0.07] px-3 py-2.5">
                <div className="font-mono text-[9px] tracking-[0.14em] text-primary-300">{candidate.code}</div>
                <div className="mt-1 font-serif-cn text-[10px] text-text-tertiary">{t('currentVersion', { count: history.length + 1 })}</div>
              </div>
            </div>

            <dl className="mt-4 space-y-2.5">
              <MetadataRow label={t('model')} value={metadataValue(model, notAvailable)} />
              <MetadataRow label={t('aspectRatio')} value={metadataValue(aspectRatio, notAvailable)} />
              <MetadataRow label={t('resolution')} value={metadataValue(resolution, notAvailable)} />
              <MetadataRow
                label={t('seed')}
                value={candidate.seedStatus === 'applied'
                  ? metadataValue(candidate.requestedSeed, notAvailable)
                  : t('seedUnavailable')}
              />
              <MetadataRow label={t('status')} value={candidate.taskStatus} />
            </dl>

            <div className={`mt-4 rounded-lg border px-3 py-2 font-serif-cn text-[9px] leading-4 ${promptChanged ? 'border-primary-500/25 bg-primary-500/[0.06] text-primary-200' : 'border-white/[0.07] bg-white/[0.025] text-text-tertiary'}`}>
              {promptChanged ? t('unsavedChanges') : t('promptUnchanged')}
            </div>
          </aside>

          <main className="min-w-0 space-y-5 p-4 sm:p-5">
            <label htmlFor={`candidate-prompt-${candidate.id}`} className="block">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[9px] tracking-[0.14em] text-primary-300">{t('regenerateTitle')}</span>
                <span className="font-serif-cn text-[9px] text-text-tertiary">{t('currentPromptHint')}</span>
              </span>
              <textarea
                id={`candidate-prompt-${candidate.id}`}
                rows={18}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                disabled={disabled || generationActive || isRegenerating}
                className="mt-2 min-h-[360px] w-full resize-y rounded-xl border border-white/[0.1] bg-[#07070a] p-4 font-mono text-[11px] leading-5 text-white outline-none transition-colors focus:border-primary-500/55 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>

            <div className="grid gap-3 xl:grid-cols-2">
              <PromptTraceSection title={t('originalTitle')} badge={t('readOnly')} content={originPrompt} />
              <PromptTraceSection
                title={t('negativeTitle')}
                badge={t('modelDependent')}
                description={t('negativeDescription')}
                content={candidate.negativePrompt?.trim() || t('negativeEmpty')}
              />
            </div>

            {history.length > 0 && (
              <section className="border-t border-white/[0.07] pt-5">
                <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.14em] text-text-tertiary">
                  <AppIcon name="clock" className="h-3.5 w-3.5" />
                  {t('historyTitle')}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {history.map((revision, index) => (
                    <details key={revision.taskId} className="group/history rounded-xl border border-white/[0.08] bg-black/20">
                      <summary className="flex cursor-pointer list-none items-center gap-3 p-2.5 marker:hidden">
                        <div className="h-14 w-11 shrink-0 overflow-hidden rounded-md border border-white/[0.08] bg-[#111116]">
                          {revision.resultUrl ? mediaType === 'video' ? (
                            <video src={revision.resultUrl} muted playsInline className="h-full w-full object-cover" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={revision.resultUrl} alt={`${candidate.code} v${history.length - index}`} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center font-mono text-[6px] text-text-tertiary">{revision.taskStatus}</div>
                          )}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[8px] text-white">v{history.length - index}</span>
                          <span className="mt-1 block truncate font-mono text-[7px] text-text-tertiary">
                            {revision.modelKey} · {revision.requestedSeed ?? 'N/A'}
                          </span>
                        </span>
                        <AppIcon name="chevronDown" className="h-3.5 w-3.5 text-text-tertiary transition-transform group-open/history:rotate-180" />
                      </summary>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap border-t border-white/[0.07] p-3 font-mono text-[9px] leading-4 text-text-secondary">
                        {revision.prompt}
                      </pre>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {disabled && (
              <p className="rounded-lg border border-amber-300/15 bg-amber-300/[0.045] px-3 py-2 font-serif-cn text-[9px] leading-4 text-amber-100/70">
                {t('canonLockedHint')}
              </p>
            )}
          </main>
        </div>
      </Modal.Body>

      <Modal.Footer className="shrink-0 flex-col items-stretch gap-3 bg-[#0e0e13] sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 text-[10px] text-text-secondary hover:text-white"
          >
            <AppIcon name="copy" className="h-3.5 w-3.5" />
            {copied ? t('copied') : t('copy')}
          </button>
          <button
            type="button"
            disabled={!promptChanged || isRegenerating}
            onClick={onReset}
            className="h-9 rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 text-[10px] text-text-secondary disabled:opacity-35"
          >
            {t('reset')}
          </button>
          {candidate.seedStatus === 'applied' && (
            <label className="flex h-9 min-w-[230px] items-center gap-2 rounded-lg border border-white/[0.09] bg-[#09090c] px-3">
              <span className="shrink-0 font-mono text-[8px] tracking-[0.1em] text-text-tertiary">{t('seedMode')}</span>
              <select
                value={seedMode}
                onChange={(event) => onSeedModeChange(event.target.value as CandidateRegenerationSeedMode)}
                disabled={disabled || generationActive || isRegenerating}
                aria-label={t('seedMode')}
                className="min-w-0 flex-1 bg-transparent text-[10px] text-white outline-none"
              >
                <option value="new">{t('newSeed')}</option>
                <option value="reuse">{t('reuseSeed')}</option>
              </select>
            </label>
          )}
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onRegenerate}
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 text-[11px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
        >
          <AppIcon name="refresh" className={`h-3.5 w-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
          {isRegenerating ? t('regenerating') : t('saveAndRegenerate')}
        </button>
      </Modal.Footer>
    </Modal>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.055] pb-2">
      <dt className="font-mono text-[7px] tracking-[0.11em] text-text-tertiary">{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-[8px] text-text-secondary">{value}</dd>
    </div>
  )
}

function PromptTraceSection({
  title,
  badge,
  description,
  content,
}: {
  title: string
  badge: string
  description?: string
  content: string
}) {
  return (
    <section className="min-w-0 rounded-xl border border-white/[0.08] bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[8px] tracking-[0.12em] text-text-tertiary">{title}</span>
        <span className="rounded border border-white/[0.07] px-1.5 py-0.5 font-mono text-[6px] tracking-[0.1em] text-text-tertiary">{badge}</span>
      </div>
      {description && <p className="mt-2 font-serif-cn text-[8px] leading-4 text-text-tertiary">{description}</p>}
      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-[#07070a] p-3 font-mono text-[9px] leading-4 text-text-secondary">
        {content}
      </pre>
    </section>
  )
}

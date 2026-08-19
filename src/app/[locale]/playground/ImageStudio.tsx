'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  ASPECT_RATIO_OPTIONS,
  MAX_REF_IMAGES,
  type PlaygroundController,
  type PlaygroundRun,
} from './usePlaygroundController'

interface ImageStudioProps {
  ctrl: PlaygroundController
}

interface PromptTemplate {
  label: string
  prompt: string
  icon: 'userCircle' | 'image' | 'clapperboard' | 'package'
}

export function ImageStudio({ ctrl }: ImageStudioProps) {
  const t = useTranslations('playground.image')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const aspectLabels: Record<string, string> = {
    '9:16': t('ratio916'),
    '16:9': t('ratio169'),
    '1:1': t('ratio11'),
    '4:3': t('ratio43'),
    '3:4': t('ratio34'),
    '4:5': t('ratio45'),
  }
  const {
    prompt, setPrompt, promptRef, refImages,
    modelKey, setModelKey, activeModels, aspectRatio, setAspectRatio,
    isBusy, isGenerating, compressing, submit, costEstimate,
    imageRuns, latestRun, handleRun, resetForm, setLightboxRun,
    handleImagePick, removeRefImage,
  } = ctrl

  const showPlaceholder =
    submit.isPending || (isGenerating && latestRun?.outputType === 'image')
  const atMaxRefs = refImages.length >= MAX_REF_IMAGES
  const templates: PromptTemplate[] = [
    {
      label: t('templatePortrait'),
      prompt: t('templatePortraitPrompt'),
      icon: 'userCircle',
    },
    {
      label: t('templateScene'),
      prompt: t('templateScenePrompt'),
      icon: 'image',
    },
    {
      label: t('templateShot'),
      prompt: t('templateShotPrompt'),
      icon: 'clapperboard',
    },
    {
      label: t('templateProduct'),
      prompt: t('templateProductPrompt'),
      icon: 'package',
    },
  ]

  function onPromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (!isBusy && modelKey && prompt.trim() && !isGenerating) {
        void handleRun()
      }
    }
  }

  function applyTemplate(nextPrompt: string) {
    setPrompt(nextPrompt)
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(nextPrompt.length, nextPrompt.length)
    })
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden flex-1 flex-col">
      <section className="kuiper-canvas-grid min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col px-4 py-6 sm:px-6 lg:px-8">
          {imageRuns.length === 0 && !showPlaceholder ? (
            <section className="m-auto w-full max-w-5xl py-12 text-center">
              <div className="font-mono text-[9px] tracking-[0.24em] text-primary-400">
                {t('emptyKicker')}
              </div>
              <h2 className="mx-auto mt-3 max-w-2xl font-serif-cn text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {t('emptyTitle')}
              </h2>
              <p className="mx-auto mt-3 max-w-2xl font-serif-cn text-sm leading-6 text-text-secondary">
                {t('emptyDescription')}
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {templates.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    onClick={() => applyTemplate(template.prompt)}
                    className="group flex min-h-28 flex-col items-start justify-between rounded-2xl border border-white/[0.08] bg-raised/95 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-500/35 hover:bg-overlay"
                  >
                    <AppIcon
                      name={template.icon}
                      className="h-5 w-5 text-text-tertiary transition-colors group-hover:text-primary-400"
                    />
                    <span className="font-serif-cn text-sm font-medium text-text-secondary group-hover:text-white">
                      {template.label}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div className="font-mono text-[10px] tracking-[0.16em] text-text-tertiary">
                  {t('history', { count: imageRuns.length })}
                </div>
              </div>
              <div className="gap-4 [column-fill:_balance] columns-2 sm:columns-3 lg:columns-4 xl:columns-5">
                {showPlaceholder ? (
                  <div className="mb-4 flex aspect-[3/4] break-inside-avoid items-center justify-center rounded-2xl border border-primary-500/35 bg-raised">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary-500/25 border-t-primary-400" />
                      <div className="font-mono text-[10px] tracking-[0.14em] text-primary-300">
                        {submit.isPending
                          ? t('submitting')
                          : latestRun?.status === 'pending'
                            ? t('queued')
                            : t('generating')}
                      </div>
                    </div>
                  </div>
                ) : null}

                {imageRuns.map((run) => (
                  <ImageTile
                    key={run.id}
                    run={run}
                    resultAlt={t('resultAlt')}
                    onOpen={() => setLightboxRun(run)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <footer className="relative z-20 border-t border-white/[0.07] bg-[#050506]/92 px-3 py-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto w-full max-w-5xl rounded-[24px] border border-white/[0.1] bg-raised p-3 shadow-elev-3">
          {refImages.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-white/[0.07] pb-3">
              {refImages.map((reference, index) => (
                <div
                  key={reference.key}
                  className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/[0.1]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={reference.signedUrl}
                    alt={`${t('reference')} ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeRefImage(index)}
                    aria-label={t('removeReference')}
                    title={t('removeReference')}
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md bg-black/75 text-white opacity-0 transition-opacity hover:bg-error group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <AppIcon name="close" className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <span className="font-mono text-[9px] tracking-[0.14em] text-text-tertiary">
                {t('referenceCount', { count: refImages.length, max: MAX_REF_IMAGES })}
              </span>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isBusy || atMaxRefs}
              aria-label={t('addReference')}
              title={t('addReference')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/50 hover:text-primary-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <AppIcon name="plus" className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleImagePick}
            />

            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onPromptKeyDown}
              rows={2}
              maxLength={4000}
              placeholder={t('promptPlaceholder')}
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-text-primary outline-none placeholder:text-text-tertiary"
            />

            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={isBusy || !modelKey || !prompt.trim() || isGenerating}
              aria-label={t('generate')}
              className="kuiper-primary-button flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 font-mono text-[11px] font-semibold sm:px-5"
            >
              <span className="hidden sm:inline">
                {compressing
                  ? t('compressing')
                  : submit.isPending
                    ? t('submitting')
                    : isGenerating
                      ? t('generating')
                      : t('generate')}
              </span>
              <AppIcon name="arrowRight" className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-2">
            <label className="flex items-center gap-1.5">
              <AppIcon name="sparklesAlt" className="h-3.5 w-3.5 text-primary-400" />
              <span className="sr-only">{t('model')}</span>
              <select
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value)}
                disabled={isBusy || activeModels.length === 0}
                className="min-h-11 max-w-[220px] truncate rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 font-mono text-[10px] text-text-secondary outline-none focus:border-primary-500/40 disabled:opacity-50"
              >
                {activeModels.length === 0 ? <option value="">{t('noModel')}</option> : null}
                {activeModels.map((model) => (
                  <option key={model.value} value={model.value}>{model.label}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] text-text-tertiary">{t('ratio')}</span>
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value)}
                disabled={isBusy}
                className="min-h-11 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 font-mono text-[10px] text-text-secondary outline-none focus:border-primary-500/40"
              >
                {ASPECT_RATIO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {aspectLabels[option.value] ?? option.value}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={resetForm}
              disabled={isBusy}
              className="min-h-11 min-w-11 rounded-lg px-2 py-1.5 font-mono text-[9px] text-text-tertiary transition-colors hover:bg-white/[0.05] hover:text-text-primary disabled:opacity-40"
            >
              {t('reset')}
            </button>

            <div className="ml-auto text-right" title={costEstimate.data?.detail ?? undefined}>
              <span className="font-mono text-[9px] text-text-tertiary">{t('estimatedCost')} </span>
              <span className="font-mono text-[10px] text-editorial-400">
                {typeof costEstimate.data?.amountUsd === 'number'
                  ? `≈ $${costEstimate.data.amountUsd.toFixed(costEstimate.data.amountUsd < 1 ? 4 : 2)}`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function ImageTile({
  run,
  resultAlt,
  onOpen,
}: {
  run: PlaygroundRun
  resultAlt: string
  onOpen: () => void
}) {
  const url = run.resultUrls?.[0]
  return (
    <button
      type="button"
      onClick={onOpen}
      title={run.prompt.slice(0, 80)}
      className="group mb-4 block w-full break-inside-avoid overflow-hidden rounded-2xl border border-white/[0.08] bg-raised transition-all hover:-translate-y-0.5 hover:border-primary-500/35"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={resultAlt}
          loading="lazy"
          className="w-full object-cover transition-opacity group-hover:opacity-90"
        />
      ) : (
        <div className="flex aspect-[3/4] items-center justify-center font-mono text-[11px] text-text-tertiary">
          {run.status === 'failed' ? '✕' : '…'}
        </div>
      )}
    </button>
  )
}

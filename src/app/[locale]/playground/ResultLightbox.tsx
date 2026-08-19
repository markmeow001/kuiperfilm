'use client'

/**
 * Result detail lightbox — full-screen modal opened when a gallery tile is
 * clicked (Image studio). Right rail models the Higgsfield detail layout:
 *   header (identity + close)
 *   → scrollable body: PROMPT (+copy, expand/collapse) + collapsible DETAILS
 *   → pinned action stack: image-to-video + regenerate / use as reference
 *      + icon row (download / share / more actions).
 * Layout borrowed from Higgsfield; KuiperAI keeps its darkroom/cyan identity.
 * Every action maps to a real capability — no stubs.
 */

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { playgroundDownloadHref, type PlaygroundController } from './usePlaygroundController'
import styles from './PlaygroundPresentation.module.css'

interface ResultLightboxProps {
  ctrl: PlaygroundController
}

export function ResultLightbox({ ctrl }: ResultLightboxProps) {
  const t = useTranslations('playground.resultLightbox')
  const locale = useLocale()
  const run = ctrl.lightboxRun
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  const close = () => ctrl.setLightboxRun(null)

  // ESC closes; reset per-run local UI whenever the open run changes.
  useEffect(() => {
    if (!run) return
    setPromptExpanded(false)
    setMoreOpen(false)
    setLinkCopied(false)
    setDims(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ctrl.setLightboxRun(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, ctrl])

  if (!run) return null

  const url = run.resultUrls?.[0] ?? null
  const isImage = run.outputType === 'image'
  const modelLabel = ctrl.activeModels.find((m) => m.value === run.modelKey)?.label ?? run.modelKey ?? '—'
  const otherModels = ctrl.activeModels.filter((m) => m.value !== run.modelKey).slice(0, 6)
  const promptLong = (run.prompt?.length ?? 0) > 120
  const statusText =
    run.status === 'succeeded'
      ? t('succeeded')
      : run.status === 'failed'
        ? t('statusFailed')
        : run.status === 'running'
          ? t('running')
          : t('queued')

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      alert(t('copyLinkFailure'))
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className={`${styles.touchSurface} fixed inset-0 z-50 flex bg-canvas/90 backdrop-blur-sm`}
      data-playground-touch-surface
    >
      {/* Backdrop click closes */}
      <button type="button" aria-label={t('close')} onClick={close} className="absolute inset-0 cursor-default" />

      <div className="relative z-10 m-auto flex max-h-[92vh] w-[94vw] max-w-6xl flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-canvas shadow-2xl lg:flex-row">
        {/* Media */}
        <div className="flex min-h-[38vh] w-full min-w-0 shrink-0 items-center justify-center bg-black p-3 sm:min-h-[42vh] sm:p-4 lg:min-h-0 lg:flex-1 lg:shrink">
          {url ? (
            isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={t('imageAlt')}
                onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className="max-h-[32vh] max-w-full object-contain sm:max-h-[36vh] lg:max-h-[84vh]"
              />
            ) : (
              <video
                src={url}
                controls
                autoPlay
                playsInline
                className="max-h-[32vh] max-w-full object-contain sm:max-h-[36vh] lg:max-h-[84vh]"
              />
            )
          ) : run.status === 'failed' ? (
            <div className="p-10 text-center">
              <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-rose-400">{t('failed')}</div>
              <div className="font-mono text-[11px] text-text-tertiary" title={run.errorMessage ?? undefined}>
                {resolveErrorDisplay({ message: run.errorMessage })?.message ?? run.errorMessage ?? t('unknownError')}
              </div>
            </div>
          ) : (
            <div className="p-10 font-mono text-[12px] uppercase tracking-wider text-text-tertiary">{t('processing')}</div>
          )}
        </div>

        {/* Right rail */}
        <div className="flex max-h-[52vh] min-h-0 w-full lg:w-[360px] flex-shrink-0 flex-col overflow-hidden bg-raised sm:max-h-[48vh] lg:max-h-none">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 lg:border-l">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 to-cyan-600 font-mono text-[11px] font-bold text-black">
              AI
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[13px] text-text-primary">{modelLabel}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
                {isImage ? t('image') : t('video')} · {statusText}
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('close')}
              title={t('closeTitle')}
              className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/[0.12] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200"
            >
              ✕
            </button>
          </div>

          {/* Scrollable body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:border-l lg:border-white/[0.08]">
            {/* PROMPT */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">{t('prompt')}</span>
                <button
                  type="button"
                  onClick={() => ctrl.copyPrompt(run.prompt)}
                  className="rounded-sm border border-white/[0.12] px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200"
                >
                  {ctrl.promptCopied ? t('copied') : t('copy')}
                </button>
              </div>
              <div
                className={`whitespace-pre-wrap break-words font-serif-cn text-[12px] leading-relaxed text-text-secondary ${
                  promptExpanded ? 'max-h-[45vh] overflow-y-auto' : 'max-h-28 overflow-hidden'
                }`}
              >
                {run.prompt || t('noPrompt')}
              </div>
              {promptLong ? (
                <button
                  type="button"
                  onClick={() => setPromptExpanded((v) => !v)}
                  className="mt-1.5 font-mono text-[11px] text-cyan-300/80 hover:text-cyan-200"
                >
                  {promptExpanded ? t('collapse') : t('expand')}
                </button>
              ) : null}
            </div>

            {/* DETAILS */}
            <div className="border-t border-white/[0.08] pt-3">
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="mb-2 flex w-full items-center justify-between font-mono text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-primary"
              >
                <span>{t('details')}</span>
                <span>{detailsOpen ? '▲' : '▼'}</span>
              </button>
              {detailsOpen ? (
                <div className="space-y-1.5 font-mono text-[11px]">
                  <Row label={t('model')} value={modelLabel} />
                  {isImage && dims ? <Row label={t('dimensions')} value={`${dims.w}×${dims.h}`} /> : null}
                  <Row label={t('status')} value={statusText} />
                  <Row label={t('created')} value={new Date(run.createdAt).toLocaleString(locale, { hour12: false })} />
                </div>
              ) : null}
            </div>
          </div>

          {/* Pinned action stack */}
          <div className="relative border-t border-white/[0.08] p-4 lg:border-l">
            {/* More popover */}
            {moreOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setMoreOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div className="absolute bottom-full right-4 z-50 mb-2 w-[300px] rounded-lg border border-white/[0.08] bg-overlay p-3 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => ctrl.editPrompt(run.prompt)}
                    disabled={ctrl.isBusy || !run.prompt}
                    className="mb-3 w-full rounded-sm border border-white/[0.12] py-2 font-mono text-[12px] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('editPrompt')}
                  </button>
                  {otherModels.length > 0 ? (
                    <>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
                        {t('regenerateWithModel')}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {otherModels.map((m) => (
                          <button
                            type="button"
                            key={m.value}
                            onClick={() => {
                              setMoreOpen(false)
                              ctrl.handleRun(m.value, run.prompt)
                            }}
                            disabled={ctrl.isBusy || !run.prompt}
                            className="rounded-sm border border-white/[0.12] bg-raised px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                            title={t('rerunWithModel', { model: m.label })}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}

            {/* Primary: image → video (i2v) */}
            {isImage && url ? (
              <button
                type="button"
                onClick={() => ctrl.applyRunAsReference(run, { asVideo: true })}
                disabled={ctrl.isBusy}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 py-2.5 font-mono text-[13px] font-semibold uppercase tracking-wider text-black hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ▶ {t('imageToVideo')}
              </button>
            ) : null}

            {/* Recreate + Reference */}
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => ctrl.handleRun(run.modelKey, run.prompt)}
                disabled={ctrl.isBusy || !run.prompt}
                className="rounded-lg border border-white/[0.12] py-2 font-mono text-[12px] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('regenerate')}
              </button>
              <button
                type="button"
                onClick={() => ctrl.applyRunAsReference(run)}
                disabled={ctrl.isBusy || !url}
                className="rounded-lg border border-white/[0.12] py-2 font-mono text-[12px] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('useAsReference')}
              </button>
            </div>

            {/* Icon row */}
            <div className="flex items-center gap-2">
              {url ? (
                <a
                  href={playgroundDownloadHref(url, `kuiperai-${run.id}`)}
                  download
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/[0.08] py-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary hover:border-cyan-400/50 hover:text-cyan-200"
                >
                  ↓ {t('download')}
                </a>
              ) : null}
              {url ? (
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/[0.08] py-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary hover:border-cyan-400/50 hover:text-cyan-200"
                >
                  {linkCopied ? t('linkCopied') : `⤴ ${t('share')}`}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-label={t('more')}
                title={t('more')}
                className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border font-mono text-[14px] ${
                  moreOpen
                    ? 'border-cyan-400/60 text-cyan-200'
                    : 'border-white/[0.08] text-text-secondary hover:border-cyan-400/60 hover:text-cyan-200'
                }`}
              >
                ⋯
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-tertiary">{label}</span>
      <span className="truncate text-text-secondary" title={value}>
        {value}
      </span>
    </div>
  )
}

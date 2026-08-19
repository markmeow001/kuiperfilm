'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { PlaygroundController } from './usePlaygroundController'
import styles from './PlaygroundPresentation.module.css'

type ReconstructionModel = PlaygroundController['videoModels'][number]

export interface ReconstructionReferenceAsset {
  key: string
  signedUrl: string
  previewUrl?: string
}

interface ReconstructionGenerationControlsProps {
  models: ReconstructionModel[]
  modelKey: string
  onModelChange: (modelKey: string) => void
  durationMode: string
  sourceDurationSec: number
  onDurationChange: (mode: string) => void
  sourceFrameUrl: string | null
  analysisReady: boolean
  characterReference: ReconstructionReferenceAsset | null
  sceneReference: ReconstructionReferenceAsset | null
  onReferencePick: (role: 'character' | 'environment', file: File) => Promise<void>
  onRemoveReference: (role: 'character' | 'environment') => void
  targetKeyframe: ReconstructionReferenceAsset | null
  keyframeIsStale: boolean
  keyframeModelLabel: string | null
  onGenerateKeyframe: () => void
  canGenerateKeyframe: boolean
  isGeneratingKeyframe: boolean
  isBusy: boolean
  estimatedUsd: number | null
}

export function ReconstructionGenerationControls(props: ReconstructionGenerationControlsProps) {
  const t = useTranslations('playground.reconstructionControls')

  function pickReference(role: 'character' | 'environment', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void props.onReferencePick(role, file)
  }

  return (
    <div className={`${styles.touchSurface} space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3`} data-playground-touch-surface>
      <div>
        <h2 className="text-sm font-medium text-white">{t('title')}</h2>
        <p className="mt-1 text-xs leading-5 text-text-tertiary">{t('description')}</p>
      </div>

      <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-200"><span aria-hidden="true">✓</span> {t('performanceLocked')}</div>
        <p className="mt-1.5 text-[11px] leading-5 text-text-tertiary">{t('performanceDescription')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="block text-xs text-text-secondary">{t('model')}</span>
          <select
            aria-label={t('modelAria')}
            value={props.modelKey}
            onChange={(event) => props.onModelChange(event.target.value)}
            disabled={props.isBusy || props.models.length === 0}
            className="w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-400/60 disabled:opacity-50"
          >
            {props.models.length === 0 ? <option value="">{t('noModel')}</option> : null}
            {props.models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs text-text-secondary">{t('duration')}</span>
          <select
            aria-label={t('durationAria')}
            value={props.durationMode}
            onChange={(event) => props.onDurationChange(event.target.value)}
            disabled={props.isBusy}
            className="w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-400/60 disabled:opacity-50"
          >
            <option value="source" disabled={props.sourceDurationSec < 4}>{t('followSource', { seconds: props.sourceDurationSec.toFixed(1) })}{props.sourceDurationSec < 4 ? t('modelMinimum') : ''}</option>
            {Array.from({ length: 12 }, (_, index) => index + 4).map((seconds) => (
              <option key={seconds} value={String(seconds)}>{t('seconds', { seconds })}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-3 border-t border-white/[0.07] pt-3">
        <div>
          <div className="text-xs font-medium text-white">{t('uploadCharacterStep')}</div>
          <p className="mt-1 text-[11px] leading-5 text-text-tertiary">{t('uploadCharacterDescription')}</p>
        </div>
        <ReferenceUploadCard
          label={t('characterImage')}
          asset={props.characterReference}
          required
          disabled={props.isBusy}
          onPick={(event) => pickReference('character', event)}
          onRemove={() => props.onRemoveReference('character')}
        />

        <div>
          <div className="text-xs font-medium text-white">{t('uploadSceneStep')}</div>
          <p className="mt-1 text-[11px] leading-5 text-text-tertiary">{t('uploadSceneDescription')}</p>
        </div>
        <ReferenceUploadCard
          label={t('sceneImage')}
          asset={props.sceneReference}
          disabled={props.isBusy}
          onPick={(event) => pickReference('environment', event)}
          onRemove={() => props.onRemoveReference('environment')}
        />
      </div>

      <div className="space-y-3 border-t border-white/[0.07] pt-3">
        <div>
          <div className="text-xs font-medium text-white">{t('keyframeStep')}</div>
          <p className="mt-1 text-[11px] leading-5 text-text-tertiary">{t('keyframeDescription')}</p>
        </div>
        {!props.analysisReady ? (
          <div role="status" className="rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2 text-[11px] leading-5 text-amber-100">
            {t('analysisRequired')}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <KeyframeTile
            label={t('sourceFrame')}
            imageUrl={props.sourceFrameUrl}
            emptyLabel={t('sourceFrameEmpty')}
          />
          <KeyframeTile
            label={t('targetKeyframe')}
            imageUrl={props.targetKeyframe?.signedUrl ?? null}
            pending={props.isGeneratingKeyframe}
            emptyLabel={props.analysisReady
              ? props.characterReference ? t('targetReady') : t('uploadCharacterFirst')
              : t('waitForAnalysis')}
          />
        </div>
        {props.keyframeIsStale && props.targetKeyframe ? <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">{t('keyframeStale')}</div> : null}
        <button type="button" onClick={props.onGenerateKeyframe} disabled={props.isBusy || props.isGeneratingKeyframe || !props.canGenerateKeyframe} className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3 py-3 text-xs font-medium text-cyan-200 hover:bg-cyan-400/15 disabled:opacity-40">
          <AppIcon name="sparkles" className="h-4 w-4" />
          {props.isGeneratingKeyframe ? t('keyframeGenerating') : props.targetKeyframe ? t('keyframeRegenerate') : t('keyframeGenerate')}
        </button>
        <div className="text-[10px] text-text-tertiary">{t('keyframeModel', { model: props.keyframeModelLabel ?? t('noKeyframeModel') })}</div>
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.07] pt-3 text-[11px]">
        <span className="text-text-tertiary">{t('audioDurationNote')}</span>
        <span className="font-mono text-cyan-300">{props.estimatedUsd === null ? t('costEmpty') : t('estimatedCost', { amount: props.estimatedUsd.toFixed(4) })}</span>
      </div>
    </div>
  )
}

function ReferenceUploadCard(props: {
  label: string
  asset: ReconstructionReferenceAsset | null
  required?: boolean
  disabled: boolean
  onPick: (event: ChangeEvent<HTMLInputElement>) => void
  onRemove: () => void
}) {
  const t = useTranslations('playground.reconstructionControls')

  return props.asset ? (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.09] bg-black/20 p-2">
      <ReferenceImage asset={props.asset} label={props.label} />
      <span className="min-w-0 flex-1 text-xs text-white">{props.label}<span className="mt-1 block text-[10px] text-emerald-300">{t('uploaded')}</span></span>
      <button type="button" onClick={props.onRemove} disabled={props.disabled} className="min-h-11 min-w-11 px-2 text-xs text-text-tertiary hover:text-red-300 disabled:opacity-40">{t('remove')}</button>
    </div>
  ) : (
    <label className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs transition ${props.required ? 'border-cyan-400/35 text-cyan-200' : 'border-white/[0.14] text-text-secondary'} hover:border-cyan-400/50`}>
      <AppIcon name="upload" className="h-4 w-4" />
      {t('uploadReference', { label: props.label, required: props.required ? t('required') : '' })}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={props.disabled} onChange={props.onPick} className="sr-only" />
    </label>
  )
}

function ReferenceImage(props: { asset: ReconstructionReferenceAsset; label: string }) {
  const t = useTranslations('playground.reconstructionControls')
  const preferredUrl = props.asset.previewUrl || props.asset.signedUrl
  const [src, setSrc] = useState(preferredUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setSrc(preferredUrl)
    setFailed(false)
  }, [preferredUrl])

  if (failed) {
    return <div role="img" aria-label={t('previewFailedAria', { label: props.label })} className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] px-2 text-center text-[10px] leading-4 text-red-200">{t('previewFailed')}<br />{t('uploadAgain')}</div>
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={props.label}
      className="h-16 w-16 shrink-0 rounded-lg object-cover"
      onError={() => {
        if (src !== props.asset.signedUrl) setSrc(props.asset.signedUrl)
        else setFailed(true)
      }}
    />
  )
}

function KeyframeTile(props: { label: string; imageUrl: string | null; pending?: boolean; emptyLabel: string }) {
  const t = useTranslations('playground.reconstructionControls')
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-black/25">
      <div className="aspect-video bg-[linear-gradient(135deg,rgba(255,255,255,0.035)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.035)_50%,rgba(255,255,255,0.035)_75%,transparent_75%)] bg-[length:16px_16px]">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.imageUrl} alt={props.label} className="h-full w-full object-cover" />
        ) : <div className="flex h-full items-center justify-center px-3 text-center text-[10px] leading-4 text-text-tertiary">{props.pending ? t('aiGenerating') : props.emptyLabel}</div>}
      </div>
      <div className="px-2 py-1.5 text-[10px] text-text-secondary">{props.label}</div>
    </div>
  )
}

interface ReconstructionPromptReviewProps {
  prompt: string
  isStale: boolean
  isBusy: boolean
  isGenerating: boolean
  onBuild: () => void
  onPromptChange: (prompt: string) => void
  onGenerate: () => void
}

export function ReconstructionPromptReview(props: ReconstructionPromptReviewProps) {
  const t = useTranslations('playground.reconstructionControls')

  return (
    <div className={`${styles.touchSurface} space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3`} data-playground-touch-surface>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white">{t('promptReviewTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">{t('promptReviewDescription')}</p>
        </div>
        <button type="button" onClick={props.onBuild} disabled={props.isBusy} className="min-h-11 min-w-11 shrink-0 rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-40">
          {props.prompt ? t('buildPromptAgain') : t('buildPrompt')}
        </button>
      </div>
      {props.prompt ? (
        <>
          {props.isStale ? <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">{t('promptStale')}</div> : null}
          <textarea
            aria-label={t('promptAria')}
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            className="min-h-72 w-full resize-y rounded-xl border border-white/[0.09] bg-black/40 px-3 py-3 font-mono text-xs leading-5 text-text-secondary outline-none focus:border-cyan-400/50"
          />
          <div className="flex items-center justify-between text-[11px] text-text-tertiary">
            <span>{t('characterCount', { count: props.prompt.length })}</span>
            <span>{t('promptEditable')}</span>
          </div>
          <button type="button" onClick={props.onGenerate} disabled={props.isBusy || props.isGenerating || props.isStale || !props.prompt.trim()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3.5 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40">
            <AppIcon name="sparkles" className="h-4 w-4" />
            {props.isGenerating ? t('rebuilding') : t('confirmGenerate')}
          </button>
        </>
      ) : null}
    </div>
  )
}

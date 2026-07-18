'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { TaskPresentationState } from '@/lib/task/presentation'
import { clampEmotionStrength } from './voice-workspace-helpers'
import type { VoiceLine, VoiceLineSavePayload } from './voice-workspace-types'

interface VoiceLineCardProps {
  line: VoiceLine
  taskState: TaskPresentationState | null
  hasBoundVoice: boolean
  playingKey: string | null
  isSaving: boolean
  isSubmitting: boolean
  canEdit: boolean
  onTogglePreview: (key: string, url: string | null) => void
  onGenerate: (lineId: string) => void
  onSave: (payload: VoiceLineSavePayload) => void
}

export function VoiceLineCard({
  line,
  taskState,
  hasBoundVoice,
  playingKey,
  isSaving,
  isSubmitting,
  canEdit,
  onTogglePreview,
  onGenerate,
  onSave,
}: VoiceLineCardProps) {
  const t = useTranslations('v2Voice')
  const initialStrength = clampEmotionStrength(line.emotionStrength ?? 0.4)
  const [emotionPrompt, setEmotionPrompt] = useState(line.emotionPrompt ?? '')
  const [emotionStrength, setEmotionStrength] = useState(initialStrength)

  useEffect(() => {
    setEmotionPrompt(line.emotionPrompt ?? '')
    setEmotionStrength(clampEmotionStrength(line.emotionStrength ?? 0.4))
  }, [line.emotionPrompt, line.emotionStrength])

  const previewKey = `line:${line.id}`
  const isPlaying = playingKey === previewKey
  const isRunning = isSubmitting || line.lineTaskRunning || taskState?.isRunning === true
  const isFailed = taskState?.isError === true
  const changed = emotionPrompt.trim() !== (line.emotionPrompt ?? '')
    || Math.abs(emotionStrength - initialStrength) > 0.001

  return (
    <article className={`kuiper-surface-card p-4 ${isFailed ? 'border-rose-500/30' : ''}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={!line.audioUrl}
          onClick={() => onTogglePreview(previewKey, line.audioUrl)}
          aria-label={isPlaying ? t('voice.pausePreview') : t('lines.playLine', { number: line.lineIndex })}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            isPlaying
              ? 'border-primary-400 bg-primary-500 text-black'
              : 'border-border-primary bg-surface-overlay text-text-primary hover:border-primary-500/60'
          }`}
        >
          <AppIcon name={isPlaying ? 'pause' : line.audioUrl ? 'play' : 'mic'} className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-text-tertiary">#{String(line.lineIndex).padStart(2, '0')}</span>
            <span className="text-sm font-semibold text-text-primary">{line.speaker}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${
              isRunning
                ? 'bg-primary-500/15 text-primary-200'
                : line.audioUrl
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : isFailed
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-surface-overlay text-text-tertiary'
            }`}>
              {isRunning ? t('lines.generating') : line.audioUrl ? t('lines.ready') : isFailed ? t('lines.failed') : t('lines.pending')}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{line.content}</p>
          {line.matchedPanelIndex !== null && line.matchedPanelIndex !== undefined ? (
            <p className="mt-1 text-[11px] text-text-tertiary">{t('lines.matchedShot', { number: line.matchedPanelIndex + 1 })}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border-soft pt-3 sm:grid-cols-[minmax(0,1fr)_150px]">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium text-text-tertiary">{t('lines.emotionPrompt')}</span>
          <input
            value={emotionPrompt}
            onChange={(event) => setEmotionPrompt(event.target.value)}
            disabled={!canEdit}
            placeholder={t('lines.emotionPlaceholder')}
            className="kuiper-input w-full px-3 py-2 text-sm disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-text-tertiary">
            {t('lines.emotionStrength')}
            <span className="font-mono text-text-secondary">{Math.round(emotionStrength * 100)}%</span>
          </span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={emotionStrength}
            onChange={(event) => setEmotionStrength(Number(event.target.value))}
            disabled={!canEdit}
            className="h-9 w-full accent-[var(--primary-500)] disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={!changed || isSaving || !canEdit}
          onClick={() => onSave({
            lineId: line.id,
            emotionPrompt: emotionPrompt.trim() || null,
            emotionStrength: clampEmotionStrength(emotionStrength),
          })}
          className="kuiper-secondary-button inline-flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AppIcon name={isSaving ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${isSaving ? 'animate-spin' : ''}`} />
          {isSaving ? t('lines.saving') : t('lines.saveEmotion')}
        </button>
        <button
          type="button"
          disabled={isRunning || !hasBoundVoice || !canEdit}
          onClick={() => onGenerate(line.id)}
          title={!hasBoundVoice ? t('lines.bindVoiceFirst') : undefined}
          className="kuiper-primary-button inline-flex items-center gap-2 rounded-[var(--r-input)] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AppIcon name={isRunning ? 'loader' : 'sparklesAlt'} className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          {isRunning ? t('lines.generating') : line.audioUrl ? t('lines.regenerate') : t('lines.generate')}
        </button>
      </div>
    </article>
  )
}

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { TaskPresentationState } from '@/lib/task/presentation'
import type {
  VoiceLine,
  VoiceLineDraftPayload,
  VoiceLineSavePayload,
  VoiceLineUpdatePayload,
  VoicePanelOption,
  VoicePanelQueryState,
} from './voice-workspace-types'
import { VoiceLineCard } from './VoiceLineCard'
import { VoiceLineEditorForm } from './VoiceLineEditorForm'

interface VoiceLinePanelProps {
  voiceLines: VoiceLine[]
  taskStatesByLineId: Map<string, TaskPresentationState>
  boundSpeakers: ReadonlySet<string>
  playingKey: string | null
  savingLineId: string | null
  submittingLineIds: ReadonlySet<string>
  panelOptions: VoicePanelOption[]
  panelQueryState: VoicePanelQueryState
  canEdit: boolean
  onTogglePreview: (key: string, url: string | null) => void
  onGenerate: (lineId: string) => void
  onSaveEmotion: (payload: VoiceLineSavePayload) => void
  onCreate: (payload: VoiceLineDraftPayload) => Promise<void>
  onUpdate: (payload: VoiceLineUpdatePayload) => Promise<void>
  onDelete: (lineId: string) => Promise<void>
  onRetryPanels: () => void
}

export function VoiceLinePanel({
  voiceLines,
  taskStatesByLineId,
  boundSpeakers,
  playingKey,
  savingLineId,
  submittingLineIds,
  panelOptions,
  panelQueryState,
  canEdit,
  onTogglePreview,
  onGenerate,
  onSaveEmotion,
  onCreate,
  onUpdate,
  onDelete,
  onRetryPanels,
}: VoiceLinePanelProps) {
  const t = useTranslations('v2Voice')
  const [isAdding, setIsAdding] = useState(false)

  return (
    <section className="mt-6" aria-labelledby="voice-lines-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="voice-lines-title" className="font-heading text-base font-semibold text-text-primary">{t('lines.title')}</h2>
          <p className="mt-1 text-xs text-text-tertiary">{t('lines.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-text-tertiary">{t('lines.count', { count: voiceLines.length })}</span>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              disabled={isAdding}
              className="kuiper-secondary-button inline-flex min-h-11 items-center gap-2 px-3 text-xs disabled:opacity-50"
            >
              <AppIcon name="plus" className="h-3.5 w-3.5" />
              {t('lineEditor.addDialogue')}
            </button>
          ) : null}
        </div>
      </div>

      {canEdit && panelQueryState === 'error' ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-input)] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <span>{t('lineEditor.shotsUnavailable')}</span>
          <button
            type="button"
            onClick={onRetryPanels}
            className="kuiper-secondary-button min-h-11 px-3 text-xs"
          >
            {t('lineEditor.reloadShots')}
          </button>
        </div>
      ) : null}

      {canEdit && isAdding ? (
        <div className="mb-3">
          <VoiceLineEditorForm
            mode="add"
            formLabel={t('lineEditor.addDialogue')}
            panelOptions={panelOptions}
            panelQueryState={panelQueryState}
            onSave={onCreate}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      ) : null}

      {voiceLines.length === 0 ? (
        <div className="kuiper-surface-card p-10 text-center">
          <AppIcon name="fileText" className="mx-auto h-7 w-7 text-text-tertiary" />
          <p className="mt-3 text-sm text-text-secondary">{t('lines.empty')}</p>
        </div>
      ) : (
        <div className="grid gap-3 2xl:grid-cols-2">
          {voiceLines.map((line) => (
            <VoiceLineCard
              key={line.id}
              line={line}
              taskState={taskStatesByLineId.get(line.id) || null}
              hasBoundVoice={boundSpeakers.has(line.speaker)}
              playingKey={playingKey}
              isSaving={savingLineId === line.id}
              isSubmitting={submittingLineIds.has(line.id)}
              panelOptions={panelOptions}
              panelQueryState={panelQueryState}
              canEdit={canEdit}
              onTogglePreview={onTogglePreview}
              onGenerate={onGenerate}
              onSaveEmotion={onSaveEmotion}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  )
}

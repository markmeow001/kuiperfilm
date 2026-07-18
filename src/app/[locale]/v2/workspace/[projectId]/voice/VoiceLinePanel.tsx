'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { TaskPresentationState } from '@/lib/task/presentation'
import type { VoiceLine, VoiceLineSavePayload } from './voice-workspace-types'
import { VoiceLineCard } from './VoiceLineCard'

interface VoiceLinePanelProps {
  voiceLines: VoiceLine[]
  taskStatesByLineId: Map<string, TaskPresentationState>
  boundSpeakers: ReadonlySet<string>
  playingKey: string | null
  savingLineId: string | null
  submittingLineIds: ReadonlySet<string>
  canEdit: boolean
  onTogglePreview: (key: string, url: string | null) => void
  onGenerate: (lineId: string) => void
  onSave: (payload: VoiceLineSavePayload) => void
}

export function VoiceLinePanel({
  voiceLines,
  taskStatesByLineId,
  boundSpeakers,
  playingKey,
  savingLineId,
  submittingLineIds,
  canEdit,
  onTogglePreview,
  onGenerate,
  onSave,
}: VoiceLinePanelProps) {
  const t = useTranslations('v2Voice')

  return (
    <section className="mt-6" aria-labelledby="voice-lines-title">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 id="voice-lines-title" className="font-heading text-base font-semibold text-text-primary">{t('lines.title')}</h2>
          <p className="mt-1 text-xs text-text-tertiary">{t('lines.subtitle')}</p>
        </div>
        <span className="font-mono text-[12px] text-text-tertiary">{t('lines.count', { count: voiceLines.length })}</span>
      </div>
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
              canEdit={canEdit}
              onTogglePreview={onTogglePreview}
              onGenerate={onGenerate}
              onSave={onSave}
            />
          ))}
        </div>
      )}
    </section>
  )
}

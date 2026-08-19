'use client'

import { useTranslations } from 'next-intl'
import type {
  ReconstructionAudioMode,
  ReconstructionCreativeBrief,
  ReconstructionDialogueLine,
} from '@/lib/playground/reconstruction-contract'
import styles from './PlaygroundPresentation.module.css'

function Field(props: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
}) {
  const className = 'w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-text-tertiary/70 focus:border-cyan-400/60'
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-text-secondary">{props.label}</span>
      {props.multiline ? (
        <textarea className={`${className} min-h-20 resize-y`} placeholder={props.placeholder} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input className={className} placeholder={props.placeholder} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      )}
    </label>
  )
}

interface ReconstructionBriefFormProps {
  brief: ReconstructionCreativeBrief
  onBriefChange: (brief: ReconstructionCreativeBrief) => void
  dialogue: ReconstructionDialogueLine[]
  onAddDialogue: () => void
  onUpdateDialogue: (id: string, patch: Partial<ReconstructionDialogueLine>) => void
  onRemoveDialogue: (id: string) => void
  audioMode: ReconstructionAudioMode
  onAudioModeChange: (mode: ReconstructionAudioMode) => void
  hasAudio: boolean
}

export function ReconstructionBriefForm(props: ReconstructionBriefFormProps) {
  const t = useTranslations('playground.reconstructionBrief')
  const patchBrief = (patch: Partial<ReconstructionCreativeBrief>) => props.onBriefChange({ ...props.brief, ...patch })
  return (
    <div className={`${styles.touchSurface} space-y-6`} data-playground-touch-surface>
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-white">{t('title')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('era')} placeholder={t('eraPlaceholder')} value={props.brief.era} onChange={(era) => patchBrief({ era })} />
          <Field label={t('weatherAndTime')} placeholder={t('weatherAndTimePlaceholder')} value={props.brief.weatherAndTime} onChange={(weatherAndTime) => patchBrief({ weatherAndTime })} />
        </div>
        <Field label={t('location')} placeholder={t('locationPlaceholder')} value={props.brief.location} onChange={(location) => patchBrief({ location })} />
        <Field label={t('story')} placeholder={t('storyPlaceholder')} value={props.brief.story} multiline onChange={(story) => patchBrief({ story })} />
        <Field label={t('characterDesign')} placeholder={t('characterDesignPlaceholder')} value={props.brief.characterDesign} multiline onChange={(characterDesign) => patchBrief({ characterDesign })} />
        <Field label={t('wardrobe')} placeholder={t('wardrobePlaceholder')} value={props.brief.wardrobe} multiline onChange={(wardrobe) => patchBrief({ wardrobe })} />
        <Field label={t('mood')} placeholder={t('moodPlaceholder')} value={props.brief.mood} onChange={(mood) => patchBrief({ mood })} />
        <Field label={t('backgroundMotion')} placeholder={t('backgroundMotionPlaceholder')} value={props.brief.backgroundMotion} multiline onChange={(backgroundMotion) => patchBrief({ backgroundMotion })} />
        <label className="flex min-h-11 items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={props.brief.replacePeople} onChange={(event) => patchBrief({ replacePeople: event.target.checked })} className="accent-cyan-400" />
          {t('replacePeople')}
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-white">{t('dialogueTitle')}</h2>
          <button type="button" aria-label={t('addDialogue')} onClick={props.onAddDialogue} className="min-h-11 min-w-11 px-2 text-xs text-cyan-300 hover:text-cyan-200">＋ {t('addDialogue')}</button>
        </div>
        <p className="text-xs leading-5 text-text-tertiary">{t('dialogueDescription')}</p>
        {props.dialogue.map((line) => (
          <div key={line.id} className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_88px_88px_auto]">
              <input aria-label={t('speaker')} value={line.speaker} onChange={(event) => props.onUpdateDialogue(line.id, { speaker: event.target.value })} className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
              <input aria-label={t('startSec')} type="number" min="0" step="0.1" value={line.startSec} onChange={(event) => props.onUpdateDialogue(line.id, { startSec: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
              <input aria-label={t('endSec')} type="number" min="0" step="0.1" value={line.endSec} onChange={(event) => props.onUpdateDialogue(line.id, { endSec: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
              <button type="button" aria-label={t('removeDialogue')} onClick={() => props.onRemoveDialogue(line.id)} className="min-h-11 min-w-11 text-text-tertiary hover:text-red-300">×</button>
            </div>
            <textarea aria-label={t('dialogueContent')} placeholder={t('dialoguePlaceholder')} value={line.text} onChange={(event) => props.onUpdateDialogue(line.id, { text: event.target.value })} className="min-h-16 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm" />
            <input aria-label={t('emotion')} placeholder={t('emotionPlaceholder')} value={line.emotion} onChange={(event) => props.onUpdateDialogue(line.id, { emotion: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
          </div>
        ))}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" aria-pressed={props.audioMode === 'preserve-original'} disabled={!props.hasAudio} onClick={() => props.onAudioModeChange('preserve-original')} className={`min-h-11 min-w-11 rounded-xl border px-3 py-2.5 text-xs ${props.audioMode === 'preserve-original' ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-text-tertiary'} disabled:opacity-40`}>{t('preserveOriginal')}</button>
          <button type="button" aria-pressed={props.audioMode === 'generate'} onClick={() => props.onAudioModeChange('generate')} className={`min-h-11 min-w-11 rounded-xl border px-3 py-2.5 text-xs ${props.audioMode === 'generate' ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-text-tertiary'}`}>{t('generateAudio')}</button>
        </div>
      </div>
    </div>
  )
}

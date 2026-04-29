'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

/**
 * Phase 11.1: Dashboard 「項目設定」唯讀區塊（純 presentational）
 *
 * - 唯讀展示：videoRatio / targetDuration / ttsRate / 6 個 model
 * - 風格 badge：自訂 / 未設定 + 參考圖數量（不反推 preset 名 — Q-1 C）
 * - 「打開項目設定」按鈕走父層的 SettingsModal，不複製 form
 */

export interface ProjectSettingsModelsSummary {
  analysis: string | null
  character: string | null
  location: string | null
  storyboard: string | null
  edit: string | null
  video: string | null
}

export interface ProjectStyleProfileSummary {
  isCustom: boolean
  referenceImageCount: number
}

export interface ProjectSettingsProps {
  videoRatio: string
  targetDuration: number
  ttsRate: string
  models: ProjectSettingsModelsSummary
  styleProfileSummary: ProjectStyleProfileSummary
  onOpenSettingsModal: () => void
}

interface InfoBadgeProps {
  label: string
  value: string
}

function InfoBadge({ label, value }: InfoBadgeProps) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2 rounded-xl bg-[var(--glass-bg-muted)]">
      <span className="text-xs text-[var(--glass-text-tertiary)] uppercase tracking-wider">{label}</span>
      <span className="text-sm font-semibold text-[var(--glass-text-primary)] truncate">{value}</span>
    </div>
  )
}

export default function ProjectSettings({
  videoRatio,
  targetDuration,
  ttsRate,
  models,
  styleProfileSummary,
  onOpenSettingsModal,
}: ProjectSettingsProps) {
  const t = useTranslations('workspaceDetail')
  const tc = useTranslations('common')

  const fallback = tc('none')
  const styleLabel = styleProfileSummary.isCustom ? t('customStyle') : t('noStyleSet')

  return (
    <section className="glass-surface rounded-2xl p-5 space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--glass-text-primary)] flex items-center gap-2">
          <AppIcon name="settingsHex" className="w-5 h-5" />
          {t('projectSettings')}
        </h2>
        <button
          onClick={onOpenSettingsModal}
          className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-3 py-1.5 text-sm"
        >
          {t('openSettings')}
        </button>
      </header>

      {/* Style badge — Q-1 C: 自訂 / 未設定，不反推 preset 名 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-3 rounded-xl bg-[var(--glass-tone-info-bg)] border border-[var(--glass-stroke-base)]">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--glass-text-tertiary)] uppercase tracking-wider">
            {t('currentStyle')}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[var(--glass-text-primary)]">{styleLabel}</span>
            <span className="text-xs text-[var(--glass-text-secondary)]">
              {t('referenceImageCount', { count: styleProfileSummary.referenceImageCount })}
            </span>
          </div>
        </div>
        <span className="text-xs text-[var(--glass-text-tertiary)]">{t('editStyleHint')}</span>
      </div>

      {/* Read-only badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <InfoBadge label="Ratio" value={videoRatio || fallback} />
        <InfoBadge label="Duration" value={`${targetDuration}s`} />
        <InfoBadge label="TTS Rate" value={ttsRate || fallback} />
        <InfoBadge label="Analysis" value={models.analysis || fallback} />
        <InfoBadge label="Character" value={models.character || fallback} />
        <InfoBadge label="Location" value={models.location || fallback} />
        <InfoBadge label="Storyboard" value={models.storyboard || fallback} />
        <InfoBadge label="Edit" value={models.edit || fallback} />
        <InfoBadge label="Video" value={models.video || fallback} />
      </div>
    </section>
  )
}

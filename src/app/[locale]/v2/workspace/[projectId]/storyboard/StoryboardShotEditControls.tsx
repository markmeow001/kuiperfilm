'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

export interface StoryboardShotEditControlsProps {
  canEdit: boolean
  hasSelection: boolean
  selectedNumber: number | null
  canMoveEarlier: boolean
  canMoveLater: boolean
  isBusy: boolean
  error: string | null
  viewerTip?: string
  onInsertBefore: () => void
  onInsertAfter: () => void
  onMoveEarlier: () => void
  onMoveLater: () => void
  onDelete: () => void
}

export function StoryboardShotEditControls({
  canEdit,
  hasSelection,
  selectedNumber,
  canMoveEarlier,
  canMoveLater,
  isBusy,
  error,
  viewerTip,
  onInsertBefore,
  onInsertAfter,
  onMoveEarlier,
  onMoveLater,
  onDelete,
}: StoryboardShotEditControlsProps) {
  const t = useTranslations('v2Storyboard')
  const mutationDisabled = !canEdit || !hasSelection || isBusy
  const permissionTitle = !canEdit ? viewerTip : undefined

  return (
    <section
      aria-label={t('shotEdit.ariaLabel')}
      className="rounded-[var(--r-card)] border border-border-soft bg-surface-raised px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold text-text-secondary">
          {selectedNumber
            ? t('shotEdit.selected', { number: selectedNumber })
            : t('shotEdit.noSelection')}
        </span>
        <EditButton
          icon="plus"
          label={t('shotEdit.insertBefore')}
          disabled={mutationDisabled}
          title={permissionTitle ?? t('shotEdit.sameGroupOnly')}
          onClick={() => {
            if (mutationDisabled) return
            onInsertBefore()
          }}
        />
        <EditButton
          icon="plus"
          label={t('shotEdit.insertAfter')}
          disabled={mutationDisabled}
          title={permissionTitle ?? t('shotEdit.sameGroupOnly')}
          onClick={() => {
            if (mutationDisabled) return
            onInsertAfter()
          }}
        />
        <EditButton
          icon="arrowLeft"
          label={t('shotEdit.moveEarlier')}
          disabled={mutationDisabled || !canMoveEarlier}
          title={permissionTitle ?? t('shotEdit.sameGroupOnly')}
          onClick={() => {
            if (mutationDisabled || !canMoveEarlier) return
            onMoveEarlier()
          }}
        />
        <EditButton
          icon="arrowRight"
          label={t('shotEdit.moveLater')}
          disabled={mutationDisabled || !canMoveLater}
          title={permissionTitle ?? t('shotEdit.sameGroupOnly')}
          onClick={() => {
            if (mutationDisabled || !canMoveLater) return
            onMoveLater()
          }}
        />
        <EditButton
          icon="trash"
          label={t('shotEdit.delete')}
          disabled={mutationDisabled}
          title={permissionTitle ?? t('shotEdit.deleteTitle')}
          danger
          onClick={() => {
            if (mutationDisabled) return
            onDelete()
          }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-text-tertiary">
        {t('shotEdit.sameGroupOnly')}
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-input border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}

function EditButton({
  icon,
  label,
  disabled,
  title,
  danger = false,
  onClick,
}: {
  icon: 'plus' | 'arrowLeft' | 'arrowRight' | 'trash'
  label: string
  disabled: boolean
  title?: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-input border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-rose-500/30 text-rose-300 hover:bg-rose-500/10'
          : 'border-border-soft text-text-secondary hover:border-primary-500/40 hover:bg-primary-500/5 hover:text-primary-300'
      }`}
    >
      <AppIcon name={icon} className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

'use client'

import { AppIcon } from '@/components/ui/icons'
import { isPresetComingSoonModel, type CustomModel } from '../types'
import type { UseProviderCardStateResult } from './hooks/useProviderCardState'
import type { ProviderCardProps, ProviderCardTranslator } from './types'

export interface ModelRowProps {
  model: CustomModel
  t: ProviderCardTranslator
  state: UseProviderCardStateResult
  onToggleModel: ProviderCardProps['onToggleModel']
  onDeleteModel: ProviderCardProps['onDeleteModel']
  onUpdateModel: ProviderCardProps['onUpdateModel']
}

function formatPriceAmount(amount: number): string {
  const fixed = amount.toFixed(4)
  const normalized = fixed.replace(/\.?0+$/, '')
  return normalized || '0'
}

export function getModelPriceTexts(model: CustomModel, t: ProviderCardTranslator): string[] {
  if (
    model.type === 'llm'
    && typeof model.priceInput === 'number'
    && Number.isFinite(model.priceInput)
    && typeof model.priceOutput === 'number'
    && Number.isFinite(model.priceOutput)
  ) {
    return [
      t('priceInput', { amount: `¥${formatPriceAmount(model.priceInput)}` }),
      t('priceOutput', { amount: `¥${formatPriceAmount(model.priceOutput)}` }),
    ]
  }

  const label = typeof model.priceLabel === 'string' ? model.priceLabel.trim() : ''
  if (label) {
    return [label === '--' ? t('priceUnavailable') : `¥${label}`]
  }
  if (typeof model.price === 'number' && Number.isFinite(model.price) && model.price > 0) {
    return [`¥${formatPriceAmount(model.price)}`]
  }
  return [t('priceUnavailable')]
}

export function ModelRow({
  model,
  t,
  state,
  onToggleModel,
  onDeleteModel,
  onUpdateModel,
}: ModelRowProps) {
  const priceTexts = getModelPriceTexts(model, t)
  const priceText = priceTexts.join(' / ')
  const isComingSoonModel = isPresetComingSoonModel(model.provider, model.modelId)
  const rowDisabledClass = model.enabled ? '' : 'opacity-50'

  return (
    <div className={`group flex items-center justify-between gap-2 rounded-xl bg-[var(--glass-bg-surface)] px-3 py-2 transition-colors hover:bg-[var(--glass-bg-surface-strong)] ${rowDisabledClass}`}>
      {state.editingModelId === model.modelKey ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              type="text"
              value={state.editModel.name}
              onChange={(event) =>
                state.setEditModel({ ...state.editModel, name: event.target.value })
              }
              className="glass-input-base w-full px-3 py-1.5 text-[12px]"
              placeholder={t('modelDisplayName')}
            />
            <input
              type="text"
              value={state.editModel.modelId}
              onChange={(event) =>
                state.setEditModel({ ...state.editModel, modelId: event.target.value })
              }
              className="glass-input-base w-full px-3 py-1.5 text-[12px] font-mono"
              placeholder={t('modelActualId')}
            />
            <div className="text-xs text-[var(--glass-text-tertiary)]">{priceText}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => state.handleSaveModel(model.modelKey)}
              className="glass-icon-btn-sm"
              title={t('save')}
            >
              <AppIcon name="check" className="h-4 w-4" />
            </button>
            <button
              onClick={state.handleCancelEditModel}
              className="glass-icon-btn-sm"
              title={t('cancel')}
            >
              <AppIcon name="close" className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[12px] font-semibold ${model.enabled ? 'text-[var(--glass-text-primary)]' : 'text-[var(--glass-text-secondary)]'}`}>
                {model.name}
              </span>
              {state.isDefaultModel(model) && model.enabled && (
                <span className="shrink-0 rounded-md bg-[var(--glass-text-primary)] px-1.5 py-0.5 text-[10px] leading-none text-white">
                  {t('default')}
                </span>
              )}
              <span className="shrink-0 text-[11px] text-[var(--glass-text-tertiary)]">{priceText}</span>
            </div>
            <span className="break-all text-[11px] text-[var(--glass-text-tertiary)]">{model.modelId}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {!state.isPresetModel(model.modelKey) && onUpdateModel && (
              <button
                onClick={() => state.handleEditModel(model)}
                className="glass-icon-btn-sm opacity-0 transition-opacity group-hover:opacity-100"
                title={t('configure')}
              >
                <AppIcon name="edit" className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => onDeleteModel(model.modelKey)}
              className="glass-icon-btn-sm opacity-0 transition-opacity hover:text-[var(--glass-tone-danger-fg)] group-hover:opacity-100"
            >
              <AppIcon name="trash" className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => {
                if (isComingSoonModel) return
                onToggleModel(model.modelKey)
              }}
              className={`glass-toggle ${isComingSoonModel ? 'cursor-not-allowed opacity-60' : ''}`}
              data-active={model.enabled}
              disabled={isComingSoonModel}
              title={isComingSoonModel ? t('comingSoon') : undefined}
            >
              <div className="glass-toggle-thumb"></div>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

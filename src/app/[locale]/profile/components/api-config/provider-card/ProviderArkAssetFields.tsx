'use client'

/**
 * 火山方舟 asset API 凭证(AK/SK)inline editor.
 *
 * Rendered under ProviderBaseFields when providerId === 'ark'. The
 * asset API (CreateAssetGroup / CreateAsset / GetAsset) uses Volcengine
 * SigV4 (AK/SK + HMAC-SHA256) instead of the Bearer apiKey that powers
 * Seedance video generation. Without these, character images that look
 * photoreal get rejected by Seedance 2.0's face filter — see
 * src/lib/ark-asset-api.ts header for the full rationale.
 *
 * Three fields:
 *   - accessKeyId (plaintext, not a secret)
 *   - secretAccessKey (encrypted on the server, masked here)
 *   - assetGroupId (read-only display, auto-populated by the
 *     register-ark-asset worker on first use)
 *
 * Edit semantics mirror ProviderBaseFields' apiKey UX: click the edit
 * pencil → type → save / cancel. Passing '' clears; passing undefined
 * (no field touched in the patch) leaves the existing encrypted value
 * untouched on the server.
 */
import { useState } from 'react'
import type { Provider } from '../types'
import type { ProviderCardTranslator } from './types'
import { AppIcon } from '@/components/ui/icons'

interface ProviderArkAssetFieldsProps {
  provider: Provider
  t: ProviderCardTranslator
  onUpdate: (patch: { accessKeyId?: string; secretAccessKey?: string }) => void
}

function maskKey(value: string): string {
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`
}

export function ProviderArkAssetFields({ provider, t, onUpdate }: ProviderArkAssetFieldsProps) {
  const [editingAk, setEditingAk] = useState(false)
  const [editingSk, setEditingSk] = useState(false)
  const [tempAk, setTempAk] = useState('')
  const [tempSk, setTempSk] = useState('')
  const [showAk, setShowAk] = useState(false)

  function startEditAk() {
    setTempAk(provider.accessKeyId ?? '')
    setEditingAk(true)
  }
  function saveAk() {
    onUpdate({ accessKeyId: tempAk.trim() })
    setEditingAk(false)
  }
  function cancelAk() {
    setTempAk('')
    setEditingAk(false)
  }

  function startEditSk() {
    setTempSk('')
    setEditingSk(true)
  }
  function saveSk() {
    const trimmed = tempSk.trim()
    if (!trimmed) {
      // Empty submit clears the existing SK — match apiKey UX.
      onUpdate({ secretAccessKey: '' })
    } else {
      onUpdate({ secretAccessKey: trimmed })
    }
    setEditingSk(false)
  }
  function cancelSk() {
    setTempSk('')
    setEditingSk(false)
  }

  const hasAk = Boolean(provider.accessKeyId)
  const hasSk = Boolean(provider.hasSecretAccessKey)
  const assetGroupId = provider.assetGroupId ?? ''

  return (
    <div className="space-y-2 px-3.5 pb-2.5 pt-1">
      <div className="px-1 text-[11px] uppercase tracking-wider text-[var(--glass-text-tertiary)]">
        {t('arkAssetCredentialsLabel')}
      </div>

      {/* Access Key ID — plaintext, not a secret */}
      <div className="glass-surface-soft flex items-center gap-2.5 rounded-xl px-3 py-2">
        <span className="w-[80px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-[var(--glass-text-primary)]">
          Access Key ID
        </span>
        {editingAk ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              type="text"
              value={tempAk}
              onChange={(e) => setTempAk(e.target.value)}
              placeholder="AKLT…"
              className="glass-input-base flex-1 px-3 py-1.5 font-mono text-[12px]"
              autoFocus
            />
            <button onClick={saveAk} className="glass-icon-btn-sm" title={t('save')}>
              <AppIcon name="check" className="h-4 w-4" />
            </button>
            <button onClick={cancelAk} className="glass-icon-btn-sm" title={t('cancel')}>
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {hasAk ? (
              <>
                <span className="min-w-0 max-w-[260px] flex-1 truncate rounded-lg bg-[var(--glass-bg-surface)] px-3 py-1.5 font-mono text-[12px] text-[var(--glass-text-secondary)]">
                  {showAk ? provider.accessKeyId : maskKey(provider.accessKeyId ?? '')}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setShowAk(!showAk)}
                    className="glass-icon-btn-sm"
                    title={showAk ? t('hide') : t('show')}
                  >
                    {showAk ? (
                      <AppIcon name="eye" className="h-4 w-4" />
                    ) : (
                      <AppIcon name="eyeOff" className="h-4 w-4" />
                    )}
                  </button>
                  <button onClick={startEditAk} className="glass-icon-btn-sm" title={t('configure')}>
                    <AppIcon name="edit" className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={startEditAk}
                className="glass-btn-base glass-btn-tone-info h-7 px-2.5 text-[12px] font-semibold"
              >
                <AppIcon name="plus" className="h-3.5 w-3.5" />
                <span>{t('connect')}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Secret Access Key — encrypted, never re-displayed plaintext */}
      <div className="glass-surface-soft flex items-center gap-2.5 rounded-xl px-3 py-2">
        <span className="w-[80px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-[var(--glass-text-primary)]">
          Secret Access Key
        </span>
        {editingSk ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              type="password"
              value={tempSk}
              onChange={(e) => setTempSk(e.target.value)}
              placeholder={hasSk ? '••••••••(留空清除)' : '输入新值'}
              className="glass-input-base flex-1 px-3 py-1.5 font-mono text-[12px]"
              autoFocus
            />
            <button onClick={saveSk} className="glass-icon-btn-sm" title={t('save')}>
              <AppIcon name="check" className="h-4 w-4" />
            </button>
            <button onClick={cancelSk} className="glass-icon-btn-sm" title={t('cancel')}>
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {hasSk ? (
              <>
                <span className="min-w-0 max-w-[260px] flex-1 truncate rounded-lg bg-[var(--glass-bg-surface)] px-3 py-1.5 font-mono text-[12px] text-[var(--glass-text-secondary)]">
                  ••••••••••••（已保存）
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={startEditSk} className="glass-icon-btn-sm" title={t('configure')}>
                    <AppIcon name="edit" className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={startEditSk}
                className="glass-btn-base glass-btn-tone-info h-7 px-2.5 text-[12px] font-semibold"
              >
                <AppIcon name="plus" className="h-3.5 w-3.5" />
                <span>{t('connect')}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Asset Group ID — read-only display, auto-created on first use */}
      {assetGroupId ? (
        <div className="glass-surface-soft flex items-center gap-2.5 rounded-xl px-3 py-2">
          <span className="w-[80px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-[var(--glass-text-primary)]">
            Asset Group
          </span>
          <span className="min-w-0 flex-1 truncate rounded-lg bg-[var(--glass-bg-surface)] px-3 py-1.5 font-mono text-[11px] text-[var(--glass-text-tertiary)]">
            {assetGroupId}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-emerald-500">自动创建</span>
        </div>
      ) : (
        <div className="px-1 text-[10px] text-[var(--glass-text-tertiary)]">
          首次注册角色时，系统会自动创建 Asset Group(需先在控制台签署 Seedance 2.0 高级创作权益包授权函)
        </div>
      )}
    </div>
  )
}

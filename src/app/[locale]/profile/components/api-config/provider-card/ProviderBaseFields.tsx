'use client'

import { useState } from 'react'
import type { ProviderCardProps, ProviderCardTranslator } from './types'
import type { UseProviderCardStateResult } from './hooks/useProviderCardState'
import { AppIcon } from '@/components/ui/icons'
import { ProviderTencentVODFields } from './ProviderTencentVODFields'

type TestConnectionApiProvider = 'openrouter' | 'google' | 'anthropic' | 'openai' | 'custom' | 'taijiai' | 'fal' | 'atlascloud' | 'ark'

// Map the UI's internal providerKey to the /test-connection endpoint's
// supported set. Anything not in the explicit list falls back to 'custom'
// with the user-configured baseUrl.
//
// IMPORTANT: providers with a real endpoint-specific probe (e.g. taijiai
// pings /v1/videos/<probe>, not /v1/models) must be enumerated here.
// Falling through to 'custom' calls models.list which can succeed even
// when the token lacks permissions for the actual feature endpoint —
// false-positive "connected" indicator. fal / atlascloud / ark have no
// /v1/models endpoint we use (or any at all), so the fallthrough produces
// the misleading "自定义渠道需要提供 baseUrl" error instead of testing
// the real key.
function mapToTestProvider(providerKey: string): TestConnectionApiProvider {
  switch (providerKey) {
    case 'openrouter': return 'openrouter'
    case 'google': return 'google'
    case 'anthropic': return 'anthropic'
    case 'openai': return 'openai'
    case 'taijiai': return 'taijiai'
    case 'fal': return 'fal'
    case 'atlascloud': return 'atlascloud'
    case 'ark': return 'ark'
    default: return 'custom'
  }
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; latencyMs: number; message: string; model?: string; answer?: string }
  | { kind: 'fail'; message: string }

interface ProviderBaseFieldsProps {
  provider: ProviderCardProps['provider']
  t: ProviderCardTranslator
  state: UseProviderCardStateResult
  onUpdateApiKey: ProviderCardProps['onUpdateApiKey']
}

export function ProviderBaseFields({ provider, t, state, onUpdateApiKey }: ProviderBaseFieldsProps) {
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: 'idle' })

  async function handleTestConnection() {
    if (!provider.apiKey || !provider.hasApiKey) return
    setTestStatus({ kind: 'running' })
    try {
      const res = await fetch('/api/user/api-config/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: mapToTestProvider(state.providerKey),
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = json?.error?.details?.message
          || json?.error?.message
          || json?.error?.code
          || `HTTP ${res.status}`
        setTestStatus({ kind: 'fail', message: String(msg) })
        return
      }
      setTestStatus({
        kind: 'ok',
        latencyMs: Number(json.latencyMs) || 0,
        message: String(json.message || '连接成功'),
        model: json.model,
        answer: json.answer,
      })
    } catch (err) {
      setTestStatus({ kind: 'fail', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // 騰訊雲 VOD AIGC 需要多欄位憑證（SecretId/SecretKey/SubAppId/Region），改用專用 UI
  if (state.providerKey === 'tencent-vod' || state.providerKey === 'tencent' || state.providerKey === 'vod') {
    return <ProviderTencentVODFields provider={provider} t={t} onUpdateApiKey={onUpdateApiKey} />
  }
  // 騰訊混元 LLM 複用同一個 form,但 Hunyuan 不用 SubAppId 所以隱藏該欄位。
  // SecretId/SecretKey 跟 VOD 是同一組(同帳號),admin 不用申請額外的 bearer key。
  if (state.providerKey === 'tencent-hunyuan') {
    return <ProviderTencentVODFields provider={provider} t={t} onUpdateApiKey={onUpdateApiKey} requireSubAppId={false} />
  }
  const baseUrlPlaceholder = (() => {
    switch (state.providerKey) {
      case 'gemini-compatible':
        return 'https://your-api-domain.com'
      case 'openai-compatible':
        return 'https://api.openai.com/v1'
      default:
        return 'http://localhost:8000'
    }
  })()

  return (
    <>
      <div className="px-3.5 pt-2.5">
        <div className="glass-surface-soft flex items-center gap-2.5 rounded-xl px-3 py-2">
          <span className="w-[64px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-[var(--glass-text-primary)]">
            {t('apiKeyLabel')}
          </span>
          {state.isEditing ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={state.tempKey}
                onChange={(event) => state.setTempKey(event.target.value)}
                placeholder={t('enterApiKey')}
                className="glass-input-base flex-1 px-3 py-1.5 text-[12px]"
                autoFocus
              />
              <button
                onClick={state.handleSaveKey}
                className="glass-icon-btn-sm"
                title={t('save')}
              >
                <AppIcon name="check" className="h-4 w-4" />
              </button>
              <button
                onClick={state.handleCancelEdit}
                className="glass-icon-btn-sm"
                title={t('cancel')}
              >
                <AppIcon name="close" className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {provider.hasApiKey ? (
                <>
                  <span className="min-w-0 max-w-[220px] flex-1 truncate rounded-lg bg-[var(--glass-bg-surface)] px-3 py-1.5 font-mono text-[12px] text-[var(--glass-text-secondary)]">
                    {state.showKey ? provider.apiKey : state.maskedKey}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => state.setShowKey(!state.showKey)}
                      className="glass-icon-btn-sm"
                      title={state.showKey ? t('hide') : t('show')}
                    >
                      {state.showKey ? (
                        <AppIcon name="eye" className="h-4 w-4" />
                      ) : (
                        <AppIcon name="eyeOff" className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={state.startEditKey}
                      className="glass-icon-btn-sm"
                      title={t('configure')}
                    >
                      <AppIcon name="edit" className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleTestConnection}
                      disabled={testStatus.kind === 'running'}
                      className="glass-icon-btn-sm"
                      title="测试连线"
                    >
                      {testStatus.kind === 'running' ? (
                        <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                      ) : (
                        <AppIcon name="bolt" className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={state.startEditKey}
                  className="glass-btn-base glass-btn-tone-info h-7 px-2.5 text-[12px] font-semibold"
                >
                  <AppIcon name="plus" className="h-3.5 w-3.5" />
                  <span>{t('connect')}</span>
                </button>
              )}
            </div>
          )}
        </div>
        {(testStatus.kind === 'ok' || testStatus.kind === 'fail') && (
          <div
            className={`mt-1.5 flex items-start gap-1.5 px-1 font-mono text-[11px] ${
              testStatus.kind === 'ok' ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            <span className="shrink-0 leading-relaxed">
              {testStatus.kind === 'ok' ? '✓' : '✗'}
            </span>
            <span className="min-w-0 break-words leading-relaxed">
              {testStatus.kind === 'ok'
                ? `${testStatus.message} · ${testStatus.latencyMs}ms${
                    testStatus.model ? ` · ${testStatus.model}` : ''
                  }${testStatus.answer ? ` · 回复"${testStatus.answer}"` : ''}`
                : testStatus.message}
            </span>
          </div>
        )}
      </div>

      {state.showBaseUrlEdit && (
        <div className="px-3.5 pb-2.5 pt-2">
          <div className="glass-surface-soft flex items-center gap-2.5 rounded-xl px-3 py-2">
            <div className="flex w-full items-center gap-2">
              <span className="w-[64px] shrink-0 whitespace-nowrap text-[12px] font-semibold text-[var(--glass-text-tertiary)]">
                {t('baseUrl')}
              </span>
              {state.isEditingUrl ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={state.tempUrl}
                    onChange={(event) => state.setTempUrl(event.target.value)}
                    placeholder={baseUrlPlaceholder}
                    className="glass-input-base flex-1 px-3 py-1.5 text-[12px] font-mono"
                    autoFocus
                  />
                  <button
                    onClick={state.handleSaveUrl}
                    className="glass-icon-btn-sm"
                    title={t('save')}
                  >
                    <AppIcon name="check" className="h-4 w-4" />
                  </button>
                  <button
                    onClick={state.handleCancelUrlEdit}
                    className="glass-icon-btn-sm"
                    title={t('cancel')}
                  >
                    <AppIcon name="close" className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {provider.baseUrl ? (
                    <span className="min-w-0 flex-1 truncate rounded-lg bg-[var(--glass-bg-surface)] px-3 py-1.5 font-mono text-[12px] text-[var(--glass-text-secondary)]">
                      {provider.baseUrl}
                    </span>
                  ) : (
                    <button
                      onClick={state.startEditUrl}
                      className="glass-btn-base glass-btn-tone-info h-7 px-2.5 text-[12px] font-semibold"
                    >
                      <AppIcon name="plus" className="h-3.5 w-3.5" />
                      <span>{t('configureBaseUrl')}</span>
                    </button>
                  )}
                  {provider.baseUrl && (
                    <button
                      onClick={state.startEditUrl}
                      className="glass-icon-btn-sm shrink-0"
                      title={t('configure')}
                    >
                      <AppIcon name="edit" className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

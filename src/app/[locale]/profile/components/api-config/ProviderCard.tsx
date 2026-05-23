'use client'

import { useTranslations } from 'next-intl'
import { ProviderAdvancedFields } from './provider-card/ProviderAdvancedFields'
import { ProviderArkAssetFields } from './provider-card/ProviderArkAssetFields'
import { ProviderBaseFields } from './provider-card/ProviderBaseFields'
import { ProviderCardShell } from './provider-card/ProviderCardShell'
import { useProviderCardState } from './provider-card/hooks/useProviderCardState'
import type { ProviderCardProps } from './provider-card/types'

export function ProviderCard({
  provider,
  models,
  allModels,
  defaultModels,
  onToggleModel,
  onUpdateApiKey,
  onUpdateBaseUrl,
  onUpdateArkCredentials,
  onDeleteModel,
  onUpdateModel,
  onDeleteProvider,
  onAddModel,
}: ProviderCardProps) {
  const t = useTranslations('apiConfig')

  const state = useProviderCardState({
    provider,
    models,
    allModels,
    defaultModels,
    onUpdateApiKey,
    onUpdateBaseUrl,
    onUpdateModel,
    onAddModel,
    t,
  })

  return (
    <ProviderCardShell provider={provider} onDeleteProvider={onDeleteProvider} t={t} state={state}>
      <ProviderBaseFields provider={provider} t={t} state={state} onUpdateApiKey={onUpdateApiKey} />
      {/* 2026-05-22 — 火山方舟 asset API credentials. Only ARK provider has
          this extra block; passes patch up via onUpdateArkCredentials so
          AK/SK encryption + persist round-trips through PUT /api/user/api-config. */}
      {provider.id === 'ark' && onUpdateArkCredentials ? (
        <ProviderArkAssetFields
          provider={provider}
          t={t}
          onUpdate={(patch) => onUpdateArkCredentials(provider.id, patch)}
        />
      ) : null}
      <ProviderAdvancedFields
        provider={provider}
        onToggleModel={onToggleModel}
        onDeleteModel={onDeleteModel}
        onUpdateModel={onUpdateModel}
        t={t}
        state={state}
      />
    </ProviderCardShell>
  )
}

export default ProviderCard

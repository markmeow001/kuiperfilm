'use client'

import type { CustomModel, Provider } from '../api-config'
import { ProviderCard, ProviderSection } from '../api-config'
import { AppIcon } from '@/components/ui/icons'

interface DefaultModels {
  analysisModel?: string
  characterModel?: string
  locationModel?: string
  storyboardModel?: string
  editModel?: string
  videoModel?: string
  lipSyncModel?: string
}

interface ApiConfigProviderListProps {
  modelProviders: Provider[]
  allModels: CustomModel[]
  defaultModels: DefaultModels
  audioProviders: Provider[]
  getModelsForProvider: (providerId: string) => CustomModel[]
  onAddGeminiProvider: () => void
  onToggleModel: (modelKey: string, providerId: string) => void
  onUpdateApiKey: (providerId: string, apiKey: string) => void
  onUpdateBaseUrl: (providerId: string, baseUrl: string) => void
  // 2026-05-22 — 火山方舟 asset API AK/SK update. Only invoked for ark provider.
  onUpdateArkCredentials?: (
    providerId: string,
    patch: { accessKeyId?: string; secretAccessKey?: string },
  ) => void
  onDeleteModel: (modelKey: string, providerId: string) => void
  onUpdateModel: (modelKey: string, updates: Partial<CustomModel>, providerId: string) => void
  onDeleteProvider: (providerId: string) => void
  onAddModel: (model: Omit<CustomModel, 'enabled'>) => void
  labels: {
    providerPool: string
    addGeminiProvider: string
    otherProviders: string
    audioCategory: string
    audioApiKey: string
  }
}

const AUDIO_ICON = (
  <AppIcon name="cube" className="h-4 w-4 text-[var(--glass-text-secondary)]" />
)

export function ApiConfigProviderList({
  modelProviders,
  allModels,
  defaultModels,
  audioProviders,
  getModelsForProvider,
  onAddGeminiProvider,
  onToggleModel,
  onUpdateApiKey,
  onUpdateBaseUrl,
  onUpdateArkCredentials,
  onDeleteModel,
  onUpdateModel,
  onDeleteProvider,
  onAddModel,
  labels,
}: ApiConfigProviderListProps) {
  const hasAudioProviders = audioProviders.length > 0
  const hasOtherProviders = hasAudioProviders

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-600/80">
              PROVIDER · POOL
            </div>
            <h2 className="mt-1 font-serif-cn text-xl font-medium text-stone-100">{labels.providerPool}</h2>
          </div>
          <button
            onClick={onAddGeminiProvider}
            className="cursor-pointer rounded-sm bg-amber-500 px-5 py-2.5 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400"
          >
            + {labels.addGeminiProvider}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {modelProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              models={getModelsForProvider(provider.id)}
              allModels={allModels}
              defaultModels={defaultModels}
              onToggleModel={(modelKey) => onToggleModel(modelKey, provider.id)}
              onUpdateApiKey={onUpdateApiKey}
              onUpdateBaseUrl={onUpdateBaseUrl}
              {...(onUpdateArkCredentials ? { onUpdateArkCredentials } : {})}
              onDeleteModel={(modelKey) => onDeleteModel(modelKey, provider.id)}
              onUpdateModel={(modelKey, updates) => onUpdateModel(modelKey, updates, provider.id)}
              onDeleteProvider={onDeleteProvider}
              onAddModel={onAddModel}
            />
          ))}
        </div>
      </div>

      {hasOtherProviders && (
        <div className="pt-4">
          <div className="mb-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-600/80">
              OTHER · PROVIDERS
            </div>
            <h2 className="mt-1 font-serif-cn text-xl font-medium text-stone-100">
              {labels.otherProviders}
              <span className="ml-2 font-fraunces text-sm italic text-stone-500">
                ({labels.audioCategory})
              </span>
            </h2>
          </div>
          <div className="space-y-4">
            {hasAudioProviders && (
              <ProviderSection
                title={labels.audioApiKey}
                icon={AUDIO_ICON}
                type="audio"
                providers={audioProviders}
                onUpdateApiKey={onUpdateApiKey}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

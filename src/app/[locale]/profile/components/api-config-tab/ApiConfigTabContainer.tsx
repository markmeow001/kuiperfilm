'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { GlassModalShell } from '@/components/ui/primitives'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import type { CapabilityValue } from '@/lib/model-config-contract'
import {
  encodeModelKey,
  getProviderDisplayName,
  parseModelKey,
  useProviders,
} from '../api-config'
import { ApiConfigToolbar } from './ApiConfigToolbar'
import { ApiConfigProviderList } from './ApiConfigProviderList'
import { useApiConfigFilters } from './hooks/useApiConfigFilters'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'
import { AppIcon } from '@/components/ui/icons'

type CustomProviderType = 'gemini-compatible' | 'openai-compatible'
type DefaultModelField =
  | 'analysisModel'
  | 'characterModel'
  | 'locationModel'
  | 'storyboardModel'
  | 'editModel'
  | 'videoModel'
  | 'lipSyncModel'

const MONO_ICON_BADGE =
  'inline-flex items-center justify-center rounded-sm border border-stone-800 bg-stone-900/60 p-1.5 text-stone-300'

const Icons = {
  settings: () => (
    <AppIcon name="settingsHex" className="w-3.5 h-3.5" />
  ),
  llm: () => (
    <AppIcon name="menu" className="w-3.5 h-3.5" />
  ),
  image: () => (
    <AppIcon name="image" className="w-3.5 h-3.5" />
  ),
  video: () => (
    <AppIcon name="video" className="w-3.5 h-3.5" />
  ),
  lipsync: () => (
    <AppIcon name="audioWave" className="w-3.5 h-3.5" />
  ),
  chevronDown: () => (
    <AppIcon name="chevronDown" className="w-3 h-3" />
  ),
}

interface DefaultModelCardConfig {
  field: DefaultModelField
  modelType: 'llm' | 'image' | 'video' | 'lipsync'
  title: string
  icon: keyof Pick<typeof Icons, 'llm' | 'image' | 'video' | 'lipsync'>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function extractCapabilityFieldsFromModel(
  capabilities: Record<string, unknown> | undefined,
  modelType: string,
): Array<{ field: string; options: CapabilityValue[] }> {
  if (!capabilities) return []
  const namespace = capabilities[modelType]
  if (!isRecord(namespace)) return []
  return Object.entries(namespace)
    .filter(([key, value]) => key.endsWith('Options') && Array.isArray(value) && value.every(isCapabilityValue) && value.length > 0)
    .map(([key, value]) => ({
      field: key.slice(0, -'Options'.length),
      options: value as CapabilityValue[],
    }))
}

function parseBySample(input: string, sample: CapabilityValue): CapabilityValue {
  if (typeof sample === 'number') return Number(input)
  if (typeof sample === 'boolean') return input === 'true'
  return input
}

function toCapabilityFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

export function ApiConfigTabContainer() {
  const locale = useLocale()
  const {
    providers,
    models,
    defaultModels,
    capabilityDefaults,
    loading,
    saveStatus,
    updateProviderApiKey,
    updateProviderBaseUrl,
    updateProviderArkCredentials,
    addProvider,
    deleteProvider,
    toggleModel,
    deleteModel,
    addModel,
    updateModel,
    updateDefaultModel,
    updateCapabilityDefault,
  } = useProviders()

  const t = useTranslations('apiConfig')
  const tc = useTranslations('common')
  const tp = useTranslations('providerSection')

  const savingState =
    saveStatus === 'saving'
      ? resolveTaskPresentationState({
        phase: 'processing',
        intent: 'modify',
        resource: 'text',
        hasOutput: true,
      })
      : null

  const {
    modelProviders,
    audioProviders,
    getModelsForProvider,
    getEnabledModelsByType,
  } = useApiConfigFilters({
    providers,
    models,
  })

  const [showAddGeminiProvider, setShowAddGeminiProvider] = useState(false)
  const [newGeminiProvider, setNewGeminiProvider] = useState<{
    name: string
    baseUrl: string
    apiKey: string
    apiType: CustomProviderType
  }>({
    name: '',
    baseUrl: '',
    apiKey: '',
    apiType: 'gemini-compatible',
  })

  const handleAddGeminiProvider = () => {
    if (!newGeminiProvider.name || !newGeminiProvider.baseUrl) {
      alert(tp('fillRequired'))
      return
    }

    const uuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const providerId = `${newGeminiProvider.apiType}:${uuid}`
    const name = newGeminiProvider.name.trim()
    const baseUrl = newGeminiProvider.baseUrl.trim()
    const apiKey = newGeminiProvider.apiKey.trim()

    addProvider({
      id: providerId,
      name,
      baseUrl,
      apiKey,
      apiMode: newGeminiProvider.apiType === 'openai-compatible' ? 'openai-official' : 'gemini-sdk',
    })

    setNewGeminiProvider({
      name: '',
      baseUrl: '',
      apiKey: '',
      apiType: 'gemini-compatible',
    })
    setShowAddGeminiProvider(false)
  }

  const handleCancelAddGeminiProvider = () => {
    setNewGeminiProvider({
      name: '',
      baseUrl: '',
      apiKey: '',
      apiType: 'gemini-compatible',
    })
    setShowAddGeminiProvider(false)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[var(--glass-text-tertiary)]">
        {tc('loading')}
      </div>
    )
  }

  const defaultModelCards: DefaultModelCardConfig[] = [
    { field: 'analysisModel', modelType: 'llm', title: t('textDefault'), icon: 'llm' },
    { field: 'characterModel', modelType: 'image', title: t('characterDefault'), icon: 'image' },
    { field: 'locationModel', modelType: 'image', title: t('locationDefault'), icon: 'image' },
    { field: 'storyboardModel', modelType: 'image', title: t('storyboardDefault'), icon: 'image' },
    { field: 'editModel', modelType: 'image', title: t('editDefault'), icon: 'image' },
    { field: 'videoModel', modelType: 'video', title: t('videoDefault'), icon: 'video' },
    { field: 'lipSyncModel', modelType: 'lipsync', title: t('lipsyncDefault'), icon: 'lipsync' },
  ]

  return (
    <div className="flex h-full flex-col">
      <ApiConfigToolbar
        title={t('title')}
        saveStatus={saveStatus}
        savingState={savingState}
        savingLabel={t('saving')}
        savedLabel={t('saved')}
        saveFailedLabel={t('saveFailed')}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-8 p-8">
          <div className="rounded-sm border border-amber-900/25 bg-stone-900/40 p-6">
            <div className="mb-3 flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Icons.settings />
              </span>
              <div>
                <h2 className="font-serif-cn text-xl font-medium text-stone-100">{t('defaultModels')}</h2>
                <p className="mt-1 font-fraunces text-sm italic text-stone-400">
                  {t('defaultModel.hint')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {defaultModelCards.map((card) => {
                const options = getEnabledModelsByType(card.modelType)
                const currentKey = defaultModels[card.field]
                const parsed = parseModelKey(currentKey)
                const normalizedKey = parsed ? encodeModelKey(parsed.provider, parsed.modelId) : ''
                const current = normalizedKey
                  ? options.find((option) => option.modelKey === normalizedKey)
                  : null
                const capabilityFields = (() => {
                  if (!current || !current.capabilities) return [] as Array<{ field: string; options: CapabilityValue[] }>
                  const namespace = current.capabilities[card.modelType]
                  if (!isRecord(namespace)) return [] as Array<{ field: string; options: CapabilityValue[] }>
                  return Object.entries(namespace)
                    .filter(([key, value]) => key.endsWith('Options') && Array.isArray(value) && value.every(isCapabilityValue) && value.length > 0)
                    .map(([key, value]) => ({
                      field: key.slice(0, -'Options'.length),
                      options: value as CapabilityValue[],
                    }))
                })()
                const ModelIcon = Icons[card.icon]

                return (
                  <div
                    key={card.field}
                    className="rounded-sm border border-stone-800 bg-stone-900/30 p-4"
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <span className={MONO_ICON_BADGE}>
                        <ModelIcon />
                      </span>
                      <span className="font-serif-cn text-base font-medium text-stone-100">
                        {card.title}
                      </span>
                    </div>
                    {card.modelType === 'video' || card.modelType === 'image' || card.modelType === 'llm' ? (
                      /* Unified model capability dropdown */
                      <ModelCapabilityDropdown
                        compact
                        models={options.map((opt) => ({
                          value: opt.modelKey,
                          label: opt.name,
                          provider: opt.provider,
                          providerName: opt.providerName || getProviderDisplayName(opt.provider, locale),
                        }))}
                        value={normalizedKey || undefined}
                        onModelChange={(newModelKey) => {
                          // 用新模型的 capabilities 计算 fields，而不是旧模型的
                          const newModel = options.find((opt) => opt.modelKey === newModelKey)
                          const newCapFields = extractCapabilityFieldsFromModel(
                            newModel?.capabilities as Record<string, unknown> | undefined,
                            card.modelType,
                          )
                          updateDefaultModel(card.field, newModelKey, newCapFields)
                        }}
                        capabilityFields={capabilityFields.map((d) => ({
                          ...d,
                          label: toCapabilityFieldLabel(d.field),
                        }))}
                        capabilityOverrides={
                          current
                            ? Object.fromEntries(
                              capabilityFields
                                .filter((d) => capabilityDefaults[current.modelKey]?.[d.field] !== undefined)
                                .map((d) => [d.field, capabilityDefaults[current.modelKey][d.field]])
                            )
                            : {}
                        }
                        onCapabilityChange={(field, rawValue, sample) => {
                          if (!current) return
                          if (!rawValue) {
                            updateCapabilityDefault(current.modelKey, field, null)
                            return
                          }
                          updateCapabilityDefault(
                            current.modelKey,
                            field,
                            parseBySample(rawValue, sample),
                          )
                        }}
                        placeholder={t('selectDefault')}
                      />
                    ) : (
                      /* Non-video models: keep native select */
                      <>
                        <div className="relative">
                          <select
                            value={normalizedKey}
                            onChange={(event) => updateDefaultModel(card.field, event.target.value)}
                            className="w-full cursor-pointer appearance-none rounded-sm border border-stone-800 bg-stone-950 py-2 pl-3 pr-8 font-serif-cn text-sm text-stone-200 focus:border-amber-500/60 focus:outline-none"
                          >
                            <option value="">{t('selectDefault')}</option>
                            {options.map((option, index) => (
                              <option
                                key={`${option.modelKey}-${index}`}
                                value={option.modelKey}
                              >
                                {option.name} ({option.providerName || getProviderDisplayName(option.provider, locale)})
                              </option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute right-3 top-2.5 text-stone-500">
                            <Icons.chevronDown />
                          </div>
                        </div>
                        {current && card.modelType !== 'lipsync' && (
                          <div className="mt-2 flex items-center justify-between px-0.5">
                            <span className="font-mono text-xs tracking-wider text-stone-500">
                              {current.providerName}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <ApiConfigProviderList
            modelProviders={modelProviders}
            allModels={models}
            defaultModels={defaultModels}
            audioProviders={audioProviders}
            getModelsForProvider={getModelsForProvider}
            onAddGeminiProvider={() => setShowAddGeminiProvider(true)}
            onToggleModel={toggleModel}
            onUpdateApiKey={updateProviderApiKey}
            onUpdateBaseUrl={updateProviderBaseUrl}
            onUpdateArkCredentials={updateProviderArkCredentials}
            onDeleteModel={deleteModel}
            onUpdateModel={updateModel}
            onDeleteProvider={deleteProvider}
            onAddModel={addModel}
            labels={{
              providerPool: t('providerPool'),
              addGeminiProvider: t('addGeminiProvider'),
              otherProviders: t('otherProviders'),
              audioCategory: t('audioCategory'),
              audioApiKey: t('sections.audioApiKey'),
            }}
          />
        </div>
      </div>

      <GlassModalShell
        open={showAddGeminiProvider}
        onClose={handleCancelAddGeminiProvider}
        title={t('addGeminiProvider')}
        description={t('providerPool')}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancelAddGeminiProvider}
              className="rounded-sm border border-stone-700 px-4 py-2 font-serif-cn text-sm text-stone-300 hover:border-stone-600"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={handleAddGeminiProvider}
              className="rounded-sm bg-amber-500 px-4 py-2 font-serif-cn text-sm font-medium text-stone-950 hover:bg-amber-400"
            >
              {tp('add')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--glass-text-primary)]">
              {t('apiType')}
            </label>
            <div className="relative">
              <select
                value={newGeminiProvider.apiType}
                onChange={(event) =>
                  setNewGeminiProvider({
                    ...newGeminiProvider,
                    apiType: event.target.value as CustomProviderType,
                  })
                }
                className="glass-select-base w-full cursor-pointer appearance-none px-3 py-2.5 pr-8 text-sm"
              >
                <option value="gemini-compatible">{t('apiTypeGeminiCompatible')}</option>
                <option value="openai-compatible">{t('apiTypeOpenAICompatible')}</option>
              </select>
              <div className="pointer-events-none absolute right-3 top-3 text-[var(--glass-text-tertiary)]">
                <Icons.chevronDown />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--glass-text-primary)]">
              {tp('name')}
            </label>
            <input
              type="text"
              value={newGeminiProvider.name}
              onChange={(event) =>
                setNewGeminiProvider({
                  ...newGeminiProvider,
                  name: event.target.value,
                })
              }
              placeholder={tp('name')}
              className="glass-input-base w-full px-3 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--glass-text-primary)]">
              {t('baseUrl')}
            </label>
            <input
              type="text"
              value={newGeminiProvider.baseUrl}
              onChange={(event) =>
                setNewGeminiProvider({
                  ...newGeminiProvider,
                  baseUrl: event.target.value,
                })
              }
              placeholder={t('baseUrl')}
              className="glass-input-base w-full px-3 py-2.5 text-sm font-mono"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--glass-text-primary)]">
              {t('apiKeyLabel')}
            </label>
            <input
              type="password"
              value={newGeminiProvider.apiKey}
              onChange={(event) =>
                setNewGeminiProvider({
                  ...newGeminiProvider,
                  apiKey: event.target.value,
                })
              }
              placeholder={t('apiKeyLabel')}
              className="glass-input-base w-full px-3 py-2.5 text-sm"
            />
          </div>
        </div>
      </GlassModalShell>
    </div>
  )
}

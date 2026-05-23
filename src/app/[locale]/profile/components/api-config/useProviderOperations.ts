'use client'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import {
    Provider,
    CustomModel,
    PRESET_PROVIDERS,
    PRESET_MODELS,
    encodeModelKey,
    getProviderKey,
    isPresetComingSoonModelKey,
} from './types'
import type { MutableRefObject } from 'react'
import type { CapabilitySelections } from '@/lib/model-config-contract'

interface DefaultModels {
    analysisModel?: string
    characterModel?: string
    locationModel?: string
    storyboardModel?: string
    editModel?: string
    videoModel?: string
    lipSyncModel?: string
}

const DEFAULT_MODEL_FIELDS = [
    'analysisModel',
    'characterModel',
    'locationModel',
    'storyboardModel',
    'editModel',
    'videoModel',
    'lipSyncModel',
] as const

type PerformSave = (overrides?: { defaultModels?: DefaultModels; capabilityDefaults?: CapabilitySelections }, optimistic?: boolean) => Promise<void>

interface UseProviderOperationsParams {
    t: ReturnType<typeof useTranslations<'apiConfig'>>
    performSave: PerformSave
    latestProvidersRef: MutableRefObject<Provider[]>
    latestModelsRef: MutableRefObject<CustomModel[]>
    latestDefaultModelsRef: MutableRefObject<DefaultModels>
    setProviders: React.Dispatch<React.SetStateAction<Provider[]>>
    setModels: React.Dispatch<React.SetStateAction<CustomModel[]>>
    setDefaultModels: React.Dispatch<React.SetStateAction<DefaultModels>>
    fetchConfig: () => Promise<void>
}

export function useProviderOperations({
    t,
    performSave,
    latestProvidersRef,
    latestModelsRef,
    latestDefaultModelsRef,
    setProviders,
    setModels,
    setDefaultModels,
    fetchConfig,
}: UseProviderOperationsParams) {
    const updateProviderApiKey = useCallback((providerId: string, apiKey: string) => {
        setProviders(prev => {
            const next = prev.map(p =>
                p.id === providerId ? { ...p, apiKey, hasApiKey: !!apiKey } : p
            )
            latestProvidersRef.current = next
            void performSave(undefined, true)
            return next
        })
    }, [performSave, setProviders, latestProvidersRef])

    const addProvider = useCallback((provider: Omit<Provider, 'hasApiKey'>) => {
        setProviders(prev => {
            const normalizedProviderId = provider.id.toLowerCase()
            if (prev.some((p) => p.id.toLowerCase() === normalizedProviderId)) {
                alert(t('providerIdExists'))
                return prev
            }
            const newProvider: Provider = { ...provider, hasApiKey: !!provider.apiKey }
            const next = [...prev, newProvider]
            latestProvidersRef.current = next

            const providerKey = getProviderKey(provider.id)
            if (providerKey === 'gemini-compatible') {
                // 保存后直接 refetch：后端注入带完整 capabilities 的 Google 预设模型（disabled）
                void performSave(undefined, true).then(() => void fetchConfig())
            } else {
                void performSave(undefined, true)
            }
            return next
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, performSave, fetchConfig])

    const deleteProvider = useCallback((providerId: string) => {
        if (PRESET_PROVIDERS.find(p => p.id === providerId)) {
            alert(t('presetProviderCannotDelete'))
            return
        }
        if (confirm(t('confirmDeleteProvider'))) {
            setProviders(prev => {
                const next = prev.filter(p => p.id !== providerId)
                latestProvidersRef.current = next
                return next
            })
            setModels(prev => {
                const nextModels = prev.filter(m => m.provider !== providerId)
                setDefaultModels(prevDefaults => {
                    const updates: DefaultModels = { ...prevDefaults }
                    const remainingModelKeys = new Set(nextModels.map(m => m.modelKey))
                    DEFAULT_MODEL_FIELDS.forEach(field => {
                        const current = updates[field]
                        if (current && !remainingModelKeys.has(current)) {
                            updates[field] = ''
                        }
                    })
                    latestDefaultModelsRef.current = updates
                    return updates
                })
                latestModelsRef.current = nextModels
                void performSave(undefined, true) // 删除提供商：立刻保存
                return nextModels
            })
        }
    }, [t, performSave, setProviders, setModels, setDefaultModels, latestProvidersRef, latestModelsRef, latestDefaultModelsRef])

    const updateProviderInfo = useCallback((providerId: string, name: string, baseUrl?: string) => {
        setProviders(prev => {
            const next = prev.map(p =>
                p.id === providerId ? { ...p, name, baseUrl } : p
            )
            latestProvidersRef.current = next
            void performSave(undefined, true)
            return next
        })
    }, [performSave, setProviders, latestProvidersRef])

    const updateProviderBaseUrl = useCallback((providerId: string, baseUrl: string) => {
        setProviders(prev => {
            const next = prev.map(p =>
                p.id === providerId ? { ...p, baseUrl } : p
            )
            latestProvidersRef.current = next
            void performSave(undefined, true)
            return next
        })
    }, [performSave, setProviders, latestProvidersRef])

    // 2026-05-22 — 火山方舟 asset API credentials (id='ark').
    // Updates accessKeyId and/or secretAccessKey independently — passing
    // undefined leaves the existing value, passing '' clears it.
    // Same persist-on-edit semantics as updateProviderApiKey.
    const updateProviderArkCredentials = useCallback((
        providerId: string,
        patch: { accessKeyId?: string; secretAccessKey?: string },
    ) => {
        setProviders(prev => {
            const next = prev.map(p => {
                if (p.id !== providerId) return p
                const merged: typeof p = { ...p }
                if (patch.accessKeyId !== undefined) {
                    merged.accessKeyId = patch.accessKeyId
                }
                if (patch.secretAccessKey !== undefined) {
                    merged.secretAccessKey = patch.secretAccessKey
                    merged.hasSecretAccessKey = !!patch.secretAccessKey
                }
                return merged
            })
            latestProvidersRef.current = next
            void performSave(undefined, true)
            return next
        })
    }, [performSave, setProviders, latestProvidersRef])

    return {
        updateProviderApiKey,
        addProvider,
        deleteProvider,
        updateProviderInfo,
        updateProviderBaseUrl,
        updateProviderArkCredentials,
    }
}

interface UseModelOperationsParams {
    t: ReturnType<typeof useTranslations<'apiConfig'>>
    performSave: PerformSave
    latestModelsRef: MutableRefObject<CustomModel[]>
    latestDefaultModelsRef: MutableRefObject<DefaultModels>
    setModels: React.Dispatch<React.SetStateAction<CustomModel[]>>
    setDefaultModels: React.Dispatch<React.SetStateAction<DefaultModels>>
    models: CustomModel[]
}

export function useModelOperations({
    t,
    performSave,
    latestModelsRef,
    latestDefaultModelsRef,
    setModels,
    setDefaultModels,
    models,
}: UseModelOperationsParams) {
    const toggleModel = useCallback((modelKey: string, providerId?: string) => {
        if (isPresetComingSoonModelKey(modelKey)) {
            return
        }
        setModels(prev => {
            const next = prev.map(m =>
                m.modelKey === modelKey && (providerId ? m.provider === providerId : true)
                    ? { ...m, enabled: !m.enabled }
                    : m
            )
            latestModelsRef.current = next
            void performSave(undefined, true) // 开关操作：立刻保存
            return next
        })
    }, [performSave, setModels, latestModelsRef])

    const updateModel = useCallback((modelKey: string, updates: Partial<CustomModel>, providerId?: string) => {
        let nextModelKey = ''
        setModels(prev => prev.map(m => {
            if (m.modelKey !== modelKey || (providerId ? m.provider !== providerId : false)) return m
            const mergedProvider = updates.provider ?? m.provider
            const mergedModelId = updates.modelId ?? m.modelId
            nextModelKey = encodeModelKey(mergedProvider, mergedModelId)
            return {
                ...m,
                ...updates,
                provider: mergedProvider,
                modelId: mergedModelId,
                modelKey: nextModelKey,
                name: updates.name ?? m.name,
                price: updates.price ?? m.price,
            }
        }))
        if (nextModelKey && nextModelKey !== modelKey) {
            setDefaultModels(prev => {
                const next = { ...prev }
                DEFAULT_MODEL_FIELDS.forEach(field => {
                    if (next[field] === modelKey) next[field] = nextModelKey
                })
                return next
            })
        }
    }, [setModels, setDefaultModels])

    const addModel = useCallback((model: Omit<CustomModel, 'enabled'>) => {
        setModels(prev => {
            const next = [
                ...prev,
                {
                    ...model,
                    modelKey: model.modelKey || encodeModelKey(model.provider, model.modelId),
                    price: 0,
                    priceLabel: '--',
                    enabled: true,
                },
            ]
            latestModelsRef.current = next
            void performSave(undefined, true) // 添加模型：立刻保存
            return next
        })
    }, [performSave, setModels, latestModelsRef])

    const deleteModel = useCallback((modelKey: string, providerId?: string) => {
        if (PRESET_MODELS.find((model) => {
            const presetModelKey = encodeModelKey(model.provider, model.modelId)
            return presetModelKey === modelKey && (providerId ? model.provider === providerId : true)
        })) {
            alert(t('presetModelCannotDelete'))
            return
        }
        if (confirm(t('confirmDeleteModel'))) {
            setModels(prev => {
                const nextModels = prev.filter(m =>
                    !(m.modelKey === modelKey && (providerId ? m.provider === providerId : true))
                )
                setDefaultModels(prevDefaults => {
                    const nextDefaults = { ...prevDefaults }
                    const remainingModelKeys = new Set(nextModels.map(m => m.modelKey))
                    DEFAULT_MODEL_FIELDS.forEach(field => {
                        const current = nextDefaults[field]
                        if (current && !remainingModelKeys.has(current)) {
                            nextDefaults[field] = ''
                        }
                    })
                    latestDefaultModelsRef.current = nextDefaults
                    return nextDefaults
                })
                latestModelsRef.current = nextModels
                void performSave(undefined, true) // 删除模型：立刻保存
                return nextModels
            })
        }
    }, [t, performSave, setModels, setDefaultModels, latestModelsRef, latestDefaultModelsRef])

    const getModelsByType = useCallback((type: CustomModel['type']) => {
        return models.filter(m => m.type === type)
    }, [models])

    return {
        toggleModel,
        updateModel,
        addModel,
        deleteModel,
        getModelsByType,
    }
}

'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useLocale, useTranslations } from 'next-intl'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Provider,
    CustomModel,
    PRESET_PROVIDERS,
    PRESET_MODELS,
    encodeModelKey,
    getProviderKey,
    isPresetComingSoonModelKey,
    resolvePresetProviderName,
} from './types'
import type { CapabilitySelections, CapabilityValue } from '@/lib/model-config-contract'
import { parsePricingDisplayMap, applyPricingDisplay } from './pricingDisplay'
import { useProviderOperations, useModelOperations } from './useProviderOperations'

interface DefaultModels {
    analysisModel?: string
    characterModel?: string
    locationModel?: string
    storyboardModel?: string
    editModel?: string
    videoModel?: string
    lipSyncModel?: string
}

interface UseProvidersReturn {
    providers: Provider[]
    models: CustomModel[]
    defaultModels: DefaultModels
    capabilityDefaults: CapabilitySelections
    loading: boolean
    saveStatus: 'idle' | 'saving' | 'saved' | 'error'
    updateProviderApiKey: (providerId: string, apiKey: string) => void
    updateProviderBaseUrl: (providerId: string, baseUrl: string) => void
    addProvider: (provider: Omit<Provider, 'hasApiKey'>) => void
    deleteProvider: (providerId: string) => void
    updateProviderInfo: (providerId: string, name: string, baseUrl?: string) => void
    toggleModel: (modelKey: string, providerId?: string) => void
    updateModel: (modelKey: string, updates: Partial<CustomModel>, providerId?: string) => void
    addModel: (model: Omit<CustomModel, 'enabled'>) => void
    deleteModel: (modelKey: string, providerId?: string) => void
    updateDefaultModel: (field: string, modelKey: string, capabilityFieldsToDefault?: Array<{ field: string; options: CapabilityValue[] }>) => void
    updateCapabilityDefault: (modelKey: string, field: string, value: string | number | boolean | null) => void
    getModelsByType: (type: CustomModel['type']) => CustomModel[]
}

export function useProviders(): UseProvidersReturn {
    const locale = useLocale()
    const t = useTranslations('apiConfig')
    const presetProviders = PRESET_PROVIDERS.map((provider) => ({
        ...provider,
        name: resolvePresetProviderName(provider.id, provider.name, locale),
    }))
    const [providers, setProviders] = useState<Provider[]>(
        presetProviders.map((provider) => ({ ...provider, apiKey: '', hasApiKey: false })),
    )
    const [models, setModels] = useState<CustomModel[]>(
        PRESET_MODELS.map((model) => {
            const modelKey = encodeModelKey(model.provider, model.modelId)
            return {
                ...model,
                modelKey,
                price: 0,
                priceLabel: '--',
                enabled: !isPresetComingSoonModelKey(modelKey),
            }
        }),
    )
    const [defaultModels, setDefaultModels] = useState<DefaultModels>({})
    const [capabilityDefaults, setCapabilityDefaults] = useState<CapabilitySelections>({})
    const [loading, setLoading] = useState(true)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const initializedRef = useRef(false)

    // 始终持有最新值的 refs，用于避免异步保存时读到旧的闭包值
    const latestModelsRef = useRef(models)
    const latestProvidersRef = useRef(providers)
    const latestDefaultModelsRef = useRef(defaultModels)
    const latestCapabilityDefaultsRef = useRef(capabilityDefaults)
    useEffect(() => { latestModelsRef.current = models }, [models])
    useEffect(() => { latestProvidersRef.current = providers }, [providers])
    useEffect(() => { latestDefaultModelsRef.current = defaultModels }, [defaultModels])
    useEffect(() => { latestCapabilityDefaultsRef.current = capabilityDefaults }, [capabilityDefaults])

    // 加载配置
    useEffect(() => {
        fetchConfig()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function fetchConfig() {
        initializedRef.current = false
        let loadedSuccessfully = false
        try {
            const res = await fetch('/api/user/api-config')
            if (!res.ok) {
                throw new Error(`api-config load failed: HTTP ${res.status}`)
            }

            const data = await res.json()
            const pricingDisplay = parsePricingDisplayMap((data as { pricingDisplay?: unknown }).pricingDisplay)

            // 合并预设和已保存的提供商
            const savedProviders: Provider[] = data.providers || []
            const allProviders = presetProviders.map(preset => {
                const saved = savedProviders.find(p => getProviderKey(p.id) === preset.id)
                return {
                    ...preset,
                    apiKey: saved?.apiKey || '',
                    hasApiKey: !!saved?.apiKey,
                    // 保留用户保存的 baseUrl（用于自建服务）
                    baseUrl: saved?.baseUrl || preset.baseUrl
                }
            })
            const customProviders = savedProviders.filter(p =>
                !PRESET_PROVIDERS.find(preset => preset.id === getProviderKey(p.id))
            ).map(p => ({
                ...p,
                hasApiKey: !!p.apiKey
            }))
            setProviders([...allProviders, ...customProviders])

            // 合并预设和已保存的模型
            const savedModelsRaw = data.models || []
            const savedModelsNormalized = savedModelsRaw.map((m: CustomModel) => ({
                ...m,
                modelKey: m.modelKey || encodeModelKey(m.provider, m.modelId),
            }))
            const savedModels: CustomModel[] = []
            const seen = new Set<string>()
            for (const model of savedModelsNormalized) {
                const key = model.modelKey
                if (seen.has(key)) continue
                seen.add(key)
                savedModels.push(model)
            }
            const hasSavedModels = savedModels.length > 0
            const allModels = PRESET_MODELS.map(preset => {
                const presetModelKey = encodeModelKey(preset.provider, preset.modelId)
                const saved = savedModels.find((m: CustomModel) =>
                    m.modelKey === presetModelKey
                )
                const alwaysEnabledPreset = preset.type === 'lipsync'
                const mergedPreset: CustomModel = {
                    ...preset,
                    modelKey: presetModelKey,
                    enabled: isPresetComingSoonModelKey(presetModelKey)
                        ? false
                        : (hasSavedModels ? (alwaysEnabledPreset || !!saved) : false),
                    price: 0,
                    capabilities: saved?.capabilities ?? preset.capabilities,
                }
                return applyPricingDisplay(mergedPreset, pricingDisplay)
            })
            const customModels = savedModels.filter((m: CustomModel) =>
                !PRESET_MODELS.find((preset) => encodeModelKey(preset.provider, preset.modelId) === m.modelKey)
            ).map((m: CustomModel) => ({
                ...applyPricingDisplay(m, pricingDisplay),
                // 尊重服务端返回的 enabled 字段（后端对 disabled presets 会明确返回 enabled: false）
                enabled: (m as CustomModel & { enabled?: boolean }).enabled !== false,
            }))

            setModels([...allModels, ...customModels])

            // 加载默认模型配置
            if (data.defaultModels) {
                setDefaultModels(data.defaultModels)
            }
            if (data.capabilityDefaults && typeof data.capabilityDefaults === 'object') {
                setCapabilityDefaults(data.capabilityDefaults as CapabilitySelections)
            }
            loadedSuccessfully = true
        } catch (error) {
            _ulogError('获取配置失败:', error)
            setSaveStatus('error')
        } finally {
            setLoading(false)
            if (loadedSuccessfully) {
                // 延迟设置 initialized，确保所有状态更新完成后才开始监听
                setTimeout(() => {
                    initializedRef.current = true
                }, 100)
            }
        }
    }

    /**
     * 核心保存函数：始终从 ref 读取最新值，支持传入覆盖值（解决异步闭包旧值问题）
     * optimistic=true 时立刻显示「已保存」，不经历「保存中」状态，失败时才回退为「保存失败」
     */
    const performSave = useCallback(async (overrides?: {
        defaultModels?: DefaultModels
        capabilityDefaults?: CapabilitySelections
    }, optimistic = false) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current)
            saveTimeoutRef.current = null
        }
        if (optimistic) {
            // 与项目设置一致：立刻显示已保存，不等网络返回
            setSaveStatus('saved')
            setTimeout(() => setSaveStatus('idle'), 3000)
        } else {
            setSaveStatus('saving')
        }
        try {
            const currentModels = latestModelsRef.current
            const currentProviders = latestProvidersRef.current
            const currentDefaultModels = overrides?.defaultModels ?? latestDefaultModelsRef.current
            const currentCapabilityDefaults = overrides?.capabilityDefaults ?? latestCapabilityDefaultsRef.current
            const enabledModels = currentModels.filter(m => m.enabled)
            const res = await fetch('/api/user/api-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    models: enabledModels,
                    providers: currentProviders,
                    defaultModels: currentDefaultModels,
                    capabilityDefaults: currentCapabilityDefaults,
                }),
            })
            if (res.ok) {
                if (!optimistic) {
                    setSaveStatus('saved')
                    setTimeout(() => setSaveStatus('idle'), 3000)
                }
            } else {
                setSaveStatus('error')
            }
        } catch (error) {
            _ulogError('保存失败:', error)
            setSaveStatus('error')
        }
    }, []) // 无依赖，所有值均从 ref 读取

    // 默认模型操作：选中即立刻显示已保存（与项目设置一致）
    // capabilityFieldsToDefault：切换模型时自动将第一个 option 写入 capabilityDefaults（只填未配置字段）
    const updateDefaultModel = useCallback((
        field: string,
        modelKey: string,
        capabilityFieldsToDefault?: Array<{ field: string; options: CapabilityValue[] }>,
    ) => {
        setDefaultModels(prev => {
            const next = { ...prev, [field]: modelKey }
            latestDefaultModelsRef.current = next

            if (capabilityFieldsToDefault && capabilityFieldsToDefault.length > 0) {
                setCapabilityDefaults(prevCap => {
                    const nextCap: CapabilitySelections = { ...prevCap }
                    const existing = { ...(nextCap[modelKey] || {}) }
                    let changed = false
                    for (const def of capabilityFieldsToDefault) {
                        if (existing[def.field] === undefined && def.options.length > 0) {
                            existing[def.field] = def.options[0]
                            changed = true
                        }
                    }
                    if (changed) {
                        nextCap[modelKey] = existing
                        latestCapabilityDefaultsRef.current = nextCap
                        void performSave({ defaultModels: next, capabilityDefaults: nextCap }, true)
                        return nextCap
                    }
                    void performSave({ defaultModels: next }, true) // optimistic=true
                    return prevCap
                })
            } else {
                void performSave({ defaultModels: next }, true) // optimistic=true
            }
            return next
        })
    }, [performSave])

    const updateCapabilityDefault = useCallback((modelKey: string, field: string, value: string | number | boolean | null) => {
        setCapabilityDefaults((previous) => {
            const next: CapabilitySelections = { ...previous }
            const current = { ...(next[modelKey] || {}) }
            if (value === null) {
                delete current[field]
            } else {
                current[field] = value
            }

            if (Object.keys(current).length === 0) {
                delete next[modelKey]
            } else {
                next[modelKey] = current
            }
            latestCapabilityDefaultsRef.current = next
            void performSave({ capabilityDefaults: next }, true) // optimistic=true
            return next
        })
    }, [performSave])

    const providerOps = useProviderOperations({
        t,
        performSave,
        latestProvidersRef,
        latestModelsRef,
        latestDefaultModelsRef,
        setProviders,
        setModels,
        setDefaultModels,
        fetchConfig,
    })

    const modelOps = useModelOperations({
        t,
        performSave,
        latestModelsRef,
        latestDefaultModelsRef,
        setModels,
        setDefaultModels,
        models,
    })

    return {
        providers,
        models,
        defaultModels,
        capabilityDefaults,
        loading,
        saveStatus,
        ...providerOps,
        ...modelOps,
        updateDefaultModel,
        updateCapabilityDefault,
    }
}

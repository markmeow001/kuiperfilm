import { getProviderKey, type CustomModel, type PricingDisplayItem, type PricingDisplayMap } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function composePricingDisplayKey(type: CustomModel['type'], provider: string, modelId: string): string {
    return `${type}::${provider}::${modelId}`
}

export function parsePricingDisplayMap(raw: unknown): PricingDisplayMap {
    if (!isRecord(raw)) return {}

    const map: PricingDisplayMap = {}
    for (const [key, value] of Object.entries(raw)) {
        if (!isRecord(value)) continue
        const min = typeof value.min === 'number' && Number.isFinite(value.min) ? value.min : null
        const max = typeof value.max === 'number' && Number.isFinite(value.max) ? value.max : null
        const label = typeof value.label === 'string' ? value.label.trim() : ''
        const input = typeof value.input === 'number' && Number.isFinite(value.input) ? value.input : undefined
        const output = typeof value.output === 'number' && Number.isFinite(value.output) ? value.output : undefined
        if (min === null || max === null || !label) continue
        map[key] = {
            min,
            max,
            label,
            ...(typeof input === 'number' ? { input } : {}),
            ...(typeof output === 'number' ? { output } : {}),
        }
    }
    return map
}

/**
 * Provider keys that share pricing display with a canonical provider.
 */
export const PRICING_DISPLAY_ALIASES: Readonly<Record<string, string>> = {
    'gemini-compatible': 'google',
}

export function resolvePricingDisplay(
    map: PricingDisplayMap,
    type: CustomModel['type'],
    provider: string,
    modelId: string,
): PricingDisplayItem | null {
    const exact = map[composePricingDisplayKey(type, provider, modelId)]
    if (exact) return exact

    const providerKey = getProviderKey(provider)
    if (providerKey !== provider) {
        const fallback = map[composePricingDisplayKey(type, providerKey, modelId)]
        if (fallback) return fallback
    }

    // Fallback: check canonical provider alias (e.g. gemini-compatible → google)
    const aliasTarget = PRICING_DISPLAY_ALIASES[providerKey]
    if (aliasTarget) {
        const aliasFallback = map[composePricingDisplayKey(type, aliasTarget, modelId)]
        if (aliasFallback) return aliasFallback
    }
    return null
}

export function applyPricingDisplay(model: CustomModel, map: PricingDisplayMap): CustomModel {
    const pricing = resolvePricingDisplay(map, model.type, model.provider, model.modelId)
    if (!pricing) {
        // Preserve existing server-provided pricing fields (e.g. from customPricing)
        if (model.priceLabel && model.priceLabel !== '--') {
            return model
        }
        return {
            ...model,
            price: 0,
            priceLabel: '--',
            priceMin: undefined,
            priceMax: undefined,
            priceInput: undefined,
            priceOutput: undefined,
        }
    }

    return {
        ...model,
        price: pricing.min,
        priceMin: pricing.min,
        priceMax: pricing.max,
        priceLabel: pricing.label,
        ...(typeof pricing.input === 'number' ? { priceInput: pricing.input } : {}),
        ...(typeof pricing.output === 'number' ? { priceOutput: pricing.output } : {}),
    }
}

import type { ModelFormState, ProviderCardModelType } from '../types'

type AddModelCustomPricing = {
  llm?: { inputPerMillion?: number; outputPerMillion?: number }
  image?: { basePrice?: number; optionPrices?: Record<string, Record<string, number>> }
  video?: { basePrice?: number; optionPrices?: Record<string, Record<string, number>> }
}

export type BuildCustomPricingResult =
  | { ok: true; customPricing?: AddModelCustomPricing }
  | { ok: false; reason: 'invalid' }

export function buildCustomPricingFromModelForm(
  modelType: ProviderCardModelType,
  form: ModelFormState,
  options: { needsCustomPricing: boolean },
): BuildCustomPricingResult {
  if (!options.needsCustomPricing || form.enableCustomPricing !== true) {
    return { ok: true }
  }

  if (modelType === 'llm') {
    const inputVal = parseFloat(form.priceInput || '')
    const outputVal = parseFloat(form.priceOutput || '')
    if (!Number.isFinite(inputVal) || inputVal < 0 || !Number.isFinite(outputVal) || outputVal < 0) {
      return { ok: false, reason: 'invalid' }
    }
    return {
      ok: true,
      customPricing: {
        llm: {
          inputPerMillion: inputVal,
          outputPerMillion: outputVal,
        },
      },
    }
  }

  if (modelType === 'image' || modelType === 'video') {
    const basePriceRaw = parseFloat(form.basePrice || '')
    const hasBasePrice = Number.isFinite(basePriceRaw) && basePriceRaw >= 0
    if (form.basePrice && !hasBasePrice) {
      return { ok: false, reason: 'invalid' }
    }

    let optionPrices: Record<string, Record<string, number>> | undefined
    if (form.optionPricesJson && form.optionPricesJson.trim().length > 0) {
      try {
        const parsed = JSON.parse(form.optionPricesJson) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('invalid option prices object')
        }
        optionPrices = {}
        for (const [field, rawOptionMap] of Object.entries(parsed as Record<string, unknown>)) {
          if (!rawOptionMap || typeof rawOptionMap !== 'object' || Array.isArray(rawOptionMap)) continue
          const normalizedOptions: Record<string, number> = {}
          for (const [optionKey, rawAmount] of Object.entries(rawOptionMap as Record<string, unknown>)) {
            if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount) || rawAmount < 0) {
              throw new Error('invalid option price amount')
            }
            normalizedOptions[optionKey] = rawAmount
          }
          if (Object.keys(normalizedOptions).length > 0) {
            optionPrices[field] = normalizedOptions
          }
        }
        if (Object.keys(optionPrices).length === 0) {
          optionPrices = undefined
        }
      } catch {
        return { ok: false, reason: 'invalid' }
      }
    }

    if (!hasBasePrice && !optionPrices) {
      return { ok: false, reason: 'invalid' }
    }

    return {
      ok: true,
      customPricing: modelType === 'image'
        ? {
          image: {
            ...(hasBasePrice ? { basePrice: basePriceRaw } : {}),
            ...(optionPrices ? { optionPrices } : {}),
          },
        }
        : {
          video: {
            ...(hasBasePrice ? { basePrice: basePriceRaw } : {}),
            ...(optionPrices ? { optionPrices } : {}),
          },
        },
    }
  }

  return { ok: true }
}

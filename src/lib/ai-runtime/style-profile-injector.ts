/**
 * Style profile injector — pure function helper.
 *
 * 把 StyleProfile（global preset 锚点）注入到单次 image / video 生成的 payload。
 *
 * 注意：positivePrompt 一律走 prompt prepend（即 model 不需要原生支援 negative
 * 也能至少吃到风格 prompt）。negativePrompt / referenceImageUrls 才需要
 * model capability 支持，否则丢弃并 log warn。
 */

import { logWarn } from '@/lib/logging/core'
import type { StyleProfile } from '@/lib/style-profile/loader'

export interface ModelStyleCapabilities {
  supportNegativePrompt: boolean
  supportReferenceImage: boolean
}

export interface InjectionResult {
  prompt: string
  negativePrompt: string | null
  referenceImageUrls: string[]
}

const PROMPT_SEPARATOR = '\n\n'

export function injectStyleProfile(
  userPrompt: string,
  styleProfile: StyleProfile | null,
  caps: ModelStyleCapabilities,
): InjectionResult {
  if (styleProfile === null) {
    return {
      prompt: userPrompt,
      negativePrompt: null,
      referenceImageUrls: [],
    }
  }

  const positive = styleProfile.positivePrompt
  const hasPositive = typeof positive === 'string' && positive.length > 0
  const prompt = hasPositive ? `${positive}${PROMPT_SEPARATOR}${userPrompt}` : userPrompt

  let negativePrompt: string | null = null
  if (typeof styleProfile.negativePrompt === 'string' && styleProfile.negativePrompt.length > 0) {
    if (caps.supportNegativePrompt) {
      negativePrompt = styleProfile.negativePrompt
    } else {
      logWarn('[style-profile injector] negativePrompt dropped: model does not support it', {
        negativePromptLength: styleProfile.negativePrompt.length,
      })
    }
  }

  let referenceImageUrls: string[] = []
  if (Array.isArray(styleProfile.referenceImageUrls) && styleProfile.referenceImageUrls.length > 0) {
    if (caps.supportReferenceImage) {
      referenceImageUrls = [...styleProfile.referenceImageUrls]
    } else {
      logWarn('[style-profile injector] referenceImages dropped: model does not support it', {
        referenceCount: styleProfile.referenceImageUrls.length,
      })
    }
  }

  return {
    prompt,
    negativePrompt,
    referenceImageUrls,
  }
}

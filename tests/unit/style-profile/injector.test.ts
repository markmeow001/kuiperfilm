import { describe, expect, it } from 'vitest'

// 真实 import（implementer 进行中时若文件未存在会 import error，符合预期）
import {
  injectStyleProfile,
  type ModelStyleCapabilities,
  type InjectionResult,
} from '@/lib/ai-runtime/style-profile-injector'
import type { StyleProfile } from '@/lib/style-profile/loader'

const FULL_CAPS: ModelStyleCapabilities = {
  supportNegativePrompt: true,
  supportReferenceImage: true,
}

const NO_NEG_CAPS: ModelStyleCapabilities = {
  supportNegativePrompt: false,
  supportReferenceImage: true,
}

const NO_REF_CAPS: ModelStyleCapabilities = {
  supportNegativePrompt: true,
  supportReferenceImage: false,
}

const NO_CAPS: ModelStyleCapabilities = {
  supportNegativePrompt: false,
  supportReferenceImage: false,
}

const USER_PROMPT = 'A hero standing on a cliff at sunset.'

describe('style-profile injector behavior', () => {
  it('styleProfile === null -> pass-through prompt 不变 + negativePrompt null + referenceImageUrls 空陣列', () => {
    const result: InjectionResult = injectStyleProfile(USER_PROMPT, null, FULL_CAPS)
    expect(result).toEqual({
      prompt: USER_PROMPT,
      negativePrompt: null,
      referenceImageUrls: [],
    })
  })

  it('有 positivePrompt -> prompt === positivePrompt + "\\n\\n" + userPrompt（顺序与分隔符）', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: 'High contrast inked comic style.',
      negativePrompt: null,
      referenceImageUrls: [],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, FULL_CAPS)
    expect(result.prompt).toBe(`High contrast inked comic style.\n\n${USER_PROMPT}`)
    expect(result.negativePrompt).toBeNull()
    expect(result.referenceImageUrls).toEqual([])
  })

  it('没有 positivePrompt 但有 negativePrompt + 模型支援 -> prompt 不变, negativePrompt 透传', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: null,
      negativePrompt: 'no extra limbs',
      referenceImageUrls: [],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, FULL_CAPS)
    expect(result.prompt).toBe(USER_PROMPT)
    expect(result.negativePrompt).toBe('no extra limbs')
    expect(result.referenceImageUrls).toEqual([])
  })

  it('有 negativePrompt 但模型不支援 -> negativePrompt 静默被设为 null', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: null,
      negativePrompt: 'no extra limbs',
      referenceImageUrls: [],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, NO_NEG_CAPS)
    expect(result.negativePrompt).toBeNull()
    expect(result.prompt).toBe(USER_PROMPT)
  })

  it('有 referenceImages 但模型不支援 -> referenceImageUrls 为空陣列', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: null,
      negativePrompt: null,
      referenceImageUrls: ['https://ref/1.png', 'https://ref/2.png'],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, NO_REF_CAPS)
    expect(result.referenceImageUrls).toEqual([])
    expect(result.prompt).toBe(USER_PROMPT)
  })

  it('有 referenceImages 且模型支援 -> 透传完整阵列', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: null,
      negativePrompt: null,
      referenceImageUrls: ['https://ref/1.png', 'https://ref/2.png'],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, FULL_CAPS)
    expect(result.referenceImageUrls).toEqual(['https://ref/1.png', 'https://ref/2.png'])
  })

  it('全 styleProfile + 全支援 -> prompt prepend / negative 带 / reference 带', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: 'cinematic lighting',
      negativePrompt: 'low quality',
      referenceImageUrls: ['https://ref/a.png'],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, FULL_CAPS)
    expect(result).toEqual({
      prompt: `cinematic lighting\n\n${USER_PROMPT}`,
      negativePrompt: 'low quality',
      referenceImageUrls: ['https://ref/a.png'],
    })
  })

  it('全 styleProfile + 全不支援 -> 只剩 prompt prepend（positive 一律走主 prompt）', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: 'cinematic lighting',
      negativePrompt: 'low quality',
      referenceImageUrls: ['https://ref/a.png'],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, NO_CAPS)
    expect(result).toEqual({
      prompt: `cinematic lighting\n\n${USER_PROMPT}`,
      negativePrompt: null,
      referenceImageUrls: [],
    })
  })

  it('userPrompt 为空字符串 + positivePrompt 有值 -> prompt 仍按"positive\\n\\nempty"输出（不丢失分隔符）', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: 'X',
      negativePrompt: null,
      referenceImageUrls: [],
    }
    const result = injectStyleProfile('', styleProfile, FULL_CAPS)
    expect(result.prompt).toBe('X\n\n')
  })

  it('positivePrompt 为空字符串（"")应被视同没有 positive，不 prepend', () => {
    const styleProfile: StyleProfile = {
      positivePrompt: '',
      negativePrompt: null,
      referenceImageUrls: [],
    }
    const result = injectStyleProfile(USER_PROMPT, styleProfile, FULL_CAPS)
    expect(result.prompt).toBe(USER_PROMPT)
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildCastingPrompt,
  buildFaceLockPrompt,
  FACE_LOCK_VARIANTS,
} from '@/lib/visual-development/prompt'

describe('visual development casting prompt', () => {
  it('keeps World Bible context while excluding costume and scenery from Casting', () => {
    const result = buildCastingPrompt({
      candidateCode: 'C-01',
      worldBible: {
        projectPremise: 'A sealed underground city survives beneath a ruined world',
        visualThesis: 'Sacred order conceals biological exploitation',
      },
      characterDna: {
        role: 'Runaway witness',
        storyFunction: 'Forces the city to confront its origin',
        coreTraits: 'gentle, vigilant, quietly defiant',
      },
      castingBrief: {
        apparentAge: '24–28',
        ethnicity: 'Caucasian',
        faceStructure: 'long face with broad cheekbones',
        emotionalRead: 'restrained fear with determination',
        lifeHistory: 'sheltered upbringing followed by recent trauma',
      },
    })

    expect(result.prompt).toContain('fictional unknown adult performer')
    expect(result.prompt).toContain('Pure white seamless studio background')
    expect(result.prompt).toContain('No costume design')
    expect(result.promptStack.phaseTemplate).toBe('CADS_CASTING_FACE_V1')
    expect(result.negativePrompt).toContain('recognizable actor')
  })
})

describe('visual development Face Lock prompt', () => {
  it('uses Canon reference as the sole identity source and changes only the requested variable', () => {
    const variant = FACE_LOCK_VARIANTS.find((item) => item.code === 'VIEW-LPROFILE')
    expect(variant).toBeDefined()
    if (!variant) return

    const result = buildFaceLockPrompt({
      characterCode: 'CHR-SNO',
      identityAnchors: 'long face, wide-set gray eyes, subtly crooked nose',
      allowedVariation: 'camera view only',
      forbiddenDrift: 'age, ancestry, eye spacing, nose and jawline',
      variant,
    })

    expect(result.prompt).toContain('reference image 1 exclusively as the identity source')
    expect(result.prompt).toContain('complete left-profile')
    expect(result.prompt).toContain('Change only camera view')
    expect(result.prompt).toContain('Do not beautify')
    expect(result.promptStack.phaseTemplate).toBe('CADS_FACE_LOCK_V1')
    expect(result.promptStack.identityReference).toBe('REFERENCE_IMAGE_1_ONLY')
    expect(result.negativePrompt).toContain('identity drift')
  })

  it('defines ten controlled Face Bible assets without duplicate codes', () => {
    expect(FACE_LOCK_VARIANTS).toHaveLength(10)
    expect(new Set(FACE_LOCK_VARIANTS.map((item) => item.code)).size).toBe(10)
  })
})

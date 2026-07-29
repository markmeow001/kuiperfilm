import { describe, expect, it } from 'vitest'
import {
  buildCastingPrompt,
  buildFaceLockPrompt,
  buildHairExplorationPrompt,
  buildHairValidationPrompt,
  FACE_LOCK_VARIANTS,
  HAIR_EXPLORATION_VARIANTS,
  HAIR_VALIDATION_VARIANTS,
} from '@/lib/visual-development/prompt'

describe('visual development casting prompt', () => {
  it('Casting 含創傷故事背景 -> 只影響表演並強制純白背景與乾淨便服', () => {
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
        apparentAge: '18',
        performerAge: '21+',
        ethnicity: 'Caucasian',
        faceStructure: 'long face with broad cheekbones',
        emotionalRead: 'restrained fear with determination',
        lifeHistory: 'sheltered upbringing followed by recent trauma',
        directorPrompt: 'an unconventional independent-film face with smaller eyes',
      },
    })

    expect(result.prompt).toContain('fictional unknown adult performer')
    expect(result.prompt).toContain('Screen role age: 18')
    expect(result.prompt).toContain('Adult performer age: 21+')
    expect(result.prompt).toContain('Pure white seamless studio background')
    expect(result.prompt).toContain('evenly lit pure white (#FFFFFF)')
    expect(result.prompt).toContain('may influence only the performer\'s subtle facial performance')
    expect(result.prompt).toContain('No costume design')
    expect(result.prompt).toContain('entire head, complete crown, full hair silhouette')
    expect(result.prompt).toContain('both shoulders and upper chest')
    expect(result.prompt).toContain('an unconventional independent-film face with smaller eyes')
    expect(result.promptStack.castingDirection).toContain('unconventional independent-film face')
    expect(result.promptStack.phaseTemplate).toBe('CADS_CASTING_FACE_V2')
    expect(result.negativePrompt).toContain('recognizable actor')
    expect(result.negativePrompt).toContain('gray background')
    expect(result.negativePrompt).toContain('blood')
    expect(result.negativePrompt).toContain('cropped head')
  })
})

describe('visual development Hair Design prompts', () => {
  const hairRecord = {
    characterCode: 'CHR-SNO',
    hairSilhouette: 'readable around the face and compatible with a high collar',
    partingAndHairline: 'preserve the natural hairline',
    lengthAndTexture: 'believable weight and strand grouping',
    storyRequirements: 'formal and escape states share the same core cut',
    forbiddenDrift: 'face, age, ancestry, wardrobe and background',
  }

  it('defines ten unique exploration directions and changes hair only', () => {
    expect(HAIR_EXPLORATION_VARIANTS).toHaveLength(10)
    expect(new Set(HAIR_EXPLORATION_VARIANTS.map((item) => item.code)).size).toBe(10)
    const result = buildHairExplorationPrompt({ ...hairRecord, variant: HAIR_EXPLORATION_VARIANTS[0] })
    expect(result.prompt).toContain('Reference image 1 defines the exact identity')
    expect(result.prompt).toContain('Change only hairstyle construction')
    expect(result.prompt).toContain('compatible with costume collars')
    expect(result.promptStack.phaseTemplate).toBe('CADS_HAIR_EXPLORATION_V1')
  })

  it('assigns identity and hair to separate references across eight validation assets', () => {
    expect(HAIR_VALIDATION_VARIANTS).toHaveLength(8)
    expect(new Set(HAIR_VALIDATION_VARIANTS.map((item) => item.code)).size).toBe(8)
    const result = buildHairValidationPrompt({ ...hairRecord, variant: HAIR_VALIDATION_VARIANTS[2] })
    expect(result.prompt).toContain('Reference image 1 is the exclusive identity authority')
    expect(result.prompt).toContain('Reference image 2 is the exclusive hairstyle-construction authority')
    expect(result.prompt).toContain('direct back view')
    expect(result.promptStack.phaseTemplate).toBe('CADS_HAIR_VALIDATION_V1')
    expect(result.promptStack.hairReference).toBe('REFERENCE_IMAGE_2_HAIR_ONLY')
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

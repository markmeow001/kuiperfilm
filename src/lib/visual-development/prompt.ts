export type StringRecord = Record<string, string>

export interface CastingPromptInput {
  worldBible: StringRecord
  characterDna: StringRecord
  castingBrief: StringRecord
  candidateCode: string
}

export type FaceLockVariantCode =
  | 'VIEW-L3Q'
  | 'VIEW-R3Q'
  | 'VIEW-LPROFILE'
  | 'VIEW-RPROFILE'
  | 'VIEW-LOW'
  | 'EXPR-RESTRAINED'
  | 'EXPR-FEAR'
  | 'EXPR-GRIEF'
  | 'EXPR-DETERMINED'
  | 'DETAIL-SKIN'

export interface FaceLockVariant {
  code: FaceLockVariantCode
  label: string
  instruction: string
  changeOnly: string
}

export const FACE_LOCK_VARIANTS: readonly FaceLockVariant[] = [
  { code: 'VIEW-L3Q', label: 'Left 3/4', instruction: 'a left three-quarter casting portrait', changeOnly: 'camera view' },
  { code: 'VIEW-R3Q', label: 'Right 3/4', instruction: 'a right three-quarter casting portrait', changeOnly: 'camera view' },
  { code: 'VIEW-LPROFILE', label: 'Left profile', instruction: 'a complete left-profile casting portrait', changeOnly: 'camera view' },
  { code: 'VIEW-RPROFILE', label: 'Right profile', instruction: 'a complete right-profile casting portrait', changeOnly: 'camera view' },
  { code: 'VIEW-LOW', label: 'Low angle', instruction: 'a subtle low-angle head-and-shoulders casting portrait', changeOnly: 'camera elevation' },
  { code: 'EXPR-RESTRAINED', label: 'Restrained', instruction: 'a front-facing portrait with emotionally restrained tension', changeOnly: 'micro-expression' },
  { code: 'EXPR-FEAR', label: 'Fear', instruction: 'a front-facing portrait showing controlled fear without theatrical exaggeration', changeOnly: 'micro-expression' },
  { code: 'EXPR-GRIEF', label: 'Grief', instruction: 'a front-facing portrait showing grief held beneath composure, without tears', changeOnly: 'micro-expression' },
  { code: 'EXPR-DETERMINED', label: 'Determined', instruction: 'a front-facing portrait showing quiet determination under pressure', changeOnly: 'micro-expression' },
  { code: 'DETAIL-SKIN', label: 'Skin detail', instruction: 'an extreme facial skin-detail reference crop including one eye, cheek, nose and lips', changeOnly: 'crop and magnification' },
] as const

export interface FaceLockPromptInput {
  characterCode: string
  identityAnchors: string
  allowedVariation: string
  forbiddenDrift: string
  variant: FaceLockVariant
}

export type HairExplorationVariantCode =
  | 'HAIR-LONG-CENTER'
  | 'HAIR-LONG-SIDE'
  | 'HAIR-SHOULDER'
  | 'HAIR-BOB'
  | 'HAIR-CROPPED'
  | 'HAIR-SLICKED'
  | 'HAIR-LOW-TIED'
  | 'HAIR-HALF-TIED'
  | 'HAIR-BRAIDED'
  | 'HAIR-ASYMMETRIC'

export interface HairExplorationVariant {
  code: HairExplorationVariantCode
  instruction: string
}

export const HAIR_EXPLORATION_VARIANTS: readonly HairExplorationVariant[] = [
  { code: 'HAIR-LONG-CENTER', instruction: 'a long, center-parted silhouette with controlled face-framing lengths' },
  { code: 'HAIR-LONG-SIDE', instruction: 'a long, soft side-parted silhouette with one side kept clear of the face' },
  { code: 'HAIR-SHOULDER', instruction: 'a shoulder-length silhouette with practical movement and a readable neckline' },
  { code: 'HAIR-BOB', instruction: 'a structured bob silhouette with a distinct nape and clean profile' },
  { code: 'HAIR-CROPPED', instruction: 'a cropped silhouette with a believable natural hairline and exposed ears' },
  { code: 'HAIR-SLICKED', instruction: 'a controlled swept-back silhouette that exposes the full face and hairline' },
  { code: 'HAIR-LOW-TIED', instruction: 'a low-tied silhouette with a practical nape construction and restrained flyaways' },
  { code: 'HAIR-HALF-TIED', instruction: 'a half-tied silhouette balancing an open face with loose back length' },
  { code: 'HAIR-BRAIDED', instruction: 'a restrained braided construction with a readable crown, nape and side profile' },
  { code: 'HAIR-ASYMMETRIC', instruction: 'an asymmetric silhouette with one open side and one weighted side, still physically plausible' },
] as const

export type HairValidationVariantCode =
  | 'HAIR-VIEW-FRONT'
  | 'HAIR-VIEW-PROFILE'
  | 'HAIR-VIEW-BACK'
  | 'HAIR-SIL-BACKLIGHT'
  | 'HAIR-MOVE-WALK'
  | 'HAIR-MOVE-WIND'
  | 'HAIR-STATE-FORMAL'
  | 'HAIR-STATE-DISTRESSED'

export interface HairValidationVariant {
  code: HairValidationVariantCode
  instruction: string
  changeOnly: string
}

export const HAIR_VALIDATION_VARIANTS: readonly HairValidationVariant[] = [
  { code: 'HAIR-VIEW-FRONT', instruction: 'a front-facing head-and-shoulders hair construction reference', changeOnly: 'camera view' },
  { code: 'HAIR-VIEW-PROFILE', instruction: 'a complete left-profile hair construction reference', changeOnly: 'camera view' },
  { code: 'HAIR-VIEW-BACK', instruction: 'a direct back view clearly showing crown, lengths, tie points and nape construction', changeOnly: 'camera view' },
  { code: 'HAIR-SIL-BACKLIGHT', instruction: 'a backlit three-quarter silhouette test with the hair contour fully readable', changeOnly: 'lighting direction' },
  { code: 'HAIR-MOVE-WALK', instruction: 'a restrained walking-motion test showing believable secondary hair movement', changeOnly: 'subtle body movement' },
  { code: 'HAIR-MOVE-WIND', instruction: 'a controlled wind-response test showing strand grouping, weight and recovery', changeOnly: 'air movement' },
  { code: 'HAIR-STATE-FORMAL', instruction: 'the same hairstyle in its carefully maintained formal story state', changeOnly: 'grooming state' },
  { code: 'HAIR-STATE-DISTRESSED', instruction: 'the same hairstyle after prolonged escape or conflict, with physically plausible loosened strands', changeOnly: 'story wear state' },
] as const

export interface HairPromptInput {
  characterCode: string
  hairSilhouette: string
  partingAndHairline: string
  lengthAndTexture: string
  storyRequirements: string
  forbiddenDrift: string
}

function clean(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function line(label: string, value: string | undefined): string | null {
  const normalized = clean(value)
  return normalized ? `${label}: ${normalized}.` : null
}

/**
 * CADS Phase 1 prompt. World Bible informs story/emotional truth only;
 * costume, props and production design are deliberately excluded until later phases.
 */
export function buildCastingPrompt(input: CastingPromptInput): {
  prompt: string
  negativePrompt: string
  promptStack: StringRecord
} {
  const storyContext = [
    line('Story premise', input.worldBible.projectPremise),
    line('Emotional world', input.worldBible.visualThesis),
    line('Character role', input.characterDna.role),
    line('Story function', input.characterDna.storyFunction),
  ].filter((value): value is string => Boolean(value)).join(' ')

  const identity = [
    line('Apparent age', input.castingBrief.apparentAge || input.characterDna.age),
    line('Ethnicity', input.castingBrief.ethnicity || input.characterDna.ethnicity),
    line('Gender presentation', input.characterDna.genderPresentation),
    line('Face structure', input.castingBrief.faceStructure),
    line('Eyes', input.castingBrief.eyes),
    line('Hair', input.castingBrief.hair),
    line('Physical notes', input.characterDna.physicalNotes),
  ].filter((value): value is string => Boolean(value)).join(' ')

  const performance = [
    line('Core traits', input.characterDna.coreTraits),
    line('Emotional read', input.castingBrief.emotionalRead),
    line('Life history visible in the face', input.castingBrief.lifeHistory),
  ].filter((value): value is string => Boolean(value)).join(' ')

  const exclusions = clean(input.castingBrief.exclusions)

  const phaseTemplate = [
    `Feature-film casting portrait, candidate ${input.candidateCode}, of a fictional unknown adult performer, clearly 21 years old or older.`,
    identity,
    performance,
    storyContext,
    'Front-facing head-and-shoulders casting photograph, direct eye contact, neutral restrained expression, plain neutral crew-neck top.',
    'Pure white seamless studio background. No costume design, no props, no jewelry, no hair ornaments, no fantasy effects, no world scenery.',
    'Natural facial asymmetry, visible skin pores, peach fuzz, subtle under-eye texture, tiny believable blemishes, realistic eyelashes and individual hair strands.',
    'Large softbox slightly above camera, soft fill, subtle rim light, neutral exposure, high-end feature-film casting photography, documentary authenticity, unretouched real human skin.',
    exclusions ? `Casting exclusions: ${exclusions}.` : '',
  ].filter(Boolean).join('\n\n')

  const negativePrompt = [
    'minor, child, teenager, celebrity, recognizable actor, real public figure',
    'anime, illustration, digital painting, CGI, 3D render, doll face, plastic skin',
    'beauty filter, glamour retouching, fashion pose, heavy makeup, false eyelashes',
    'gothic costume, fantasy costume, jewelry, feathers, symbols, props, scenery',
    'smiling, seductive expression, perfect facial symmetry, text, watermark',
  ].join(', ')

  return {
    prompt: phaseTemplate,
    negativePrompt,
    promptStack: {
      worldBible: storyContext || 'No story context supplied',
      characterDna: `${identity} ${performance}`.trim(),
      phaseTemplate: 'CADS_CASTING_FACE_V1',
      modelAdapter: 'PHOTOREAL_CASTING_NEUTRAL_V1',
    },
  }
}

/** CADS Phase 2 prompt. Reference image 1 is the sole identity authority. */
export function buildFaceLockPrompt(input: FaceLockPromptInput): {
  prompt: string
  negativePrompt: string
  promptStack: StringRecord
} {
  const identityAnchors = clean(input.identityAnchors)
  const allowedVariation = clean(input.allowedVariation)
  const forbiddenDrift = clean(input.forbiddenDrift)
  const prompt = [
    `FACE BIBLE ASSET ${input.characterCode}-${input.variant.code}.`,
    'Use reference image 1 exclusively as the identity source for this fictional adult performer.',
    'Preserve the exact same identity: apparent age, ancestry, facial proportions, eye spacing and shape, eyelids, nose bridge and tip, lip shape, jawline, chin, ears, hairline, skin tone, natural asymmetry and distinctive marks.',
    identityAnchors ? `Identity anchors that must remain observable: ${identityAnchors}.` : '',
    `Create ${input.variant.instruction} of the same person.`,
    'Keep the same plain neutral crew-neck wardrobe, pure white seamless background, neutral studio exposure, moderate portrait-lens perspective and unretouched skin treatment.',
    `Change only ${input.variant.changeOnly}.`,
    allowedVariation ? `Allowed variation: ${allowedVariation}.` : '',
    forbiddenDrift ? `Forbidden drift: ${forbiddenDrift}.` : '',
    'Do not beautify, redesign, age, de-age, change ancestry, alter face width, enlarge the eyes, narrow the nose, change lip volume, modify the hairline or add styling.',
    'Feature-film identity reference photography, believable anatomy, natural pores, peach fuzz, individual hair strands, no text or watermark.',
  ].filter(Boolean).join('\n\n')

  const negativePrompt = [
    'different person, identity drift, face redesign, age change, ancestry change',
    'beauty retouching, plastic skin, doll face, enlarged eyes, narrowed nose, changed lips',
    'new hairstyle, makeup, jewelry, costume, props, scenery, fantasy effects',
    'anime, illustration, digital painting, CGI, 3D render, text, watermark',
  ].join(', ')

  return {
    prompt,
    negativePrompt,
    promptStack: {
      identityReference: 'REFERENCE_IMAGE_1_ONLY',
      identityAnchors: identityAnchors || 'Use all observable identity anchors from Canon reference',
      phaseTemplate: 'CADS_FACE_LOCK_V1',
      modelAdapter: 'IDENTITY_REFERENCE_EDIT_V1',
      changeOnly: input.variant.changeOnly,
    },
  }
}

/** CADS Phase 3 exploration. Reference image 1 remains the sole identity authority. */
export function buildHairExplorationPrompt(
  input: HairPromptInput & { variant: HairExplorationVariant },
): { prompt: string; negativePrompt: string; promptStack: StringRecord } {
  const prompt = [
    `HAIR EXPLORATION ${input.characterCode}-${input.variant.code}.`,
    'Reference image 1 defines the exact identity of this fictional adult performer. Preserve the face, age, ancestry, skin, body, expression, plain wardrobe, white background, camera perspective and neutral studio light.',
    `Explore only the hair as ${input.variant.instruction}.`,
    clean(input.hairSilhouette) ? `Required silhouette logic: ${clean(input.hairSilhouette)}.` : '',
    clean(input.partingAndHairline) ? `Parting and hairline rules: ${clean(input.partingAndHairline)}.` : '',
    clean(input.lengthAndTexture) ? `Length and texture rules: ${clean(input.lengthAndTexture)}.` : '',
    clean(input.storyRequirements) ? `Character and story requirements: ${clean(input.storyRequirements)}.` : '',
    clean(input.forbiddenDrift) ? `Forbidden drift: ${clean(input.forbiddenDrift)}.` : '',
    'Keep the design filmable, physically plausible, readable in front, profile and back silhouette, compatible with costume collars, and clear of the eyes and mouth for performance.',
    'Change only hairstyle construction. Do not redesign or beautify the face and do not add costume, jewelry, headwear, props, scenery or visual effects.',
  ].filter(Boolean).join('\n\n')

  const negativePrompt = [
    'different person, identity drift, face redesign, age change, ancestry change',
    'changed facial proportions, changed hairline anatomy, beauty retouching, plastic skin',
    'wig-like hair, impossible strand structure, floating hair, blocked eyes, blocked mouth',
    'costume, jewelry, headwear, props, scenery, fantasy effects, text, watermark',
  ].join(', ')

  return {
    prompt,
    negativePrompt,
    promptStack: {
      identityReference: 'REFERENCE_IMAGE_1_IDENTITY_ONLY',
      phaseTemplate: 'CADS_HAIR_EXPLORATION_V1',
      modelAdapter: 'IDENTITY_REFERENCE_HAIR_EDIT_V1',
      changeOnly: 'hairstyle construction',
    },
  }
}

/** CADS Phase 3 validation. Reference 1 owns identity; reference 2 owns hair. */
export function buildHairValidationPrompt(
  input: HairPromptInput & { variant: HairValidationVariant },
): { prompt: string; negativePrompt: string; promptStack: StringRecord } {
  const prompt = [
    `HAIR VALIDATION ${input.characterCode}-${input.variant.code}.`,
    'Reference image 1 is the exclusive identity authority. Preserve its exact face, apparent age, ancestry, facial proportions, skin tone, natural asymmetry and distinctive marks.',
    'Reference image 2 is the exclusive hairstyle-construction authority. Preserve its silhouette, parting, hairline treatment, length, texture, volume, tie points and strand grouping.',
    `Create ${input.variant.instruction} of the same performer wearing the same selected hairstyle.`,
    `Change only ${input.variant.changeOnly}.`,
    clean(input.storyRequirements) ? `Story continuity requirement: ${clean(input.storyRequirements)}.` : '',
    clean(input.forbiddenDrift) ? `Forbidden drift: ${clean(input.forbiddenDrift)}.` : '',
    'Keep the same plain neutral wardrobe and clean studio environment unless the requested validation changes lighting. Hair must remain filmable, physically plausible, performance-safe and compatible with a costume collar.',
    'Do not merge identities, copy facial features from reference image 2, invent a new haircut, add costume, jewelry, headwear, props, scenery or fantasy effects.',
  ].filter(Boolean).join('\n\n')

  const negativePrompt = [
    'different person, merged identity, identity drift, face from reference image 2',
    'different hairstyle, changed silhouette, changed parting, changed length, changed texture',
    'beauty retouching, plastic skin, wig-like hair, impossible movement, blocked performance',
    'costume, jewelry, headwear, props, scenery, fantasy effects, text, watermark',
  ].join(', ')

  return {
    prompt,
    negativePrompt,
    promptStack: {
      identityReference: 'REFERENCE_IMAGE_1_IDENTITY_ONLY',
      hairReference: 'REFERENCE_IMAGE_2_HAIR_ONLY',
      phaseTemplate: 'CADS_HAIR_VALIDATION_V1',
      modelAdapter: 'DUAL_REFERENCE_IDENTITY_HAIR_EDIT_V1',
      changeOnly: input.variant.changeOnly,
    },
  }
}

import type { ProductionStageDefinition, ProductionStageVariant } from './production-stages'

type StringRecord = Record<string, string>

export interface ProductionPromptInput {
  stage: ProductionStageDefinition
  variant: ProductionStageVariant
  characterCode: string
  worldBible: StringRecord
  characterDna: StringRecord
  stageRecord: StringRecord
}

function summarize(record: StringRecord, keys: readonly string[]): string {
  return keys.map((key) => record[key]?.trim()).filter(Boolean).join(' | ')
}

export function buildProductionStagePrompt(input: ProductionPromptInput) {
  const world = summarize(input.worldBible, [
    'projectPremise', 'visualThesis', 'technologyRules', 'colorScript',
    'materialRules', 'architectureLanguage', 'cameraFormat', 'forbiddenElements',
  ])
  const identity = summarize(input.characterDna, [
    'role', 'coreTraits', 'identityAnchors', 'hairSilhouette',
    'partingAndHairline', 'lengthAndTexture', 'storyRequirements',
  ])
  const design = input.stage.fields
    .map((field) => input.stageRecord[field]?.trim())
    .filter(Boolean)
    .join(' | ')
  const referenceRule = input.stage.mediaType === 'video'
    ? 'Reference image 1 is the approved scene-integrated character plate and is the sole visual authority for identity, costume, hair, props, environment and lighting.'
    : 'Reference image 1 is the locked Face ID and controls identity only. Reference image 2 is the approved upstream design asset and controls hair, costume, props, silhouette and story state. Resolve conflicts by preserving identity from image 1 and design from image 2.'
  const formatRule = input.stage.mediaType === 'video'
    ? 'Create one short feature-film motion reference. Keep the same performer, apparent age, face geometry, hairstyle, costume, props, scene geography and lighting from first frame to last frame. Natural human biomechanics, stable hands, stable facial features, physically plausible cloth and hair motion, no camera teleportation.'
    : 'Feature-film character development photography, physically plausible anatomy and construction, production-ready material detail, coherent scale and light. Do not present a collage, contact sheet, labels, text or watermark.'

  const prompt = [
    `CADS PHASE ${String(input.stage.phase).padStart(2, '0')} · ${input.stage.id.toUpperCase()} · ${input.characterCode} · ${input.variant.code}.`,
    referenceRule,
    `Create ${input.variant.instruction}.`,
    world ? `Locked World Canon: ${world}.` : '',
    identity ? `Locked Character Canon: ${identity}.` : '',
    design ? `Approved stage design record: ${design}.` : '',
    formatRule,
    'Preserve all upstream Canon decisions. Change only what this output instruction explicitly requires. No redesign, no identity drift, no unexplained material, prop, costume, hair, scale or story-state changes.',
  ].filter(Boolean).join('\n\n')

  const negativePrompt = [
    'different person, identity drift, age change, ancestry change, face redesign',
    'changed hairstyle, changed costume, missing prop, invented accessory, continuity error',
    'plastic skin, doll face, broken anatomy, extra fingers, fused hands, floating objects',
    'anime, illustration, concept sketch, painterly rendering, CGI look, game UI',
    'collage, split screen, contact sheet, labels, text, logo, watermark',
  ].join(', ')

  return {
    prompt,
    negativePrompt,
    promptStack: {
      worldBible: world || 'LOCKED_WORLD_CANON',
      characterDna: identity || 'LOCKED_CHARACTER_CANON',
      stageTemplate: `CADS_PHASE_${String(input.stage.phase).padStart(2, '0')}_${input.stage.id.toUpperCase()}_V1`,
      modelAdapter: input.stage.mediaType === 'video' ? 'CANON_IMAGE_TO_VIDEO_V1' : 'DUAL_REFERENCE_CHARACTER_V1',
      referencePolicy: referenceRule,
      stageRecord: design,
    },
  }
}

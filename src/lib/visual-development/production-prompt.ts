import type { ProductionStageDefinition, ProductionStageVariant } from './production-stages'
import type { ProductionStageBrief } from './stage-brief'

type StringRecord = Record<string, string>

export interface ProductionPromptInput {
  stage: ProductionStageDefinition
  variant: ProductionStageVariant
  characterCode: string
  worldBible: StringRecord
  characterDna: StringRecord
  stageRecord: StringRecord
  stageBrief: ProductionStageBrief
  creativePrompt: string
  /** Inline exclusions when the provider has no separate negative-prompt field. */
  inlineNegativeConstraints?: boolean
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
  const evidence = input.stageBrief.evidence.join(' | ')
  const constraints = input.stageBrief.constraints.join(' | ')
  const creativeAdjustment = input.creativePrompt.trim()
  const referenceRule = input.stage.referenceSources
    .map((reference, index) => `Reference image ${index + 1} is ${reference.authority}.`)
    .join(' ')
  const continuityNegatives = [
    'changed locked hairstyle',
    ...(input.stage.phase >= 5 ? ['changed locked costume'] : []),
    ...(input.stage.phase >= 6 ? ['missing locked prop', 'invented accessory'] : []),
  ]

  const negativePrompt = [
    'different person, identity drift, age change, ancestry change, face redesign',
    ...continuityNegatives,
    'continuity error',
    'plastic skin, doll face, broken anatomy, extra fingers, fused hands, floating objects',
    'anime, illustration, concept sketch, painterly rendering, CGI look, game UI',
    'collage, split screen, contact sheet, labels, text, logo, watermark',
    ...input.stage.negativeTerms,
  ].join(', ')

  const prompt = [
    `CADS PHASE ${String(input.stage.phase).padStart(2, '0')} · ${input.stage.id.toUpperCase()} · ${input.characterCode} · ${input.variant.code}.`,
    referenceRule,
    `Create ${input.variant.instruction}.`,
    world ? `Locked World Canon: ${world}.` : '',
    identity ? `Locked Character Canon: ${identity}.` : '',
    `Immutable screenplay-derived stage baseline (v${input.stageBrief.version}, ${input.stageBrief.sourceAnalysisId}): ${input.stageBrief.summary}.`,
    design ? `Locked stage design fields: ${design}.` : '',
    evidence ? `Screenplay and Canon evidence: ${evidence}.` : '',
    constraints ? `Stage constraints: ${constraints}.` : '',
    creativeAdjustment
      ? `User creative adjustment: ${creativeAdjustment}. Apply it only where it does not contradict the immutable screenplay baseline, locked World Canon, Character Canon or upstream visual Canon.`
      : 'No user creative adjustment. Follow the immutable screenplay-derived baseline exactly.',
    input.stage.outputRule,
    'Preserve all upstream Canon decisions. Change only what this output instruction explicitly requires. No redesign, no identity drift, no unexplained material, prop, costume, hair, scale or story-state changes.',
    input.inlineNegativeConstraints
      ? `The selected model has no separate negative-prompt channel. Explicit exclusions: ${negativePrompt}. Do not render any excluded item.`
      : '',
  ].filter(Boolean).join('\n\n')

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
      stageBriefVersion: input.stageBrief.version,
      stageBriefSourceAnalysisId: input.stageBrief.sourceAnalysisId,
      creativePrompt: creativeAdjustment,
    },
  }
}

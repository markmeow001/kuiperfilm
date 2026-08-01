export type ProductionStageId =
  | 'costume'
  | 'accessory'
  | 'silhouette'
  | 'expression'
  | 'ability'
  | 'hero'
  | 'turnaround'
  | 'evolution'
  | 'integration'
  | 'video'

export type ProductionFieldId =
  | 'silhouetteSystem'
  | 'materialConstruction'
  | 'storyWear'
  | 'signatureProps'
  | 'carryLogic'
  | 'symbolism'
  | 'contourLanguage'
  | 'poseRead'
  | 'recognitionTest'
  | 'emotionalStates'
  | 'performanceRange'
  | 'forbiddenExpression'
  | 'visualMechanism'
  | 'activationCost'
  | 'escalationRules'
  | 'narrativeMoment'
  | 'composition'
  | 'lighting'
  | 'orthographicRules'
  | 'materialCallouts'
  | 'scaleNotes'
  | 'storyBeats'
  | 'changeLogic'
  | 'continuityRules'
  | 'sceneContext'
  | 'blocking'
  | 'environmentInteraction'
  | 'performanceActions'
  | 'motionRules'
  | 'continuityChecks'

export interface ProductionStageVariant {
  code: string
  instruction: string
}

export type ProductionReferenceSourceId = 'face' | 'hair' | ProductionStageId

export interface ProductionReferenceSource {
  source: ProductionReferenceSourceId
  candidateCode?: string
  authority: string
}

export interface ProductionStageDefinition {
  id: ProductionStageId
  phase: number
  dbStage: string
  prerequisiteStatus: string
  lockedStatus: string
  mediaType: 'image' | 'video'
  fields: readonly ProductionFieldId[]
  variants: readonly ProductionStageVariant[]
  referenceSources: readonly ProductionReferenceSource[]
  outputRule: string
  negativeTerms: readonly string[]
}

export const PRODUCTION_STAGE_DEFINITIONS: readonly ProductionStageDefinition[] = [
  {
    id: 'costume', phase: 4, dbStage: 'phase-04-costume', prerequisiteStatus: 'hair_locked', lockedStatus: 'costume_locked', mediaType: 'image',
    fields: ['silhouetteSystem', 'materialConstruction', 'storyWear'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked Face ID and identity only' },
      { source: 'hair', authority: 'the locked Hair ID, hair construction and grooming only' },
    ],
    outputRule: 'Render one uninterrupted photorealistic live-action costume reference on an evenly lit light-neutral seamless studio background. Follow the requested camera scale exactly: front, back and motion variants show the complete body from crown to soles; the detail variant is one tightly framed construction photograph. No scenery, layout, labels or typography.',
    negativeTerms: ['cropped body', 'missing footwear', 'environmental scene', 'fashion runway', 'costume concept sketch'],
    variants: [
      { code: 'COSTUME-FRONT', instruction: 'full-body front view on a neutral seamless background, clearly showing the complete costume hierarchy' },
      { code: 'COSTUME-BACK', instruction: 'full-body back view showing closures, layers, carry points and hem construction' },
      { code: 'COSTUME-DETAIL', instruction: 'production detail plate of neckline, fastenings, seams, materials and controlled wear' },
      { code: 'COSTUME-MOTION', instruction: 'restrained walking pose showing garment weight, articulation and believable secondary movement' },
    ],
  },
  {
    id: 'accessory', phase: 5, dbStage: 'phase-05-accessory', prerequisiteStatus: 'costume_locked', lockedStatus: 'accessory_locked', mediaType: 'image',
    fields: ['signatureProps', 'carryLogic', 'symbolism'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked Face ID and identity only' },
      { source: 'costume', candidateCode: 'COSTUME-FRONT', authority: 'the approved costume, Hair ID, body proportion and story-wear state' },
    ],
    outputRule: 'Render one photorealistic live-action prop or worn-accessory reference according to the requested variant. Preserve measurable scale, material construction, attachment points and ergonomics; no decorative page layout, labels or invented kit parts.',
    negativeTerms: ['unmotivated ornament', 'floating prop', 'wrong scale', 'impossible grip', 'product-design sketch'],
    variants: [
      { code: 'PROP-HERO', instruction: 'clean hero product plate of the signature accessory and prop system' },
      { code: 'PROP-WORN', instruction: 'full-body character reference showing every accessory in its exact worn or carried position' },
      { code: 'PROP-HAND', instruction: 'close interaction plate showing grip, scale, ergonomics and hand contact' },
      { code: 'PROP-KIT', instruction: 'organized kit layout showing modular parts, storage, fasteners and maintenance logic' },
    ],
  },
  {
    id: 'silhouette', phase: 6, dbStage: 'phase-06-silhouette', prerequisiteStatus: 'accessory_locked', lockedStatus: 'silhouette_locked', mediaType: 'image',
    fields: ['contourLanguage', 'poseRead', 'recognitionTest'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'body identity and proportion; facial detail must not drive the silhouette rendering' },
      { source: 'accessory', candidateCode: 'PROP-WORN', authority: 'the complete approved costume, hair, accessory placement and outer contour' },
    ],
    outputRule: 'Create one single-view silhouette test, not a design board. Preserve the exact approved body, costume, hair and prop contour. Where a solid silhouette is requested, suppress all surface detail and keep only the readable outer shape and negative space.',
    negativeTerms: ['surface texture in solid silhouette', 'redesigned costume', 'multiple poses in one image', 'character sheet layout'],
    variants: [
      { code: 'SIL-FRONT', instruction: 'full-body front silhouette test with the character rendered as a solid dark shape' },
      { code: 'SIL-PROFILE', instruction: 'full-body profile silhouette test preserving the exact costume and prop outline' },
      { code: 'SIL-BACKLIGHT', instruction: 'cinematic backlight silhouette with only contour, negative space and prop profile readable' },
      { code: 'SIL-SCALE', instruction: 'neutral scale-lineup plate showing the character silhouette beside a standard adult height marker' },
    ],
  },
  {
    id: 'expression', phase: 7, dbStage: 'phase-07-expression', prerequisiteStatus: 'silhouette_locked', lockedStatus: 'expression_locked', mediaType: 'image',
    fields: ['emotionalStates', 'performanceRange', 'forbiddenExpression'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked identity, face anatomy, skin and apparent age' },
      { source: 'accessory', candidateCode: 'PROP-WORN', authority: 'the approved hair, costume, accessories and story state; it must not replace facial identity' },
    ],
    outputRule: 'Render one photorealistic head-and-shoulders performance reference with the entire head, crown, chin, neck and shoulders visible against a clean neutral studio background. Change only the requested screenplay-driven micro-expression; no wounds, dirt or distress unless explicitly required by the immutable stage brief.',
    negativeTerms: ['generic sad stare', 'same expression', 'theatrical grimace', 'cropped crown', 'beauty campaign'],
    variants: [
      { code: 'EXPR-NEUTRAL', instruction: 'tight casting portrait with emotionally neutral listening behavior' },
      { code: 'EXPR-FEAR', instruction: 'tight portrait of controlled fear without theatrical exaggeration' },
      { code: 'EXPR-GRIEF', instruction: 'tight portrait of grief held beneath composure' },
      { code: 'EXPR-DETERMINED', instruction: 'tight portrait of quiet determination under pressure' },
      { code: 'EXPR-RAGE', instruction: 'tight portrait of restrained rage with believable facial tension' },
      { code: 'EXPR-CONTEMPT', instruction: 'tight portrait of subtle contempt carried asymmetrically around eyes and mouth' },
      { code: 'EXPR-TENDER', instruction: 'tight portrait of guarded tenderness with minimal expression' },
      { code: 'EXPR-EXHAUSTED', instruction: 'tight portrait of physical exhaustion while preserving identity and age' },
    ],
  },
  {
    id: 'ability', phase: 8, dbStage: 'phase-08-ability', prerequisiteStatus: 'expression_locked', lockedStatus: 'ability_locked', mediaType: 'image',
    fields: ['visualMechanism', 'activationCost', 'escalationRules'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked identity and face anatomy' },
      { source: 'accessory', candidateCode: 'PROP-WORN', authority: 'the approved full character design, hair, costume and signature props' },
    ],
    outputRule: 'Render one photorealistic live-action VFX development frame with a single camera viewpoint. Keep the character readable and show the ability origin, direction, physical interaction, cost and residue appropriate to the requested state; no diagram, UI or explanatory text.',
    negativeTerms: ['generic magic glow', 'effect hiding the face', 'effect hiding the body', 'VFX diagram', 'game ability UI'],
    variants: [
      { code: 'ABILITY-IDLE', instruction: 'full-body neutral reference showing the dormant ability signature before activation' },
      { code: 'ABILITY-ACTIVATE', instruction: 'controlled activation moment with a readable origin point and physical mechanism' },
      { code: 'ABILITY-IMPACT', instruction: 'peak impact frame showing scale, direction, interaction and limits without hiding the character' },
      { code: 'ABILITY-AFTERMATH', instruction: 'immediate aftermath showing cost, residue, damage and recovery state' },
    ],
  },
  {
    id: 'hero', phase: 9, dbStage: 'phase-09-hero', prerequisiteStatus: 'ability_locked', lockedStatus: 'hero_locked', mediaType: 'image',
    fields: ['narrativeMoment', 'composition', 'lighting'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked identity and face anatomy' },
      { source: 'ability', candidateCode: 'ABILITY-ACTIVATE', authority: 'the approved full character design and controlled ability language' },
    ],
    outputRule: 'Render one uninterrupted photorealistic live-action feature-film frame. This is a story moment, not key-art typography or a marketing poster. Use motivated location light, grounded contact, coherent lens perspective and a single readable dramatic hierarchy.',
    negativeTerms: ['movie poster', 'key art typography', 'floating montage', 'marketing composition', 'concept painting'],
    variants: [
      { code: 'HERO-WIDE', instruction: 'cinematic wide hero frame establishing the character within the world and central conflict' },
      { code: 'HERO-FULL', instruction: 'full-body theatrical story frame with a strong readable silhouette and grounded environment contact' },
      { code: 'HERO-MEDIUM', instruction: 'medium cinematic portrait emphasizing performance, costume hierarchy and signature prop' },
      { code: 'HERO-ABILITY', instruction: 'decisive hero frame integrating the canon ability at a controlled readable scale' },
    ],
  },
  {
    id: 'turnaround', phase: 10, dbStage: 'phase-10-turnaround', prerequisiteStatus: 'hero_locked', lockedStatus: 'turnaround_locked', mediaType: 'image',
    fields: ['orthographicRules', 'materialCallouts', 'scaleNotes'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked identity, face anatomy and body identity' },
      { source: 'accessory', candidateCode: 'PROP-WORN', authority: 'the clean approved hair, costume, footwear, accessories and prop placement' },
    ],
    outputRule: 'Render one single-view photorealistic full-body technical reference on an evenly lit light-neutral seamless background. Preserve neutral posture, consistent scale and lens perspective. Show the complete body from crown to soles; do not combine several views or add labels inside the image.',
    negativeTerms: ['multi-view contact sheet', 'cropped feet', 'cropped crown', 'perspective distortion', 'technical labels'],
    variants: [
      { code: 'TURN-FRONT', instruction: 'neutral full-body orthographic front view on a light neutral background' },
      { code: 'TURN-THREEQ', instruction: 'neutral full-body left three-quarter construction view' },
      { code: 'TURN-SIDE', instruction: 'neutral full-body left profile construction view' },
      { code: 'TURN-BACK', instruction: 'neutral full-body orthographic back view with all rear construction visible' },
    ],
  },
  {
    id: 'evolution', phase: 11, dbStage: 'phase-11-evolution', prerequisiteStatus: 'turnaround_locked', lockedStatus: 'evolution_locked', mediaType: 'image',
    fields: ['storyBeats', 'changeLogic', 'continuityRules'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked identity and anatomy across every story state' },
      { source: 'turnaround', candidateCode: 'TURN-FRONT', authority: 'the approved construction, proportions, hair, costume and prop baseline before story changes' },
    ],
    outputRule: 'Render one photorealistic full-body story-state plate on a clean neutral background. Show only the requested point in the character arc, with every addition, loss, repair, stain or damage motivated by the immutable screenplay brief; no before-and-after collage.',
    negativeTerms: ['before and after collage', 'unmotivated dirt', 'random blood', 'continuity jump', 'redesigned identity'],
    variants: [
      { code: 'EVO-INTRO', instruction: 'full-body story-state plate for the character introduction, intact and controlled' },
      { code: 'EVO-ESCAPE', instruction: 'full-body early escape state with the first motivated wear, loss and adaptation' },
      { code: 'EVO-MID', instruction: 'full-body midpoint state showing accumulated choices, repairs and faction influence' },
      { code: 'EVO-FINAL', instruction: 'full-body final-act state showing the completed arc while preserving recognizability' },
    ],
  },
  {
    id: 'integration', phase: 12, dbStage: 'phase-12-integration', prerequisiteStatus: 'evolution_locked', lockedStatus: 'integration_locked', mediaType: 'image',
    fields: ['sceneContext', 'blocking', 'environmentInteraction'],
    referenceSources: [
      { source: 'face', candidateCode: 'EXPR-RESTRAINED', authority: 'the locked identity and face anatomy under scene lighting' },
      { source: 'evolution', authority: 'the user-approved story-state design, hair, costume, props and wear continuity' },
    ],
    outputRule: 'Render one uninterrupted photorealistic live-action feature-film frame in the screenplay location. Prove scale, blocking, contact shadows, reflections, atmosphere and motivated light while preserving the chosen story-state design; no board, collage or environmental concept painting.',
    negativeTerms: ['concept-art rendering', 'floating character', 'missing contact shadow', 'inconsistent scene scale', 'collage'],
    variants: [
      { code: 'INT-WIDE', instruction: 'cinematic wide shot proving scale, atmosphere and environmental belonging' },
      { code: 'INT-MEDIUM', instruction: 'cinematic medium shot proving costume, skin and light response in the scene' },
      { code: 'INT-CLOSE', instruction: 'cinematic close-up proving face identity under the scene lighting and color pipeline' },
      { code: 'INT-ACTION', instruction: 'cinematic action frame proving contact shadows, motion, props and environment interaction' },
    ],
  },
  {
    id: 'video', phase: 13, dbStage: 'phase-13-video', prerequisiteStatus: 'integration_locked', lockedStatus: 'video_locked', mediaType: 'video',
    fields: ['performanceActions', 'motionRules', 'continuityChecks'],
    referenceSources: [
      { source: 'integration', authority: 'the approved scene-integrated identity, story-state design, environment, blocking and lighting' },
    ],
    outputRule: 'Create one short photorealistic live-action motion reference. Preserve the approved first-frame identity, anatomy, costume, props, scene geography and lighting. Use natural human biomechanics, stable hands and face, plausible cloth and hair physics, and continuous camera movement without teleportation.',
    negativeTerms: ['identity morph', 'camera teleportation', 'rubber limbs', 'flickering costume', 'unstable background'],
    variants: [
      { code: 'VID-WALK', instruction: 'a restrained walk toward camera with natural weight transfer and consistent costume physics' },
      { code: 'VID-DIALOGUE', instruction: 'a subtle listening and speaking performance with stable identity and restrained head movement' },
      { code: 'VID-EMOTION', instruction: 'a controlled emotional transition from guarded neutrality to quiet determination' },
      { code: 'VID-ACTION', instruction: 'a short action beat using the signature prop or ability while preserving anatomy and continuity' },
    ],
  },
] as const

export const PRODUCTION_STAGE_IDS = PRODUCTION_STAGE_DEFINITIONS.map((stage) => stage.id)
export const PRODUCTION_FIELD_IDS = Array.from(new Set(PRODUCTION_STAGE_DEFINITIONS.flatMap((stage) => stage.fields)))

export function getProductionStage(stageId: string): ProductionStageDefinition {
  const stage = PRODUCTION_STAGE_DEFINITIONS.find((item) => item.id === stageId)
  if (!stage) throw new Error(`Unknown production stage: ${stageId}`)
  return stage
}

export function canEnterProductionStage(characterStatus: string, stageId: ProductionStageId): boolean {
  const stage = getProductionStage(stageId)
  const currentIndex = PRODUCTION_STAGE_DEFINITIONS.findIndex((item) => item.lockedStatus === characterStatus)
  const prerequisiteIndex = PRODUCTION_STAGE_DEFINITIONS.findIndex((item) => item.lockedStatus === stage.prerequisiteStatus)
  if (stage.prerequisiteStatus === 'hair_locked') {
    return characterStatus === 'hair_locked' || currentIndex >= 0
  }
  return currentIndex >= prerequisiteIndex
}

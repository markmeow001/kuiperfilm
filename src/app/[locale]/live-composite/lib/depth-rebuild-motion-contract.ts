export type CameraDirection = 'source-matched' | 'backward' | 'forward' | 'static' | 'lateral'

export type FramingCrop =
  | 'source-matched'
  | 'close-up'
  | 'chest-up'
  | 'waist-up'
  | 'thigh-up'
  | 'full-body'

export type SubjectMotionDirection = 'source-matched' | 'forward' | 'backward' | 'static' | 'lateral'

export type SubjectCameraRelation =
  | 'source-matched'
  | 'toward-camera'
  | 'away-from-camera'
  | 'fixed-distance'
  | 'across-frame'

export type ScreenDirection = 'screen-left' | 'screen-right' | 'toward-camera' | 'away-from-camera'
export type HeadTurnScreenDirection = 'source-matched' | 'screen-left' | 'screen-right'

export type MotionSpeed = 'steady' | 'source-matched'

export interface MotionInterval {
  startSeconds: number
  endSeconds: number
}

export interface CameraMotionContract {
  direction: CameraDirection
  continuous: boolean
  noDirectionReversal: boolean
  speed: MotionSpeed
}

export interface FramingMotionContract {
  crop: FramingCrop
  locked: boolean
  subjectScale: 'constant' | 'source-matched'
}

export interface SubjectMotionContract {
  direction: SubjectMotionDirection
  relationToCamera: SubjectCameraRelation
  continuous: boolean
  speed: MotionSpeed
}

export type CharacterGazeContract =
  | {
      kind: 'source-matched'
    }
  | {
      kind: 'toward-character'
      targetCharacterId: string
      continuous: boolean
    }
  | {
      kind: 'screen-direction'
      direction: ScreenDirection
      continuous: boolean
    }

export type CharacterHeadDirectionContract =
  | {
      kind: 'source-matched'
    }
  | {
      kind: 'toward-character'
      targetCharacterId: string
      screenDirection: HeadTurnScreenDirection
      continuous: boolean
    }
  | {
      kind: 'screen-direction'
      direction: ScreenDirection
      continuous: boolean
    }

export interface CharacterInteractionContract {
  targetCharacterId: string
  description: string
  continuous: boolean
}

export interface CharacterMotionContract {
  id: string
  label: string
  screenSide: 'source-matched' | 'screen-left' | 'screen-right' | 'center'
  activeInterval: MotionInterval
  motion: SubjectMotionContract
  gaze: CharacterGazeContract
  headDirection: CharacterHeadDirectionContract
  interactions: readonly CharacterInteractionContract[]
}

export interface DepthRebuildMotionContract {
  durationSeconds: number
  singleTake: boolean
  camera: CameraMotionContract
  framing: FramingMotionContract
  characters: readonly CharacterMotionContract[]
}

export interface DepthRebuildMotionSettings {
  cameraDirection: CameraDirection
  framingCrop: FramingCrop
  subjectDirection: SubjectMotionDirection
  singleTake: boolean
  lockFraming: boolean
  noDirectionReversal: boolean
  gazeSourceCharacterId: string | null
  gazeTargetCharacterId: string | null
  interactionDescription: string
}

export interface MotionContractCharacterInput {
  id: string
  label: string
  sourceBinding: string
}

export const DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS: DepthRebuildMotionSettings = {
  cameraDirection: 'source-matched',
  framingCrop: 'source-matched',
  subjectDirection: 'source-matched',
  singleTake: false,
  lockFraming: true,
  noDirectionReversal: false,
  gazeSourceCharacterId: null,
  gazeTargetCharacterId: null,
  interactionDescription: '',
}

export interface MotionContractValidationResult {
  valid: boolean
  issues: readonly string[]
}

const CAMERA_DIRECTION_TEXT: Readonly<Record<CameraDirection, string>> = {
  'source-matched': 'matches video 1 frame by frame',
  backward: 'tracks backward, away from the advancing subjects',
  forward: 'tracks forward, toward the subjects',
  static: 'remains completely static on its fixed support',
  lateral: 'tracks laterally on a path parallel to the subjects',
}

const SUBJECT_MOTION_TEXT: Readonly<Record<SubjectMotionDirection, string>> = {
  'source-matched': 'matches the body movement direction in video 1',
  forward: 'moves forward',
  backward: 'moves backward',
  static: 'remains stationary',
  lateral: 'moves laterally',
}

const CAMERA_RELATION_TEXT: Readonly<Record<SubjectCameraRelation, string>> = {
  'source-matched': 'with the exact source relation to the camera',
  'toward-camera': 'toward the camera',
  'away-from-camera': 'away from the camera',
  'fixed-distance': 'while maintaining a fixed distance from the camera',
  'across-frame': 'across the frame',
}

const CROP_TEXT: Readonly<Record<FramingCrop, string>> = {
  'source-matched': 'source-matched anatomical crop',
  'close-up': 'close-up crop',
  'chest-up': 'chest-up crop',
  'waist-up': 'waist-up crop',
  'thigh-up': 'thigh-up crop',
  'full-body': 'full-body crop',
}

const SUBJECT_CAMERA_RELATION: Readonly<Record<SubjectMotionDirection, SubjectCameraRelation>> = {
  'source-matched': 'source-matched',
  forward: 'toward-camera',
  backward: 'away-from-camera',
  static: 'fixed-distance',
  lateral: 'across-frame',
}

const SOURCE_LEFT_PATTERNS = [
  /(?:原片|畫面|画面|鏡頭|镜头|螢幕|屏幕)(?:中|中的)?(?:左側|左侧|左邊|左边|左方)/u,
  /(?:screen[- ]left|left side of (?:the )?(?:source|frame|screen)|(?:source|frame|screen)(?: video)?(?:'s)? left side)/iu,
] as const

const SOURCE_RIGHT_PATTERNS = [
  /(?:原片|畫面|画面|鏡頭|镜头|螢幕|屏幕)(?:中|中的)?(?:右側|右侧|右邊|右边|右方)/u,
  /(?:screen[- ]right|right side of (?:the )?(?:source|frame|screen)|(?:source|frame|screen)(?: video)?(?:'s)? right side)/iu,
] as const

function inferScreenSide(sourceBinding: string): CharacterMotionContract['screenSide'] {
  const binding = sourceBinding.trim()
  const matchesLeft = SOURCE_LEFT_PATTERNS.some((pattern) => pattern.test(binding))
  const matchesRight = SOURCE_RIGHT_PATTERNS.some((pattern) => pattern.test(binding))
  if (matchesLeft === matchesRight) return 'source-matched'
  return matchesLeft ? 'screen-left' : 'screen-right'
}

function directionTowardTarget(
  sourceSide: CharacterMotionContract['screenSide'],
  targetSide: CharacterMotionContract['screenSide'],
): HeadTurnScreenDirection {
  if (sourceSide === 'screen-left' && targetSide === 'screen-right') return 'screen-right'
  if (sourceSide === 'screen-right' && targetSide === 'screen-left') return 'screen-left'
  return 'source-matched'
}

/**
 * Converts the small editable UI contract into the complete per-character
 * contract consumed by the prompt builder. The user-visible controls stay
 * provider-agnostic while the generated prompt remains explicit.
 */
export function createDepthRebuildMotionContract(input: {
  durationSeconds: number
  characters: readonly MotionContractCharacterInput[]
  settings: DepthRebuildMotionSettings
}): DepthRebuildMotionContract {
  const characterIds = new Set(input.characters.map((character) => character.id))
  const gazeSourceId = input.settings.gazeSourceCharacterId
  const gazeTargetId = input.settings.gazeTargetCharacterId
  const hasGazePair = Boolean(
    gazeSourceId
    && gazeTargetId
    && gazeSourceId !== gazeTargetId
    && characterIds.has(gazeSourceId)
    && characterIds.has(gazeTargetId),
  )
  const screenSides = new Map(input.characters.map((character) => [
    character.id,
    inferScreenSide(character.sourceBinding),
  ]))

  return {
    durationSeconds: input.durationSeconds,
    singleTake: input.settings.singleTake,
    camera: {
      direction: input.settings.cameraDirection,
      continuous: input.settings.cameraDirection !== 'source-matched',
      noDirectionReversal: input.settings.noDirectionReversal,
      speed: 'source-matched',
    },
    framing: {
      crop: input.settings.framingCrop,
      locked: input.settings.lockFraming,
      subjectScale: input.settings.lockFraming && input.settings.framingCrop !== 'source-matched'
        ? 'constant'
        : 'source-matched',
    },
    characters: input.characters.map((character) => {
      const looksAtTarget = hasGazePair && character.id === gazeSourceId
      const targetCharacterId = looksAtTarget ? gazeTargetId : null
      const screenSide = screenSides.get(character.id) ?? 'source-matched'
      const targetScreenSide = targetCharacterId
        ? screenSides.get(targetCharacterId) ?? 'source-matched'
        : 'source-matched'
      return {
        id: character.id,
        label: character.label,
        screenSide,
        activeInterval: { startSeconds: 0, endSeconds: input.durationSeconds },
        motion: {
          direction: input.settings.subjectDirection,
          relationToCamera: SUBJECT_CAMERA_RELATION[input.settings.subjectDirection],
          continuous: input.settings.subjectDirection !== 'source-matched',
          speed: 'source-matched',
        },
        gaze: targetCharacterId
          ? { kind: 'toward-character' as const, targetCharacterId, continuous: true }
          : { kind: 'source-matched' as const },
        headDirection: targetCharacterId
          ? {
              kind: 'toward-character' as const,
              targetCharacterId,
              screenDirection: directionTowardTarget(screenSide, targetScreenSide),
              continuous: true,
            }
          : { kind: 'source-matched' as const },
        interactions: targetCharacterId && input.settings.interactionDescription.trim()
          ? [{
              targetCharacterId,
              description: input.settings.interactionDescription.trim(),
              continuous: true,
            }]
          : [],
      }
    }),
  }
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

function formatInterval(interval: MotionInterval): string {
  return `${formatSeconds(interval.startSeconds)}–${formatSeconds(interval.endSeconds)}`
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function validateInterval(
  interval: MotionInterval,
  durationSeconds: number,
  field: string,
  issues: string[],
): void {
  if (!Number.isFinite(interval.startSeconds) || !Number.isFinite(interval.endSeconds)) {
    issues.push(`${field} 必須使用有限秒數`)
    return
  }
  if (interval.startSeconds < 0 || interval.endSeconds > durationSeconds) {
    issues.push(`${field} 必須位於 0–${durationSeconds} 秒內`)
  }
  if (interval.startSeconds >= interval.endSeconds) {
    issues.push(`${field} 的結束時間必須晚於開始時間`)
  }
}

/**
 * Validates all temporal and cross-character references without mutating the contract.
 */
export function validateMotionContract(
  contract: DepthRebuildMotionContract,
): MotionContractValidationResult {
  const issues: string[] = []

  if (!Number.isFinite(contract.durationSeconds) || contract.durationSeconds <= 0) {
    issues.push('durationSeconds 必須是大於 0 的有限秒數')
  }
  // 零角色 = 自由重繪模式（保留原表演者，不做身份替換）——運鏡與構圖
  // 規則仍然成立，角色相關區段自然為空。

  const ids = contract.characters.map((character) => character.id.trim())
  const knownIds = new Set(ids.filter(hasText))
  if (knownIds.size !== ids.length) {
    issues.push('每位角色都必須有不重複且非空白的 id')
  }

  contract.characters.forEach((character, index) => {
    const field = `角色 ${index + 1}`
    if (!hasText(character.label)) issues.push(`${field} label 不可留白`)
    validateInterval(character.activeInterval, contract.durationSeconds, `${field} activeInterval`, issues)

    const referencedCharacterIds = [
      ...(character.gaze.kind === 'toward-character' ? [character.gaze.targetCharacterId] : []),
      ...(character.headDirection.kind === 'toward-character'
        ? [character.headDirection.targetCharacterId]
        : []),
      ...character.interactions.map((interaction) => interaction.targetCharacterId),
    ]
    referencedCharacterIds.forEach((targetId) => {
      if (!knownIds.has(targetId)) {
        issues.push(`${field} 引用了不存在的角色 id：${targetId}`)
      }
      if (targetId === character.id) {
        issues.push(`${field} 不可把自身設為視線、頭部或互動對象`)
      }
    })
    character.interactions.forEach((interaction, interactionIndex) => {
      if (!hasText(interaction.description)) {
        issues.push(`${field} interaction ${interactionIndex + 1} description 不可留白`)
      }
    })
  })

  return {
    valid: issues.length === 0,
    issues,
  }
}

function characterNameById(
  charactersById: ReadonlyMap<string, CharacterMotionContract>,
  id: string,
): string {
  const character = charactersById.get(id)
  if (!character) throw new Error(`找不到動作契約角色：${id}`)
  return character.label.trim()
}

function renderHeadDirection(
  character: CharacterMotionContract,
  charactersById: ReadonlyMap<string, CharacterMotionContract>,
): string {
  if (character.headDirection.kind === 'source-matched') {
    return 'matches their head direction and turn timing to video 1 at each timestamp'
  }
  if (character.headDirection.kind === 'toward-character') {
    const target = characterNameById(charactersById, character.headDirection.targetCharacterId)
    if (character.headDirection.screenDirection === 'source-matched') {
      return (
        `keeps their head turned toward the ${target} with the turn direction matched to video 1` +
        (character.headDirection.continuous ? ' continuously' : '')
      )
    }
    return (
      `keeps their head turned ${character.headDirection.screenDirection} toward the ${target}` +
      (character.headDirection.continuous ? ' continuously' : '')
    )
  }
  return (
    `keeps their head oriented ${character.headDirection.direction}` +
    (character.headDirection.continuous ? ' continuously' : '')
  )
}

function renderGaze(
  character: CharacterMotionContract,
  charactersById: ReadonlyMap<string, CharacterMotionContract>,
): string {
  if (character.gaze.kind === 'source-matched') {
    return 'matches their gaze target and eye movement to video 1 at each timestamp'
  }
  if (character.gaze.kind === 'toward-character') {
    const target = characterNameById(charactersById, character.gaze.targetCharacterId)
    return (
      `keeps their eyes on the ${target}` +
      (character.gaze.continuous ? ' for the entire interval' : '')
    )
  }
  return (
    `keeps their gaze ${character.gaze.direction}` +
    (character.gaze.continuous ? ' for the entire interval' : '')
  )
}

function renderInteraction(
  interaction: CharacterInteractionContract,
  charactersById: ReadonlyMap<string, CharacterMotionContract>,
): string {
  const target = characterNameById(charactersById, interaction.targetCharacterId)
  return (
    `${interaction.description.trim()} with the ${target}` +
    (interaction.continuous ? ' continuously' : '')
  )
}

/**
 * Converts a validated structured contract into a temporally explicit English
 * prompt section. It is deterministic and has no runtime or provider effects.
 */
export function buildMotionContractPromptSection(contract: DepthRebuildMotionContract): string {
  const validation = validateMotionContract(contract)
  if (!validation.valid) {
    throw new Error(`動作契約無效：${validation.issues.join('；')}`)
  }

  const fullInterval: MotionInterval = {
    startSeconds: 0,
    endSeconds: contract.durationSeconds,
  }
  const fullIntervalText = formatInterval(fullInterval)
  const charactersById = new Map(contract.characters.map((character) => [character.id, character]))
  const cameraRule = contract.camera.direction === 'source-matched'
    ? 'The camera path, direction, speed, distance, pauses and accelerations must match video 1 at each timestamp.'
    : `The camera ${CAMERA_DIRECTION_TEXT[contract.camera.direction]} at ${contract.camera.speed === 'steady' ? 'a steady speed' : 'the source-matched speed'}.`
  const cameraContinuity = contract.camera.direction === 'source-matched'
    ? 'Preserve every source camera pause and direction change at its exact timestamp; do not invent a push-in, pull-back or reversal.'
    : contract.camera.continuous
      ? 'This camera motion is continuous and may not pause or change direction.'
      : 'Follow the specified source timing for camera pauses.'
  const reversalRule = contract.camera.noDirectionReversal
    ? contract.camera.direction === 'backward'
      ? 'The camera must never advance, push in, or reverse direction at any moment.'
      : 'The camera must never reverse direction at any moment.'
    : 'Any camera direction change must match the source timing exactly.'
  const framingRule = contract.framing.crop === 'source-matched'
    ? contract.framing.locked
      ? (
          'At every timestamp, lock the anatomical crop, headroom, camera distance and framing to video 1. ' +
          'Reproduce any source reframing exactly; never widen, tighten or reveal more of the body independently.'
        )
      : 'Match the anatomical crop, headroom, camera distance and framing to video 1 at each timestamp.'
    : contract.framing.locked
      ? (
          `Maintain the same ${CROP_TEXT[contract.framing.crop]} in every frame. ` +
          'Do not widen, zoom out, reveal lower legs or feet, or change the anatomical cutoff.'
        )
      : `Use the source timing for the ${CROP_TEXT[contract.framing.crop]}.`
  const scaleRule = contract.framing.subjectScale === 'constant'
    ? 'Keep each subject\'s apparent on-screen size nearly constant from the first frame to the last.'
    : 'Match each subject\'s on-screen scale to the source at the same timestamp.'

  const characterLines = contract.characters.flatMap((character) => {
    const interval = formatInterval(character.activeInterval)
    const placement = character.screenSide === 'source-matched'
      ? 'matches their screen position to video 1 at each timestamp'
      : `stays on ${character.screenSide}`
    const sourceMatchedMotion = character.motion.direction === 'source-matched'
      || character.motion.relationToCamera === 'source-matched'
    const motion = sourceMatchedMotion
      ? 'matches body direction, travel path and relation to the camera to video 1 at each timestamp'
      : (
          `${SUBJECT_MOTION_TEXT[character.motion.direction]} ` +
          `${CAMERA_RELATION_TEXT[character.motion.relationToCamera]}`
        )
    const continuity = character.motion.continuous
      ? 'continuously, without stopping or reversing direction'
      : 'with the exact starts and stops visible in the source'
    const speed = character.motion.speed === 'steady'
      ? 'at a steady speed'
      : 'at the source-matched speed'
    const interactions = character.interactions.length > 0
      ? character.interactions.map((interaction) => renderInteraction(interaction, charactersById)).join('; ')
      : 'preserves the source interaction timing without inventing contact'

    return [
      `[${interval} | ${character.label.toUpperCase()}]`,
      `The ${character.label} ${placement} and ${motion} ${continuity} ${speed}.`,
      `The ${character.label} ${renderHeadDirection(character, charactersById)} and ${renderGaze(character, charactersById)}.`,
      `Interaction: the ${character.label} ${interactions}.`,
    ]
  })

  return [
    '[MOTION CONTRACT — HIGHEST PRIORITY]',
    `All rules below apply at their stated timestamps within ${fullIntervalText}.`,
    '',
    `[${fullIntervalText} | SHOT CONTINUITY]`,
    contract.singleTake
      ? 'ONE continuous take from the first frame to the last. No cuts, transitions, time jumps, or alternate angles.'
      : 'Preserve the source shot boundaries and timing exactly.',
    '',
    `[${fullIntervalText} | CAMERA]`,
    cameraRule,
    cameraContinuity,
    reversalRule,
    '',
    `[${fullIntervalText} | FRAMING]`,
    framingRule,
    scaleRule,
    '',
    ...characterLines,
  ].join('\n')
}

/**
 * Default contract for the 11.2-second wedding walk source clip.
 */
export const DEFAULT_WEDDING_MOTION_CONTRACT = {
  durationSeconds: 11.2,
  singleTake: true,
  camera: {
    direction: 'backward',
    continuous: true,
    noDirectionReversal: true,
    speed: 'steady',
  },
  framing: {
    crop: 'thigh-up',
    locked: true,
    subjectScale: 'constant',
  },
  characters: [
    {
      id: 'groom',
      label: 'groom',
      screenSide: 'screen-left',
      activeInterval: { startSeconds: 0, endSeconds: 11.2 },
      motion: {
        direction: 'forward',
        relationToCamera: 'toward-camera',
        continuous: true,
        speed: 'steady',
      },
      gaze: {
        kind: 'toward-character',
        targetCharacterId: 'bride',
        continuous: true,
      },
      headDirection: {
        kind: 'toward-character',
        targetCharacterId: 'bride',
        screenDirection: 'screen-right',
        continuous: true,
      },
      interactions: [
        {
          targetCharacterId: 'bride',
          description: 'maintains the linked-arm contact and matched walking rhythm',
          continuous: true,
        },
      ],
    },
    {
      id: 'bride',
      label: 'bride',
      screenSide: 'screen-right',
      activeInterval: { startSeconds: 0, endSeconds: 11.2 },
      motion: {
        direction: 'forward',
        relationToCamera: 'toward-camera',
        continuous: true,
        speed: 'steady',
      },
      gaze: {
        kind: 'toward-character',
        targetCharacterId: 'groom',
        continuous: true,
      },
      headDirection: {
        kind: 'toward-character',
        targetCharacterId: 'groom',
        screenDirection: 'screen-left',
        continuous: true,
      },
      interactions: [
        {
          targetCharacterId: 'groom',
          description: 'maintains the linked-arm contact and matched walking rhythm',
          continuous: true,
        },
      ],
    },
  ],
} as const satisfies DepthRebuildMotionContract

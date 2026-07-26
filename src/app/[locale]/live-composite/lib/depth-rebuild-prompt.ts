import { VIDEO_PROMPT_HARD_LIMIT } from '@/lib/playground/video-prompt-limits'
import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'
import {
  buildMotionContractPromptSection,
  type DepthRebuildMotionContract,
} from './depth-rebuild-motion-contract'
import type { DepthRebuildGuidePlan } from './depth-rebuild-guide-plan'

export interface DepthRebuildPromptCharacter {
  label: string
  sourceBinding: string
  description: string
}

export interface DepthRebuildPromptSceneReference {
  note: string
}

export interface DepthRebuildPromptInput {
  durationSeconds: number
  characters: readonly DepthRebuildPromptCharacter[]
  sceneReferences: readonly DepthRebuildPromptSceneReference[]
  sceneDescription: string
  sourceAudioMode: SourceAudioMode
  motionContract: DepthRebuildMotionContract
}

export interface DepthRebuildPromptSegment {
  index: number
  count: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  continuityImageToken?: string
}

export interface AdaptiveDepthRebuildPromptInput
  extends Omit<DepthRebuildPromptInput, 'durationSeconds'> {
  guidePlan: DepthRebuildGuidePlan
}

function required(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field}不可留白`)
  return trimmed
}

function joinTokens(tokens: readonly string[]): string {
  if (tokens.length === 1) return tokens[0] ?? ''
  if (tokens.length === 2) return `${tokens[0]} and ${tokens[1]}`
  return `${tokens.slice(0, -1).join(', ')}, and ${tokens[tokens.length - 1]}`
}

/**
 * AtlasCloud Seedance 2.0 R2V 深度引導契約。
 *
 * Seedance has no API-level named subject binding. The ordered image map and
 * explicit source-performer descriptions are soft constraints, so the prompt
 * repeats identity-separation rules without claiming deterministic tracking.
 */
export function buildDepthRebuildPrompt(input: DepthRebuildPromptInput): string {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 4 || input.durationSeconds > 15) {
    throw new Error('深度重建只支援 4–15 秒影片')
  }
  if (input.characters.length === 0) throw new Error('至少需要一位新角色')

  const characters = input.characters.map((character, index) => ({
    label: required(character.label, `角色 ${index + 1} 名稱`),
    sourceBinding: required(character.sourceBinding, `角色 ${index + 1} 人物對應`),
    description: required(character.description, `角色 ${index + 1} 描述`),
    token: `image ${index + 1}`,
  }))
  const scene = required(input.sceneDescription, '新場景描述')
  const sceneReferences = input.sceneReferences.map((reference, index) => ({
    token: `image ${characters.length + index + 1}`,
    note: reference.note.trim() || `environment reference ${index + 1}`,
  }))
  const sceneTokens = sceneReferences.map((reference) => reference.token)
  const sceneBinding = sceneReferences.length > 0
    ? (
        `Use ${joinTokens(sceneTokens)} together only as visual references for the new environment's ` +
        'architecture, lighting, palette and materials. Do not use scene reference images to control or change ' +
        'composition, crop, framing, camera path, lens, camera distance, headroom, subject scale or subject screen position.'
      )
    : 'Build the new environment strictly from the scene direction below.'
  const audioBinding = input.sourceAudioMode === 'preserve'
    ? 'The original audio is carried by video 1 and must remain in the final output. Preserve its dialogue, music, pauses, rhythm and emotional intensity; keep visible mouth timing aligned with that audio. Do not clean, replace or reinterpret the source recording.'
    : input.sourceAudioMode === 'reference-only'
      ? 'Use the original audio carried by video 1 only as a timing reference for dialogue, pauses, rhythm, emotion and visible mouth motion. The final output must be silent so dialogue and sound can be replaced in post-production.'
      : 'The source audio has been removed. Generate new natural diegetic sound for the rebuilt scene. Do not claim to preserve the original dialogue; spoken words may differ unless they are explicitly supplied in the written direction.'
  const motionContractSection = buildMotionContractPromptSection(input.motionContract)

  const prompt = [
    '[REFERENCE MAP]',
    'video 1 = original RGB performance video. It is the sole authority for camera path, camera direction, shot timing, framing, head direction, gaze, facial expression, interaction, dialogue timing and body motion.',
    'video 2 = synchronized grayscale inverse-depth geometry guide; white is nearer to camera and black is farther away. Use it only for silhouettes, relative depth, occlusion, spatial scale and parallax. It must never override video 1 for camera direction, head direction, gaze, expression or interaction.',
    ...characters.map((character) => (
      `${character.token} = identity, face, hair, body proportions, costume and styling for "${character.label}". ` +
      `Replace only: ${character.sourceBinding}. Use it for appearance only; ignore its pose, action, background, lens and framing.`
    )),
    ...sceneReferences.map((reference) => (
      `${reference.token} = new environment reference (${reference.note}).`
    )),
    '',
    motionContractSection,
    '',
    '[HIGH PRIORITY FRAMING LOCK]',
    'This is a high-priority prompt constraint, not an API-level camera lock.',
    'At each timestamp, copy video 1 camera path, perspective, distance, headroom, screen positions, subject size and anatomical crop; video 2 may reinforce geometry only.',
    'Never zoom out, dolly out, reframe, widen the shot or reveal a full body when video 1 does not.',
    '',
    '[IDENTITY AND ENVIRONMENT CONTRACT]',
    ...characters.map((character) => (
      `Replace only the performer identified as "${character.sourceBinding}" with "${character.label}" from ${character.token}. ` +
      'Keep that performer\'s RGB motion, head direction, gaze, screen position and interaction timing; never apply the identity to another performer.'
    )),
    'Keep every specified new identity separate and temporally stable. Never swap, merge or duplicate identities when performers cross, overlap or leave the frame.',
    'Preserve RGB performer count, entrance order and interaction topology.',
    sceneBinding,
    audioBinding,
    '',
    '[NEW CHARACTERS]',
    ...characters.flatMap((character, index) => [
      `${index + 1}. ${character.label}`,
      `Source performer: ${character.sourceBinding}`,
      `Appearance direction: ${character.description}`,
    ]),
    '',
    '[NEW ENVIRONMENT]',
    scene,
    '',
    '[QUALITY RULES]',
    'Photorealistic cinematic live action; stable identity/anatomy; natural cloth, hair, contact shadows and perspective.',
    'The environment must remain alive with subtle continuous motion appropriate to the scene; never render it as a static photograph.',
    'No split screen, no visible depth map, no monochrome output, no subtitles, no text, no watermark, no unintended extra people, no duplicated limbs, no character swapping.',
  ].join('\n')

  if (prompt.length > VIDEO_PROMPT_HARD_LIMIT) {
    throw new Error(
      `多人與場景描述合成後為 ${prompt.length} 字，超過 Seedance Prompt 上限 ${VIDEO_PROMPT_HARD_LIMIT} 字；請縮短角色或場景描述`,
    )
  }
  return prompt
}

/**
 * 單筆自適應 Depth 重建 Prompt。
 *
 * 新契約刻意把完整 Depth 放在 video 1，讓全片只有一條不被切斷的運鏡、
 * 構圖與身體軌跡；video 2（若存在）只補原片 RGB 的表情／視線細節，
 * 不得反過來改寫完整 Depth 的鏡頭幾何。
 */
export function buildAdaptiveDepthRebuildPrompt(
  input: AdaptiveDepthRebuildPromptInput,
): string {
  const { guidePlan } = input
  if (
    !Number.isFinite(guidePlan.sourceDurationSeconds)
    || guidePlan.sourceDurationSeconds < 4
    || guidePlan.sourceDurationSeconds > 15
    || !Number.isInteger(guidePlan.outputDurationSeconds)
    || guidePlan.outputDurationSeconds < 4
    || guidePlan.outputDurationSeconds > 15
  ) {
    throw new Error('深度重建只支援 4–15 秒影片，且模型輸出秒數必須是整數')
  }
  if (input.characters.length === 0) throw new Error('至少需要一位新角色')

  const characters = input.characters.map((character, index) => ({
    label: required(character.label, `角色 ${index + 1} 名稱`),
    sourceBinding: required(character.sourceBinding, `角色 ${index + 1} 人物對應`),
    description: required(character.description, `角色 ${index + 1} 描述`),
    token: `image ${index + 1}`,
  }))
  const scene = required(input.sceneDescription, '新場景描述')
  const sceneReferences = input.sceneReferences.map((reference, index) => ({
    token: `image ${characters.length + index + 1}`,
    note: reference.note.trim() || `environment reference ${index + 1}`,
  }))
  const sceneTokens = sceneReferences.map((reference) => reference.token)
  const sceneBinding = sceneReferences.length > 0
    ? (
        `Use ${joinTokens(sceneTokens)} together only as visual references for the new environment's ` +
        'architecture, lighting, palette and materials. Do not use scene reference images to control or change ' +
        'composition, crop, framing, camera path, lens, camera distance, headroom, subject scale or subject screen position.'
      )
    : 'Build the new environment strictly from the scene direction below.'

  const secondary = guidePlan.secondary
  const rgbReferenceRule = secondary === null
    ? [
        'There is no RGB reference video in this request. Do not invent a different camera move, body trajectory, cut, entrance order or performer count.',
        'Depth cannot encode eye detail. Follow the written head, gaze and interaction rules below without changing video 1 geometry.',
      ]
    : secondary.selection === 'full-source'
      ? [
          `video 2 = the full original RGB performance from source 0.00s–${guidePlan.sourceDurationSeconds.toFixed(2)}s.`,
          'Use video 2 only to refine head turns, gaze, facial expression, hand interaction, mouth timing and source rhythm at the matching timestamp. It must not change video 1 camera path, framing, body trajectory, scale, occlusion or timing.',
        ]
      : [
          `video 2 = the original RGB detail clip for source ${secondary.sourceStartSeconds.toFixed(2)}s–${secondary.sourceEndSeconds.toFixed(2)}s; its local time 0.00s–${secondary.durationSeconds.toFixed(2)}s maps exactly to that same interval in the final output.`,
          `Use video 2 only inside final-output time ${secondary.sourceStartSeconds.toFixed(2)}s–${secondary.sourceEndSeconds.toFixed(2)}s to refine the critical head turn, gaze, expression, contact and mouth timing. Outside that interval, continue video 1 motion at the original speed. Never restart, repeat, slow down or move this detail clip to another timestamp.`,
          'video 2 must never change video 1 camera path, framing, body trajectory, scale, occlusion or timing.',
        ]

  const audioBinding = input.sourceAudioMode === 'preserve'
    ? 'Do not create replacement dialogue or music. Match visible mouth motion and emotional timing to the separately supplied original source audio; the platform will restore that exact original audio after generation.'
    : input.sourceAudioMode === 'reference-only'
      ? 'Use the separately supplied original audio only as a timing reference for mouth motion, pauses, rhythm and emotion. The generated result must remain silent for later sound editing.'
      : 'Generate natural diegetic sound for the rebuilt scene. Do not claim to preserve the original spoken words unless they are explicitly supplied in the written direction.'
  const motionContractSection = buildMotionContractPromptSection(input.motionContract)
  const sourceEnd = guidePlan.sourceDurationSeconds.toFixed(2)
  const outputEnd = guidePlan.outputDurationSeconds.toFixed(2)

  const prompt = [
    '[SINGLE ADAPTIVE DEPTH REBUILD — ONE REQUEST]',
    `Generate exactly ${outputEnd}s. Reproduce the source performance at its original speed from 0.00s–${sourceEnd}s. Do not squeeze, stretch, restart or repeat it.`,
    guidePlan.outputDurationSeconds > guidePlan.sourceDurationSeconds
      ? `From ${sourceEnd}s–${outputEnd}s, hold the final camera direction, pose, identity and lighting without starting a new action; the platform will trim this safety tail and deliver exactly ${sourceEnd}s.`
      : `The delivered duration remains ${sourceEnd}s.`,
    '',
    '[REFERENCE MAP — FIXED ORDER]',
    `video 1 = the complete synchronized inverse-depth guide from source 0.00s–${sourceEnd}s; white is nearer and black is farther. It is the sole full-timeline authority for camera path and direction, shot timing, anatomical crop, subject scale and screen position, body trajectories, silhouettes, occlusion, parallax and entrance order.`,
    ...rgbReferenceRule,
    ...characters.map((character) => (
      `${character.token} = identity, face, hair, body proportions, costume and styling for "${character.label}". ` +
      `Replace only: ${character.sourceBinding}. Use it for appearance only; ignore its pose, action, background, lens and framing.`
    )),
    ...sceneReferences.map((reference) => (
      `${reference.token} = new environment reference (${reference.note}).`
    )),
    '',
    motionContractSection,
    '',
    '[HIGH PRIORITY CAMERA AND FRAMING LOCK]',
    'This is a prompt constraint, not an API-level deterministic tracking guarantee.',
    'At every source timestamp, copy video 1 camera direction, perspective, distance, crop, headroom, screen positions and subject scale. Preserve the source-relative speed between camera and performers.',
    'Never add an establishing shot, push in before pulling back, reverse direction, zoom out, widen the frame, reveal feet or a full body when the source does not.',
    '',
    '[IDENTITY AND ENVIRONMENT CONTRACT]',
    ...characters.map((character) => (
      `Replace only the performer identified as "${character.sourceBinding}" with "${character.label}" from ${character.token}. ` +
      'Keep that performer\'s screen side, body motion, head timing, interaction timing and source-relative speed; never apply the identity to another performer.'
    )),
    'Keep every specified identity separate and stable. Never swap, merge, duplicate or reassign identities when performers overlap, cross, turn or leave the frame.',
    'Preserve performer count, entrance order and interaction topology from video 1.',
    sceneBinding,
    audioBinding,
    '',
    '[NEW CHARACTERS]',
    ...characters.flatMap((character, index) => [
      `${index + 1}. ${character.label}`,
      `Source performer: ${character.sourceBinding}`,
      `Appearance direction: ${character.description}`,
    ]),
    '',
    '[NEW ENVIRONMENT]',
    scene,
    '',
    '[QUALITY RULES]',
    'Photorealistic cinematic live action; stable identity and anatomy; natural skin, cloth, hair, contact shadows, perspective and motion blur.',
    'The environment must contain subtle continuous motion appropriate to the scene; never render it as a static photograph.',
    'No split screen, no visible depth map, no monochrome output, no subtitles, no text, no watermark, no unintended extra people, no duplicated limbs, no character swapping.',
  ].join('\n')

  if (prompt.length > VIDEO_PROMPT_HARD_LIMIT) {
    throw new Error(
      `多人與場景描述合成後為 ${prompt.length} 字，超過 Seedance Prompt 上限 ${VIDEO_PROMPT_HARD_LIMIT} 字；請縮短角色或場景描述`,
    )
  }
  return prompt
}

export function buildDepthRebuildSegmentPrompt(
  input: DepthRebuildPromptInput,
  segment: DepthRebuildPromptSegment,
): string {
  if (
    !Number.isInteger(segment.index)
    || !Number.isInteger(segment.count)
    || segment.index < 0
    || segment.count < 1
    || segment.index >= segment.count
  ) {
    throw new Error('深度重建分段序號無效')
  }
  if (
    !Number.isFinite(segment.sourceStartSeconds)
    || !Number.isFinite(segment.sourceEndSeconds)
    || segment.sourceStartSeconds < 0
    || segment.sourceEndSeconds <= segment.sourceStartSeconds
  ) {
    throw new Error('深度重建來源時間窗無效')
  }
  const basePrompt = buildDepthRebuildPrompt(input)
  const continuity = segment.continuityImageToken
    ? [
        '',
        '[SEGMENT CONTINUITY IMAGE]',
        `${segment.continuityImageToken} = the previous generated segment's final frame. Use it only to preserve identity, costume, lighting, subject scale and screen position at this segment's first frame. It must not change the RGB camera path, action, gaze or timing.`,
      ]
    : []
  const prompt = [
    `[SEGMENT ${segment.index + 1} OF ${segment.count}]`,
    `This request recreates only source interval ${segment.sourceStartSeconds.toFixed(2)}s–${segment.sourceEndSeconds.toFixed(2)}s. video 1 and video 2 are already trimmed to this exact synchronized interval. Output starts at local time 0.0s and ends at ${input.durationSeconds.toFixed(2)}s.`,
    segment.index > 0
      ? 'Continue the same uninterrupted take. Do not restart the action, reverse camera direction, reset the performers, or introduce a new shot.'
      : 'Begin at the exact source pose, framing and camera direction; do not add an establishing lead-in.',
    '',
    basePrompt,
    ...continuity,
  ].join('\n')
  if (prompt.length > VIDEO_PROMPT_HARD_LIMIT) {
    throw new Error(
      `分段 ${segment.index + 1} Prompt 為 ${prompt.length} 字，超過 Seedance Prompt 上限 ${VIDEO_PROMPT_HARD_LIMIT} 字；請縮短角色或場景描述`,
    )
  }
  return prompt
}

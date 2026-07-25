import { VIDEO_PROMPT_HARD_LIMIT } from '@/lib/playground/video-prompt-limits'
import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'
import {
  buildMotionContractPromptSection,
  type DepthRebuildMotionContract,
} from './depth-rebuild-motion-contract'

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

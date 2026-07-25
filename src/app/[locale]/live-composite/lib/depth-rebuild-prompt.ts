import { VIDEO_PROMPT_HARD_LIMIT } from '@/lib/playground/video-prompt-limits'

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
  preserveSourceAudio: boolean
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
    ? `Use ${joinTokens(sceneTokens)} together as visual references for the new environment, architecture, lighting, palette, materials and composition.`
    : 'Build the new environment strictly from the scene direction below.'
  const audioBinding = input.preserveSourceAudio
    ? 'The original audio is carried by video 1. Preserve its dialogue timing, pauses, rhythm and emotional intensity; keep visible mouth timing aligned with that audio.'
    : 'Do not invent spoken dialogue. Generate only natural environmental sound when appropriate.'

  const prompt = [
    '[REFERENCE MAP]',
    'video 1 = grayscale inverse-depth performance guide; white is nearer to camera and black is farther away.',
    ...characters.map((character) => (
      `${character.token} = identity, face, hair, body proportions, costume and styling for "${character.label}". ` +
      `This character replaces only: ${character.sourceBinding}.`
    )),
    ...sceneReferences.map((reference) => (
      `${reference.token} = new environment reference (${reference.note}).`
    )),
    '',
    '[CONTROL CONTRACT]',
    `Create one continuous ${input.durationSeconds.toFixed(1)}-second cinematic live-action shot.`,
    'Use video 1 only for body silhouettes, action order, walk paths, spatial depth, subject scale, framing, camera movement and exact timing.',
    'Do not copy grayscale color, original clothing, original faces, original background texture, signage or lighting from video 1.',
    ...characters.map((character) => (
      `Replace only the performer identified as "${character.sourceBinding}" with "${character.label}" from ${character.token}. ` +
      `Keep that performer's original motion, balance, gesture trajectory, screen position and interaction timing. ` +
      `Never apply "${character.label}" to another performer.`
    )),
    'Keep every specified new identity separate and temporally stable. Never swap, merge or duplicate identities when performers cross, overlap or leave the frame.',
    'Preserve the performer count, entrance order and interaction topology visible in video 1; do not invent or remove performers because of the new environment.',
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
    'Photorealistic cinematic live action, temporally stable identities, stable anatomy, natural cloth and hair motion, coherent contact shadows and perspective.',
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

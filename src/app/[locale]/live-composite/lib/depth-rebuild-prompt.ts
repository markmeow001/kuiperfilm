export interface DepthRebuildPromptInput {
  durationSeconds: number
  characterDescription: string
  sceneDescription: string
  hasSceneImage: boolean
  preserveSourceAudio: boolean
}

function required(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field}不可留白`)
  return trimmed
}

/**
 * AtlasCloud Seedance 2.0 R2V 深度引導契約。
 *
 * video 1 不是原片，也不是原生 ControlNet；它是灰階逆深度參考。因此 prompt
 * 明確限制它只提供空間、動作和運鏡，避免模型把灰階外觀帶進成品。
 */
export function buildDepthRebuildPrompt(input: DepthRebuildPromptInput): string {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 4 || input.durationSeconds > 15) {
    throw new Error('深度重建只支援 4–15 秒影片')
  }
  const character = required(input.characterDescription, '新角色描述')
  const scene = required(input.sceneDescription, '新場景描述')
  const sceneBinding = input.hasSceneImage
    ? 'Use image 2 as the visual reference for the new environment, architecture, lighting, palette and material language.'
    : 'Build the new environment strictly from the scene direction below.'
  const audioBinding = input.preserveSourceAudio
    ? 'The original audio is carried by video 1. Preserve its dialogue timing, pauses, rhythm and emotional intensity; keep visible mouth timing aligned with that audio.'
    : 'Do not invent spoken dialogue. Generate only natural environmental sound when appropriate.'

  return [
    '[REFERENCE MAP]',
    'video 1 = grayscale inverse-depth performance guide; white is nearer to camera and black is farther away.',
    'image 1 = the only identity and appearance reference for the new main character.',
    ...(input.hasSceneImage ? ['image 2 = new environment and art-direction reference.'] : []),
    '',
    '[CONTROL CONTRACT]',
    `Create one continuous ${input.durationSeconds.toFixed(1)}-second cinematic live-action shot.`,
    'Use video 1 only for body silhouette, action order, walk path, spatial depth, subject scale, framing, camera movement and exact timing.',
    'Do not copy grayscale color, original clothing, original face, original background texture, signage or lighting from video 1.',
    'Completely replace the primary performer with the character from image 1 while keeping the same body motion, balance, gesture trajectory and screen position.',
    'Preserve the performer count, entrance order and interaction topology visible in video 1; do not invent or remove performers because of the new environment.',
    sceneBinding,
    audioBinding,
    '',
    '[NEW CHARACTER]',
    character,
    '',
    '[NEW ENVIRONMENT]',
    scene,
    '',
    '[QUALITY RULES]',
    'Photorealistic cinematic live action, temporally stable identity, stable anatomy, natural cloth and hair motion, coherent contact shadows and perspective.',
    'The environment must remain alive with subtle continuous motion appropriate to the scene; never render it as a static photograph.',
    'No split screen, no visible depth map, no monochrome output, no subtitles, no text, no watermark, no unintended extra people, no duplicated limbs, no character swapping.',
  ].join('\n')
}

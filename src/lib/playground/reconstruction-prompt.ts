import type {
  ReconstructionDialogueLine,
  ReconstructionPromptInput,
  ReconstructionReferenceBinding,
} from './reconstruction-contract'

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
function dialogueSection(lines: ReconstructionDialogueLine[], preserveOriginal: boolean): string {
  const valid = lines
    .filter((line) => clean(line.text))
    .sort((a, b) => a.startSec - b.startSec)

  if (valid.length === 0) {
    return preserveOriginal
      ? 'Preserve the complete original dialogue, pauses, breathing, emotional delivery, speaker order, and timing from the audio of video 1. Do not invent or rewrite speech.'
      : 'Follow the speech timing, pauses, and emotional delivery visible in video 1. Do not invent additional dialogue.'
  }

  const transcript = valid.map((line) => {
    const timing = `${line.startSec.toFixed(2)}s-${line.endSec.toFixed(2)}s`
    const emotion = clean(line.emotion) ? `; delivery: ${clean(line.emotion)}` : ''
    return `- ${timing}, ${clean(line.speaker) || 'speaker'} says exactly: “${clean(line.text)}”${emotion}`
  }).join('\n')

  return [
    'Preserve the following dialogue word-for-word. Keep the exact speaker order, sentence timing, pauses, breathing rhythm, emotional intensity, head movement, facial expression, and body language from video 1:',
    transcript,
    'Do not translate, rewrite, shorten, extend, reorder, or invent any spoken words. Match natural Mandarin lip movement to every line.',
  ].join('\n')
}

const REFERENCE_ROLE_INSTRUCTIONS: Record<ReconstructionReferenceBinding['role'], string> = {
  character: 'Use this image as the exact identity, face, body proportions, hairstyle, and age reference for the named character.',
  environment: 'Use this image as the exact architecture, layout, materials, palette, and atmosphere reference for the reconstructed environment.',
  wardrobe: 'Use this image as the exact wardrobe, hair, makeup, prosthetic makeup, and accessory reference.',
}

function referenceSection(references: ReconstructionReferenceBinding[]): string {
  if (references.length === 0) {
    return 'No additional still-image identity or environment references were supplied.'
  }
  return references
    .slice()
    .sort((a, b) => a.imageIndex - b.imageIndex)
    .map((reference) => (
      `- Reference image ${reference.imageIndex} is bound to “${clean(reference.name)}”. ${REFERENCE_ROLE_INSTRUCTIONS[reference.role]} Do not transfer this image to any other subject or scene element.`
    ))
    .join('\n')
}

export function buildReconstructionPrompt(input: ReconstructionPromptInput): string {
  const { analysis, creative, metadata, dialogue, audioMode, references = [] } = input
  const outputDurationSec = input.outputDurationSec ?? metadata.durationSec
  const preserveOriginal = audioMode === 'preserve-original'
  const subjects = analysis.subjects.map((subject) => (
    `- ${clean(subject.id)}: ${clean(subject.description)}; action: ${clean(subject.action)}; position: ${clean(subject.position)}; relation: ${clean(subject.relation) || 'not specified'}.`
  )).join('\n')
  const preserve = analysis.performance.mustPreserve.map((item) => `- ${clean(item)}`).join('\n')
  const risks = analysis.risks.map((item) => `- ${clean(item)}`).join('\n')

  return [
    'REFERENCE CONTRACT',
    `Use video 1 (${metadata.durationSec.toFixed(2)} seconds) as the exact source of performance, timing, blocking, camera motion, lens perspective, framing, subject scale changes, and depth parallax. Produce one continuous shot with a target duration of ${outputDurationSec.toFixed(2)} seconds.`,
    outputDurationSec === metadata.durationSec
      ? 'Preserve the original action timing without retiming or truncation.'
      : 'Fit the source performance into the requested output duration while preserving the action order, emotional beats, camera path, and relative timing. Do not invent replacement choreography.',
    preserveOriginal
      ? 'Use the reference audio from video 1 as the exact dialogue and timing contract. The final delivered audio must remain the original source audio.'
      : 'Generate synchronized production audio while following the dialogue contract below.',
    '',
    'SOURCE SHOT ANALYSIS',
    `Summary: ${clean(analysis.summary)}`,
    `Camera: ${clean(analysis.camera.shotSize)}, ${clean(analysis.camera.angle)}, ${clean(analysis.camera.movement)}, ${clean(analysis.camera.continuity)}.`,
    subjects,
    `Performance emotion: ${clean(analysis.performance.emotion)}. Timing: ${clean(analysis.performance.timing)}.`,
    'Must preserve:',
    preserve,
    '',
    'RECONSTRUCTION BRIEF',
    `Rebuild the entire shot as a photorealistic live-action scene set in ${clean(creative.era)}, at ${clean(creative.location)}.`,
    `Story context: ${clean(creative.story)}.`,
    creative.replacePeople
      ? `Replace every original performer completely with the following new character design while preserving only their performance: ${clean(creative.characterDesign)}.`
      : `Preserve the original performers' identity and apply only the requested styling: ${clean(creative.characterDesign)}.`,
    `Wardrobe, hair, and makeup: ${clean(creative.wardrobe)}.`,
    `Mood and visual language: ${clean(creative.mood)}. Weather and time: ${clean(creative.weatherAndTime)}.`,
    `The reconstructed environment must remain alive throughout the shot: ${clean(creative.backgroundMotion)}.`,
    '',
    'REFERENCE IMAGE BINDINGS',
    referenceSection(references),
    '',
    'DIALOGUE AND PERFORMANCE CONTRACT',
    dialogueSection(dialogue, preserveOriginal),
    '',
    'SPATIAL AND TEMPORAL REQUIREMENTS',
    `Replace the complete original environment (${clean(analysis.environment.description)}), including green screen and visible studio equipment when present. Preserve exact body motion, gait, gestures, facial emotion, interactions, relative spacing, entry and exit timing, and foot contact. The environment must respond to the source camera with coherent three-dimensional parallax, contact shadows, reflections, atmospheric motion, and lighting interaction.`,
    `Environmental motion reference: ${clean(analysis.environment.motionNotes)}.`,
    'Keep anatomy, faces, hands, clothing, architecture, lighting direction, and background identities temporally consistent across every frame. Produce cinematic photorealistic live action with natural motion blur, skin texture, fabric motion, depth of field, and subtle film grain.',
    '',
    'KNOWN RISKS TO CONTROL',
    risks || '- Maintain stable subject boundaries, foot contact, and background parallax.',
    '',
    'Do not add cuts, reframing, unexplained zooms, new actions, new dialogue, duplicated people, floating feet, sliding movement, identity flicker, costume flicker, frozen background elements, modern objects that conflict with the selected era, visible green-screen spill, studio equipment, subtitles, captions, logos, or watermarks.',
  ].filter((line) => line !== '').join('\n\n')
}

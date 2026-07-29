import { WORLD_ASSET_DEFINITIONS, type WorldAssetCode, type WorldBibleDocument } from './world-bible'

function line(label: string, value: string): string {
  return `${label}: ${value.trim()}`
}

export function buildWorldBibleAssetPrompt(document: WorldBibleDocument, code: WorldAssetCode) {
  const definition = WORLD_ASSET_DEFINITIONS.find((item) => item.code === code)
  if (!definition) throw new Error(`WORLD_ASSET_CODE_UNKNOWN: ${code}`)

  const prompt = [
    `Create a professional feature-film world bible plate titled internally ${definition.title}.`,
    definition.purpose,
    'This is a production design reference image, not a poster and not a character hero shot.',
    '',
    line('Project premise', document.projectPremise),
    line('Visual thesis', document.visualThesis),
    line('Era and geography', document.eraAndGeography),
    line('Society and factions', document.societyAndFactions),
    line('Technology rules', document.technologyRules),
    line('Color script', document.colorScript),
    line('Material and aging rules', document.materialRules),
    line('Architecture language', document.architectureLanguage),
    line('Camera and image format', document.cameraFormat),
    line('Explicit exclusions', document.forbiddenElements),
    '',
    'Reference images, when supplied, are evidence for material, color, architecture and atmosphere only. Do not copy recognizable people, text, logos or copyrighted characters from them.',
    'Make every visual choice usable by a production designer: coherent scale, physically plausible materials, motivated light, clear hierarchy and no unexplained ornament.',
    'No typography is required inside the generated image. Leave clean composition zones for later editorial labels.',
  ].join('\n')

  return {
    prompt,
    negativePrompt: [
      'movie poster',
      'character portrait',
      'celebrity likeness',
      'anime',
      'cartoon',
      'generic fantasy concept art',
      'unreadable text',
      'watermark',
      'logo',
      'random ornament',
      'inconsistent architecture',
      'plastic materials',
    ].join(', '),
  }
}

import { WORLD_ASSET_DEFINITIONS, type WorldAssetCode, type WorldBibleDocument } from './world-bible'

function line(label: string, value: string): string {
  return `${label}: ${value.trim()}`
}

const LIVE_ACTION_DELIVERABLE: Record<WorldAssetCode, string> = {
  'WORLD-FORMULA': 'Render one uninterrupted photorealistic live-action establishing frame. It must look captured on a physical feature-film set or location by a real cinema camera, not arranged as a mood board.',
  'FACTION-COLOR': 'Create a restrained production color board using four photorealistic live-action location, costume and practical-lighting studies. Every panel must look photographed, never painted.',
  'MATERIAL-AGING': 'Create a physical material reference board made from photorealistic macro photography of fabricated samples, real textiles, oxidized metals, stone, glass and biological surfaces.',
  'ARCH-SYMBOL': 'Create a photorealistic production-design reference sheet using photographed architectural maquettes, full-scale set details and physically fabricated symbols. Keep structures buildable and spatially coherent.',
}

export function buildWorldBibleAssetPrompt(document: WorldBibleDocument, code: WorldAssetCode) {
  const definition = WORLD_ASSET_DEFINITIONS.find((item) => item.code === code)
  if (!definition) throw new Error(`WORLD_ASSET_CODE_UNKNOWN: ${code}`)

  const prompt = [
    `Create a professional feature-film world bible plate titled internally ${definition.title}.`,
    definition.purpose,
    'This is a production design reference image, not a poster and not a character hero shot.',
    LIVE_ACTION_DELIVERABLE[code],
    'The target production is live-action photorealism. Every depicted space, object and material must obey real optics, gravity, construction, weathering and motivated practical light.',
    'Use natural photographic micro-contrast, physically credible surface response and restrained feature-film color. Preserve small imperfections; avoid beautified, illustrative or game-rendered surfaces.',
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
      'illustration',
      'hand-drawn',
      'digital painting',
      'painterly brushwork',
      'matte painting',
      'sketch',
      'concept art rendering',
      '3D render',
      'game art',
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

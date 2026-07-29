import { WORLD_ASSET_DEFINITIONS, type WorldAssetCode, type WorldBibleDocument } from './world-bible'

function line(label: string, value: string): string {
  return `${label}: ${value.trim()}`
}

const LIVE_ACTION_DELIVERABLE: Record<WorldAssetCode, string> = {
  'WORLD-FORMULA': 'Render one uninterrupted, edge-to-edge photorealistic live-action establishing shot that expresses the governing contradiction, scale and atmosphere of the world. It must look captured on a physical feature-film set or location by a real cinema camera.',
  'FACTION-COLOR': 'Render one uninterrupted, edge-to-edge photorealistic live-action scene that expresses faction hierarchy through costume color, architecture, depth staging and motivated practical light. Use one camera viewpoint and one coherent physical space.',
  'MATERIAL-AGING': 'Render one uninterrupted, edge-to-edge photorealistic set-detail or still-life photograph in which real textiles, oxidized metals, stone, glass and biological surfaces coexist naturally in one physically plausible location.',
  'ARCH-SYMBOL': 'Render one uninterrupted, edge-to-edge photorealistic live-action architecture shot. Integrate recurring non-linguistic symbols and technology physically into one buildable, spatially coherent set.',
}

export function buildWorldBibleAssetPrompt(document: WorldBibleDocument, code: WorldAssetCode) {
  const definition = WORLD_ASSET_DEFINITIONS.find((item) => item.code === code)
  if (!definition) throw new Error(`WORLD_ASSET_CODE_UNKNOWN: ${code}`)

  const prompt = [
    'Create exactly one production-design reference photograph for a professional live-action feature film.',
    'This is not a poster, document, presentation or character hero shot.',
    LIVE_ACTION_DELIVERABLE[code],
    'Output only a single full-bleed photograph. The entire canvas must be one continuous image from one camera viewpoint, with no white margin, border, grid, split screen, inset image, collage or multi-panel layout.',
    'The image itself must contain zero written characters: no title, heading, caption, label, annotation, callout, legend, letter, number, logo, watermark, readable signage or invented writing. Do not reserve or design any area for text.',
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
      'mood board',
      'reference board',
      'presentation board',
      'design sheet',
      'contact sheet',
      'document layout',
      'infographic',
      'diagram',
      'collage',
      'grid',
      'split screen',
      'multi-panel layout',
      'white border',
      'typography',
      'title',
      'caption',
      'label',
      'annotation',
      'letters',
      'numbers',
      'readable signage',
      'invented writing',
      'gibberish text',
      'unreadable text',
      'watermark',
      'logo',
      'random ornament',
      'inconsistent architecture',
      'plastic materials',
    ].join(', '),
  }
}

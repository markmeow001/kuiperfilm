import type { Prisma } from '@prisma/client'

export const WORLD_ASSET_DEFINITIONS = [
  {
    code: 'WORLD-FORMULA',
    title: 'World Core Formula',
    purpose: 'A single cinematic visual thesis showing the governing contradiction, scale and atmosphere of the world.',
  },
  {
    code: 'FACTION-COLOR',
    title: 'Faction Color System',
    purpose: 'A controlled faction palette board showing hierarchy, contrast, light ownership and forbidden color collisions.',
  },
  {
    code: 'MATERIAL-AGING',
    title: 'Material & Aging Rules',
    purpose: 'A production material board showing how cloth, metal, stone, glass and biological surfaces age in this world.',
  },
  {
    code: 'ARCH-SYMBOL',
    title: 'Architecture, Symbols & Exclusions',
    purpose: 'A spatial language board defining architecture, recurring symbols, technology integration and visibly excluded motifs.',
  },
] as const

export type WorldAssetCode = (typeof WORLD_ASSET_DEFINITIONS)[number]['code']

export interface WorldBibleReference {
  id: string
  key: string
  name: string
  category: string
  note: string
  createdAt: string
}

export interface WorldBibleAsset {
  code: WorldAssetCode
  taskId: string
  prompt: string
  negativePrompt: string
  requestedSeed: number | null
  seedStatus: 'applied' | 'unsupported'
  approved: boolean
  rejectionNote: string | null
}

export interface WorldBibleDocument {
  projectPremise: string
  visualThesis: string
  eraAndGeography: string
  societyAndFactions: string
  technologyRules: string
  colorScript: string
  materialRules: string
  architectureLanguage: string
  cameraFormat: string
  forbiddenElements: string
  references: WorldBibleReference[]
  assets: WorldBibleAsset[]
  modelKey: string
  resolution: string
  aspectRatio: string
  canonId: string | null
  lockedAt: string | null
}

export const EMPTY_WORLD_BIBLE: WorldBibleDocument = {
  projectPremise: '',
  visualThesis: '',
  eraAndGeography: '',
  societyAndFactions: '',
  technologyRules: '',
  colorScript: '',
  materialRules: '',
  architectureLanguage: '',
  cameraFormat: '',
  forbiddenElements: '',
  references: [],
  assets: [],
  modelKey: '',
  resolution: '',
  aspectRatio: '16:9',
  canonId: null,
  lockedAt: null,
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(source: Record<string, unknown>, key: keyof WorldBibleDocument): string {
  return typeof source[key] === 'string' ? source[key] as string : ''
}

function nullableText(source: Record<string, unknown>, key: keyof WorldBibleDocument): string | null {
  return typeof source[key] === 'string' && source[key] ? source[key] as string : null
}

function isWorldAssetCode(value: unknown): value is WorldAssetCode {
  return WORLD_ASSET_DEFINITIONS.some((definition) => definition.code === value)
}

export function parseWorldBible(value: Prisma.JsonValue | unknown): WorldBibleDocument {
  const source = record(value)
  const references = Array.isArray(source.references)
    ? source.references.flatMap((item) => {
      const entry = record(item)
      if (typeof entry.id !== 'string' || typeof entry.key !== 'string') return []
      return [{
        id: entry.id,
        key: entry.key,
        name: typeof entry.name === 'string' ? entry.name : 'Reference',
        category: typeof entry.category === 'string' ? entry.category : 'general',
        note: typeof entry.note === 'string' ? entry.note : '',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      }]
    })
    : []
  const assets = Array.isArray(source.assets)
    ? source.assets.flatMap((item) => {
      const entry = record(item)
      if (!isWorldAssetCode(entry.code) || typeof entry.taskId !== 'string') return []
      return [{
        code: entry.code,
        taskId: entry.taskId,
        prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
        negativePrompt: typeof entry.negativePrompt === 'string' ? entry.negativePrompt : '',
        requestedSeed: typeof entry.requestedSeed === 'number' ? entry.requestedSeed : null,
        seedStatus: entry.seedStatus === 'applied' ? 'applied' as const : 'unsupported' as const,
        approved: entry.approved === true,
        rejectionNote: typeof entry.rejectionNote === 'string' ? entry.rejectionNote : null,
      }]
    })
    : []

  return {
    projectPremise: text(source, 'projectPremise'),
    visualThesis: text(source, 'visualThesis'),
    eraAndGeography: text(source, 'eraAndGeography'),
    societyAndFactions: text(source, 'societyAndFactions'),
    technologyRules: text(source, 'technologyRules'),
    colorScript: text(source, 'colorScript'),
    materialRules: text(source, 'materialRules'),
    architectureLanguage: text(source, 'architectureLanguage'),
    cameraFormat: text(source, 'cameraFormat'),
    forbiddenElements: text(source, 'forbiddenElements'),
    references,
    assets,
    modelKey: text(source, 'modelKey'),
    resolution: text(source, 'resolution'),
    aspectRatio: text(source, 'aspectRatio') || '16:9',
    canonId: nullableText(source, 'canonId'),
    lockedAt: nullableText(source, 'lockedAt'),
  }
}

export function toWorldBibleJson(document: WorldBibleDocument): Prisma.InputJsonValue {
  return document as unknown as Prisma.InputJsonValue
}

export function worldBibleRequiredFieldsComplete(document: WorldBibleDocument): boolean {
  return [
    document.projectPremise,
    document.visualThesis,
    document.eraAndGeography,
    document.societyAndFactions,
    document.technologyRules,
    document.colorScript,
    document.materialRules,
    document.architectureLanguage,
    document.cameraFormat,
    document.forbiddenElements,
  ].every((value) => value.trim().length > 0)
}

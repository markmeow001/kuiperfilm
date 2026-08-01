import type { Prisma } from '@prisma/client'
import { parseStoredScriptAnalysis, type ScriptAnalysisDocument } from './script-analysis'
import {
  parseCandidateGenerationSnapshot,
  type CandidateGenerationSnapshot,
} from './candidate-history'
import { EMPTY_RESEARCH, parseResearch, type ResearchDocument } from './research'

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
  /** Phase 00 uploads are internal notes and never leave KuiperFilm. */
  externalProcessingAllowed: false
  reviewStatus: 'internal-only'
  createdAt: string
}

export interface ScreenplaySourceVersion {
  id: string
  key: string
  originalKey: string | null
  name: string
  sourceTitle: string
  sourceFormat: 'pasted' | 'docx' | 'txt' | 'md'
  mimeType: string
  sha256: string
  sizeBytes: number
  textLength: number
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
  originPrompt: string
  history: CandidateGenerationSnapshot[]
}

export type PendingWorldBibleAsset = Omit<WorldBibleAsset, 'taskId'>

export interface WorldGenerationReservation {
  id: string
  kind: 'initial' | 'regenerate'
  startedAt: string
  pendingAssets: PendingWorldBibleAsset[]
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
  sources: ScreenplaySourceVersion[]
  assets: WorldBibleAsset[]
  modelKey: string
  resolution: string
  aspectRatio: string
  canonId: string | null
  lockedAt: string | null
  scriptAnalysis: ScriptAnalysisDocument | null
  research: ResearchDocument
  generationReservation: WorldGenerationReservation | null
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
  sources: [],
  assets: [],
  modelKey: '',
  resolution: '',
  aspectRatio: '16:9',
  canonId: null,
  lockedAt: null,
  scriptAnalysis: null,
  research: EMPTY_RESEARCH,
  generationReservation: null,
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
        externalProcessingAllowed: false as const,
        reviewStatus: 'internal-only' as const,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      }]
    })
    : []
  const assets = Array.isArray(source.assets)
    ? source.assets.flatMap((item) => {
      const entry = record(item)
      if (!isWorldAssetCode(entry.code) || typeof entry.taskId !== 'string') return []
      const history = Array.isArray(entry.history)
        ? entry.history.flatMap((value) => {
          const snapshot = parseCandidateGenerationSnapshot(value)
          return snapshot ? [snapshot] : []
        })
        : []
      const prompt = typeof entry.prompt === 'string' ? entry.prompt : ''
      return [{
        code: entry.code,
        taskId: entry.taskId,
        prompt,
        negativePrompt: typeof entry.negativePrompt === 'string' ? entry.negativePrompt : '',
        requestedSeed: typeof entry.requestedSeed === 'number' ? entry.requestedSeed : null,
        seedStatus: entry.seedStatus === 'applied' ? 'applied' as const : 'unsupported' as const,
        approved: entry.approved === true,
        rejectionNote: typeof entry.rejectionNote === 'string' ? entry.rejectionNote : null,
        originPrompt: typeof entry.originPrompt === 'string' ? entry.originPrompt : history[0]?.prompt ?? prompt,
        history,
      }]
    })
    : []
  const sources = Array.isArray(source.sources)
    ? source.sources.flatMap((item) => {
      const entry = record(item)
      const sourceFormat = entry.sourceFormat
      if (
        typeof entry.id !== 'string'
        || typeof entry.key !== 'string'
        || typeof entry.sha256 !== 'string'
        || (sourceFormat !== 'pasted' && sourceFormat !== 'docx' && sourceFormat !== 'txt' && sourceFormat !== 'md')
      ) return []
      return [{
        id: entry.id,
        key: entry.key,
        originalKey: typeof entry.originalKey === 'string' ? entry.originalKey : null,
        name: typeof entry.name === 'string' ? entry.name : 'Screenplay',
        sourceTitle: typeof entry.sourceTitle === 'string' ? entry.sourceTitle : 'Screenplay',
        sourceFormat: sourceFormat as ScreenplaySourceVersion['sourceFormat'],
        mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : 'application/octet-stream',
        sha256: entry.sha256,
        sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : 0,
        textLength: typeof entry.textLength === 'number' ? entry.textLength : 0,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      }]
    })
    : []
  const reservationSource = record(source.generationReservation)
  const pendingAssets = Array.isArray(reservationSource.pendingAssets)
    ? reservationSource.pendingAssets.flatMap((item) => {
      const entry = record(item)
      if (!isWorldAssetCode(entry.code)) return []
      const history = Array.isArray(entry.history)
        ? entry.history.flatMap((value) => {
          const snapshot = parseCandidateGenerationSnapshot(value)
          return snapshot ? [snapshot] : []
        })
        : []
      const prompt = typeof entry.prompt === 'string' ? entry.prompt : ''
      return [{
        code: entry.code,
        prompt,
        negativePrompt: typeof entry.negativePrompt === 'string' ? entry.negativePrompt : '',
        requestedSeed: typeof entry.requestedSeed === 'number' ? entry.requestedSeed : null,
        seedStatus: entry.seedStatus === 'applied' ? 'applied' as const : 'unsupported' as const,
        approved: false,
        rejectionNote: null,
        originPrompt: typeof entry.originPrompt === 'string' ? entry.originPrompt : prompt,
        history,
      }]
    })
    : []
  const generationReservation = (
    typeof reservationSource.id === 'string'
    && (reservationSource.kind === 'initial' || reservationSource.kind === 'regenerate')
    && typeof reservationSource.startedAt === 'string'
    && pendingAssets.length > 0
  ) ? {
      id: reservationSource.id,
      kind: reservationSource.kind,
      startedAt: reservationSource.startedAt,
      pendingAssets,
    } satisfies WorldGenerationReservation
    : null

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
    sources,
    assets,
    modelKey: text(source, 'modelKey'),
    resolution: text(source, 'resolution'),
    aspectRatio: text(source, 'aspectRatio') || '16:9',
    canonId: nullableText(source, 'canonId'),
    lockedAt: nullableText(source, 'lockedAt'),
    scriptAnalysis: parseStoredScriptAnalysis(source.scriptAnalysis),
    research: parseResearch(source.research),
    generationReservation,
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

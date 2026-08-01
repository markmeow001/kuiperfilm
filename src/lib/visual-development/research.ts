export const RESEARCH_REFERENCE_CATEGORIES = [
  'casting-face',
  'costume-material',
  'film-color',
  'culture-symbol',
] as const

export const RESEARCH_RIGHTS_STATUSES = [
  'owned',
  'licensed',
  'public-domain',
  'editorial-reference',
  'unknown',
] as const

export type ResearchReferenceCategory = (typeof RESEARCH_REFERENCE_CATEGORIES)[number]
export type ResearchRightsStatus = (typeof RESEARCH_RIGHTS_STATUSES)[number]
export type ResearchReferenceUsage = 'use' | 'avoid'
export type ResearchReviewStatus = 'pending' | 'approved' | 'rejected'
export type ResearchStatus = 'draft' | 'locked'

export const MAX_RESEARCH_REFERENCES = 40
export const MAX_WORLD_GENERATION_REFERENCES = 12

const EXTERNAL_PROCESSING_RIGHTS = new Set<ResearchRightsStatus>([
  'owned',
  'licensed',
  'public-domain',
])

export interface ResearchReference {
  id: string
  key: string
  name: string
  category: ResearchReferenceCategory
  usage: ResearchReferenceUsage
  note: string
  sourceUrl: string
  creator: string
  license: string
  rightsStatus: ResearchRightsStatus
  externalProcessingAllowed: boolean
  downstreamEnabled: boolean
  reviewStatus: ResearchReviewStatus
  rejectionNote: string | null
  createdAt: string
}

export interface ResearchDocument {
  designQuestion: string
  visualHypothesis: string
  eraAndCulture: string
  materialReality: string
  cinematicLanguage: string
  culturalBoundaries: string
  assumptionsAndUnknowns: string
  sourcePolicy: string
  references: ResearchReference[]
  status: ResearchStatus
  version: number
  canonId: string | null
  lockedAt: string | null
}

export const EMPTY_RESEARCH: ResearchDocument = {
  designQuestion: '',
  visualHypothesis: '',
  eraAndCulture: '',
  materialReality: '',
  cinematicLanguage: '',
  culturalBoundaries: '',
  assumptionsAndUnknowns: '',
  sourcePolicy: '',
  references: [],
  status: 'draft',
  version: 1,
  canonId: null,
  lockedAt: null,
}

export const RESEARCH_EDITABLE_FIELDS = [
  'designQuestion',
  'visualHypothesis',
  'eraAndCulture',
  'materialReality',
  'cinematicLanguage',
  'culturalBoundaries',
  'assumptionsAndUnknowns',
  'sourcePolicy',
] as const satisfies ReadonlyArray<keyof ResearchDocument>

export interface ResearchGateResult {
  ready: boolean
  missingFields: Array<(typeof RESEARCH_EDITABLE_FIELDS)[number]>
  missingCategories: ResearchReferenceCategory[]
  pendingReferenceIds: string[]
  untraceableReferenceIds: string[]
  blockedExternalReferenceIds: string[]
  excessDownstreamReferenceIds: string[]
  missingConstraintNoteReferenceIds: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(source: Record<string, unknown>, key: string): string {
  return typeof source[key] === 'string' ? source[key] as string : ''
}

function isCategory(value: unknown): value is ResearchReferenceCategory {
  return RESEARCH_REFERENCE_CATEGORIES.includes(value as ResearchReferenceCategory)
}

function isRightsStatus(value: unknown): value is ResearchRightsStatus {
  return RESEARCH_RIGHTS_STATUSES.includes(value as ResearchRightsStatus)
}

function parseReference(value: unknown): ResearchReference | null {
  const source = record(value)
  if (typeof source.id !== 'string' || typeof source.key !== 'string') return null
  return {
    id: source.id,
    key: source.key,
    name: text(source, 'name') || 'Research reference',
    category: isCategory(source.category) ? source.category : 'film-color',
    usage: source.usage === 'avoid' ? 'avoid' : 'use',
    note: text(source, 'note'),
    sourceUrl: text(source, 'sourceUrl'),
    creator: text(source, 'creator'),
    license: text(source, 'license'),
    rightsStatus: isRightsStatus(source.rightsStatus) ? source.rightsStatus : 'unknown',
    externalProcessingAllowed: source.externalProcessingAllowed === true,
    downstreamEnabled: source.downstreamEnabled === true,
    reviewStatus: source.reviewStatus === 'approved' || source.reviewStatus === 'rejected'
      ? source.reviewStatus
      : 'pending',
    rejectionNote: typeof source.rejectionNote === 'string' && source.rejectionNote
      ? source.rejectionNote
      : null,
    createdAt: text(source, 'createdAt'),
  }
}

export function parseResearch(value: unknown): ResearchDocument {
  const source = record(value)
  const references = Array.isArray(source.references)
    ? source.references.flatMap((item) => {
      const parsed = parseReference(item)
      return parsed ? [parsed] : []
    })
    : []

  return {
    designQuestion: text(source, 'designQuestion'),
    visualHypothesis: text(source, 'visualHypothesis'),
    eraAndCulture: text(source, 'eraAndCulture'),
    materialReality: text(source, 'materialReality'),
    cinematicLanguage: text(source, 'cinematicLanguage'),
    culturalBoundaries: text(source, 'culturalBoundaries'),
    assumptionsAndUnknowns: text(source, 'assumptionsAndUnknowns'),
    sourcePolicy: text(source, 'sourcePolicy'),
    references,
    status: source.status === 'locked' ? 'locked' : 'draft',
    version: typeof source.version === 'number' && Number.isInteger(source.version) && source.version > 0
      ? source.version
      : 1,
    canonId: typeof source.canonId === 'string' && source.canonId ? source.canonId : null,
    lockedAt: typeof source.lockedAt === 'string' && source.lockedAt ? source.lockedAt : null,
  }
}

export function evaluateResearchGate(document: ResearchDocument): ResearchGateResult {
  const missingFields = RESEARCH_EDITABLE_FIELDS.filter((field) => document[field].trim().length === 0)
  const approvedReferences = document.references.filter((reference) => reference.reviewStatus === 'approved')
  const approvedUseReferences = approvedReferences.filter((reference) => reference.usage === 'use')
  const missingCategories = RESEARCH_REFERENCE_CATEGORIES.filter((category) => (
    !approvedUseReferences.some((reference) => reference.category === category)
  ))
  const pendingReferenceIds = document.references
    .filter((reference) => reference.reviewStatus === 'pending')
    .map((reference) => reference.id)
  const untraceableReferenceIds = approvedReferences
    .filter((reference) => (
      reference.rightsStatus === 'unknown'
      || !reference.creator.trim()
      || (reference.rightsStatus !== 'owned' && !isHttpUrl(reference.sourceUrl))
      || (reference.rightsStatus === 'licensed' && !reference.license.trim())
    ))
    .map((reference) => reference.id)
  const downstreamReferences = approvedUseReferences.filter((reference) => reference.downstreamEnabled)
  const blockedExternalReferenceIds = downstreamReferences
    .filter((reference) => (
      !reference.externalProcessingAllowed
      || !EXTERNAL_PROCESSING_RIGHTS.has(reference.rightsStatus)
    ))
    .map((reference) => reference.id)
  const excessDownstreamReferenceIds = downstreamReferences
    .filter((reference) => (
      reference.externalProcessingAllowed
      && EXTERNAL_PROCESSING_RIGHTS.has(reference.rightsStatus)
    ))
    .slice(MAX_WORLD_GENERATION_REFERENCES)
    .map((reference) => reference.id)
  const missingConstraintNoteReferenceIds = approvedReferences
    .filter((reference) => reference.usage === 'avoid' && !reference.note.trim())
    .map((reference) => reference.id)

  return {
    ready: missingFields.length === 0
      && missingCategories.length === 0
      && pendingReferenceIds.length === 0
      && untraceableReferenceIds.length === 0
      && blockedExternalReferenceIds.length === 0
      && excessDownstreamReferenceIds.length === 0
      && missingConstraintNoteReferenceIds.length === 0,
    missingFields,
    missingCategories,
    pendingReferenceIds,
    untraceableReferenceIds,
    blockedExternalReferenceIds,
    excessDownstreamReferenceIds,
    missingConstraintNoteReferenceIds,
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function approvedResearchReferenceKeys(document: ResearchDocument): string[] {
  if (document.status !== 'locked') return []
  return document.references
    .filter((reference) => (
      reference.reviewStatus === 'approved'
      && reference.usage === 'use'
      && reference.downstreamEnabled
      && reference.externalProcessingAllowed
      && EXTERNAL_PROCESSING_RIGHTS.has(reference.rightsStatus)
    ))
    .slice(0, MAX_WORLD_GENERATION_REFERENCES)
    .map((reference) => reference.key)
}

export function researchPromptConstraints(document: ResearchDocument): {
  use: string[]
  avoid: string[]
} {
  if (document.status !== 'locked') return { use: [], avoid: [] }
  const approved = document.references.filter((reference) => reference.reviewStatus === 'approved')
  return {
    use: approved
      .filter((reference) => reference.usage === 'use' && reference.note.trim())
      .map((reference) => reference.note.trim().slice(0, 600)),
    avoid: approved
      .filter((reference) => reference.usage === 'avoid' && reference.note.trim())
      .map((reference) => reference.note.trim().slice(0, 600)),
  }
}

export function canSendResearchReferenceExternally(reference: ResearchReference): boolean {
  return reference.externalProcessingAllowed
    && reference.downstreamEnabled
    && reference.usage === 'use'
    && EXTERNAL_PROCESSING_RIGHTS.has(reference.rightsStatus)
}

import type {
  CastingBatchView,
  CastingFormState,
  FaceBibleFormState,
} from './visual-development-types'

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export const EMPTY_CASTING_FORM: CastingFormState = {
  worldBible: { projectPremise: '', visualThesis: '' },
  characterDna: { role: '', coreTraits: '' },
  castingBrief: {
    apparentAge: '24–28',
    performerAge: '21+',
    ethnicity: '',
    faceStructure: '',
    emotionalRead: '',
    lifeHistory: '',
  },
  characterCode: 'CHAR-01',
  characterName: '',
  modelKey: '',
  resolution: '',
  aspectRatio: '',
}

export const EMPTY_FACE_FORM: FaceBibleFormState = {
  identityAnchors: '',
  allowedVariation: 'camera angle, gaze direction and the requested micro-expression only',
  forbiddenDrift: 'apparent age, ancestry, face width, eye spacing, nose shape, lip volume, jawline, hairline and distinctive marks',
  modelKey: '',
  resolution: '',
  aspectRatio: '3:4',
}

export type WorkspaceResponse = {
  data?: {
    workspace?: {
      status?: string
      worldBible?: Record<string, string> | null
      characters?: Array<{
        code: string
        name: string
        status: string
        characterDna?: Record<string, unknown> | null
        castingBrief?: Record<string, unknown> | null
        castingBatches?: CastingBatchView[]
      }>
    } | null
  }
}

import type { UserModelOption } from '@/lib/query/hooks/useUserModels'

export interface ProjectOption {
  id: string
  name: string
}

export interface CastingCandidateView {
  id: string
  code: string
  taskStatus: string
  progress: number
  resultUrl: string | null
  requestedSeed: number | null
  seedStatus: string
  shortlisted: boolean
  isCanon: boolean
  errorMessage: string | null
  rejectionNote?: string | null
}

export interface CastingBatchView {
  id: string
  stage: string
  modelKey: string
  provider: string
  modelId: string
  seedSupported: boolean
  aspectRatio: string
  resolution: string | null
  status: string
  candidates: CastingCandidateView[]
}

export interface FaceBibleFormState {
  identityAnchors: string
  allowedVariation: string
  forbiddenDrift: string
  modelKey: string
  resolution: string
  aspectRatio: string
}

export interface FaceBibleWorkspaceController {
  batch: CastingBatchView | null
  canonCandidate: CastingCandidateView | null
  characterCode: string
  characterStatus: string
  form: FaceBibleFormState
  imageModels: UserModelOption[]
  isGenerating: boolean
  isLoading: boolean
  onFieldChange: (field: keyof FaceBibleFormState, value: string) => void
  onGenerate: () => void
  onReview: (candidateId: string, approved: boolean, rejectionNote?: string) => void
  onLock: () => void
}

export interface CastingFormState {
  worldBible: Record<string, string>
  characterDna: Record<string, string>
  castingBrief: Record<string, string>
  characterCode: string
  characterName: string
  modelKey: string
  resolution: string
}

export interface CastingWorkspaceController {
  batch: CastingBatchView | null
  form: CastingFormState
  imageModels: UserModelOption[]
  isGenerating: boolean
  isLoading: boolean
  onFieldChange: (group: 'worldBible' | 'characterDna' | 'castingBrief', field: string, value: string) => void
  onIdentityChange: (field: 'characterCode' | 'characterName' | 'modelKey' | 'resolution', value: string) => void
  onGenerate: () => void
  onCandidateAction: (candidateId: string, action: 'shortlist' | 'canon-lock', shortlisted?: boolean) => void
}

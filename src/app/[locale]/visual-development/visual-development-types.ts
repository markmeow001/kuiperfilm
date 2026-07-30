import type { UserModelOption } from '@/lib/query/hooks/useUserModels'
import type { WorldAssetCode } from '@/lib/visual-development/world-bible'
import type { ScriptAnalysisDocument, ScriptSourceFormat } from '@/lib/visual-development/script-analysis'
import type { ProductionFieldId, ProductionStageDefinition, ProductionStageId } from '@/lib/visual-development/production-stages'
import type { ProductionStageBrief } from '@/lib/visual-development/stage-brief'

export interface ProjectOption {
  id: string
  name: string
}

export interface CharacterOption {
  code: string
  name: string
  status: string
}

export interface ScriptImportWorkspaceController {
  sourceTitle: string
  sourceFormat: ScriptSourceFormat
  scriptText: string
  modelKey: string
  llmModels: UserModelOption[]
  analysis: ScriptAnalysisDocument | null
  sources: ScriptSourceVersionView[]
  sourceVersionId: string | null
  taskStatus: string | null
  errorMessage: string | null
  selectedCharacterCodes: string[]
  applyWorldBible: boolean
  isUploading: boolean
  isAnalyzing: boolean
  isApplying: boolean
  onSourceTitleChange: (value: string) => void
  onScriptTextChange: (value: string) => void
  onModelChange: (value: string) => void
  onFileSelected: (file: File) => void
  onAnalyze: () => void
  onToggleCharacter: (code: string) => void
  onSelectAllCharacters: (selected: boolean) => void
  onApplyWorldBibleChange: (selected: boolean) => void
  onApply: () => void
}

export interface ScriptSourceVersionView {
  id: string
  name: string
  sourceTitle: string
  sourceFormat: ScriptSourceFormat
  sha256: string
  sizeBytes: number
  textLength: number
  createdAt: string
  version: number
  downloadUrl: string
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
  prompt?: string
  originPrompt?: string
  negativePrompt?: string | null
  history?: CandidateGenerationHistoryView[]
}

export interface CandidateGenerationHistoryView {
  taskId: string
  prompt: string
  negativePrompt: string | null
  requestedSeed: number | null
  effectiveSeed: number | null
  seedStatus: string
  modelKey: string
  provider: string
  modelId: string
  modelVersion: string | null
  aspectRatio: string
  resolution: string | null
  shortlisted: boolean
  isCanon: boolean
  rejectionNote: string | null
  createdAt: string
  taskStatus: string
  progress: number
  resultUrl: string | null
  errorCode: string | null
  errorMessage: string | null
}

export type CandidateRegenerationSeedMode = 'new' | 'reuse'

export interface CandidateRegenerationControls {
  regeneratingCandidateIds: readonly string[]
  onRegenerateCandidate: (
    candidateId: string,
    prompt: string,
    seedMode: CandidateRegenerationSeedMode,
  ) => void
}

export interface CastingBatchView {
  id: string
  stage: string
  createdAt?: string
  candidateCount: number
  modelKey: string
  provider: string
  modelId: string
  seedSupported: boolean
  aspectRatio: string
  resolution: string | null
  status: string
  candidates: CastingCandidateView[]
  promptStack?: Record<string, unknown> | null
}

export interface ProductionStageFormState {
  stageRecord: Record<ProductionFieldId, string>
  creativePrompt: string
  modelKey: string
  resolution: string
  aspectRatio: string
  duration: number
}

export interface ProductionStageWorkspaceController extends CandidateRegenerationControls {
  stage: ProductionStageDefinition
  stageBrief: ProductionStageBrief | null
  stageBriefTaskStatus: string | null
  stageBriefError: string | null
  analysisModel: string | null
  batch: CastingBatchView | null
  characterStatus: string
  prerequisiteReady: boolean
  form: ProductionStageFormState
  models: UserModelOption[]
  isGenerating: boolean
  isGeneratingBrief: boolean
  isLoading: boolean
  onCreateStageBrief: () => void
  onCreativePromptChange: (value: string) => void
  onResetCreativePrompt: () => void
  onSettingChange: (field: 'modelKey' | 'resolution' | 'aspectRatio' | 'duration', value: string | number) => void
  onGenerate: () => void
  onReview: (candidateId: string, approved: boolean, rejectionNote?: string) => void
  onSelectPrimary: (candidateId: string) => void
  onLock: () => void
}

export type ProductionStageBatchMap = Partial<Record<ProductionStageId, CastingBatchView>>

export interface WorldBibleReferenceView {
  id: string
  key: string
  name: string
  category: string
  note: string
  createdAt: string
  previewUrl?: string | null
}

export interface WorldBibleAssetView {
  code: WorldAssetCode
  taskId: string
  prompt: string
  negativePrompt: string
  requestedSeed: number | null
  seedStatus: string
  approved: boolean
  rejectionNote: string | null
  taskStatus: string
  progress: number
  resultUrl: string | null
  errorMessage: string | null
  originPrompt: string
  history: CandidateGenerationHistoryView[]
}

export interface WorldBibleFormState {
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
  modelKey: string
  resolution: string
  aspectRatio: string
}

export interface WorldBibleWorkspaceController {
  form: WorldBibleFormState
  references: WorldBibleReferenceView[]
  assets: WorldBibleAssetView[]
  status: string
  version: number
  canonId: string | null
  imageModels: UserModelOption[]
  isLoading: boolean
  isSaving: boolean
  isGenerating: boolean
  isUploading: boolean
  regeneratingAssetCodes: readonly WorldAssetCode[]
  onFieldChange: (field: keyof WorldBibleFormState, value: string) => void
  onSave: () => void
  onUploadReferences: (files: FileList) => void
  onRemoveReference: (referenceId: string) => void
  onGenerate: () => void
  onReviewAsset: (code: WorldAssetCode, approved: boolean, rejectionNote?: string) => void
  onRegenerateAsset: (
    code: WorldAssetCode,
    prompt: string,
    seedMode: CandidateRegenerationSeedMode,
  ) => void
  onLock: () => void
  onReload: () => void
}

export interface FaceBibleFormState {
  identityAnchors: string
  allowedVariation: string
  forbiddenDrift: string
  modelKey: string
  resolution: string
  aspectRatio: string
}

export interface FaceBibleWorkspaceController extends CandidateRegenerationControls {
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

export interface HairDesignFormState {
  hairSilhouette: string
  partingAndHairline: string
  lengthAndTexture: string
  storyRequirements: string
  forbiddenDrift: string
  modelKey: string
  resolution: string
  aspectRatio: string
}

export interface HairDesignWorkspaceController extends CandidateRegenerationControls {
  explorationBatch: CastingBatchView | null
  validationBatch: CastingBatchView | null
  identityCandidate: CastingCandidateView | null
  selectedHairCandidate: CastingCandidateView | null
  characterCode: string
  characterStatus: string
  form: HairDesignFormState
  imageModels: UserModelOption[]
  isGenerating: boolean
  isLoading: boolean
  onFieldChange: (field: keyof HairDesignFormState, value: string) => void
  onGenerateExploration: () => void
  onSelectDirection: (candidateId: string) => void
  onGenerateValidation: () => void
  onReviewValidation: (candidateId: string, approved: boolean, rejectionNote?: string) => void
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
  aspectRatio: string
}

export interface CastingWorkspaceController extends CandidateRegenerationControls {
  batch: CastingBatchView | null
  batches: CastingBatchView[]
  activeBatchId: string
  form: CastingFormState
  worldStatus: string
  imageModels: UserModelOption[]
  isGenerating: boolean
  isLoading: boolean
  onFieldChange: (group: 'worldBible' | 'characterDna' | 'castingBrief', field: string, value: string) => void
  onIdentityChange: (field: 'characterCode' | 'characterName' | 'modelKey' | 'resolution' | 'aspectRatio', value: string) => void
  onOpenWorldBible: () => void
  onGenerate: () => void
  onSelectBatch: (batchId: string) => void
  onCandidateAction: (candidateId: string, action: 'shortlist' | 'canon-lock', shortlisted?: boolean) => void
}

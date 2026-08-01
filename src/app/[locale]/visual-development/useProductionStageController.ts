'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UserModelOption } from '@/lib/query/hooks/useUserModels'
import {
  canEnterProductionStage,
  getProductionStage,
  PRODUCTION_FIELD_IDS,
  type ProductionFieldId,
  type ProductionStageId,
} from '@/lib/visual-development/production-stages'
import {
  productionStageCreativePromptDnaKey,
  type ProductionStageBrief,
} from '@/lib/visual-development/stage-brief'
import {
  getVisualDevelopmentAspectRatios,
  pickVisualDevelopmentAspectRatio,
  reconcileVisualDevelopmentAspectRatio,
} from '@/lib/visual-development/model-options'
import type {
  CastingBatchView,
  CandidateRegenerationControls,
  ProductionStageFormState,
  ProductionStageWorkspaceController,
} from './visual-development-types'

interface UseProductionStageControllerInput {
  activeStageId: ProductionStageId
  projectId: string
  locale: string
  characterCode: string
  characterStatus: string
  characterDna: Record<string, string>
  batches: CastingBatchView[]
  imageModels: UserModelOption[]
  videoModels: UserModelOption[]
  isLoading: boolean
  onRefresh: () => Promise<void>
  candidateRegeneration: CandidateRegenerationControls
}

interface StageBriefTaskView {
  id: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

interface StageBriefState {
  brief: ProductionStageBrief | null
  creativePrompt: string
  analysisModel: string | null
  task: StageBriefTaskView | null
}

function emptyRecord(): Record<ProductionFieldId, string> {
  return Object.fromEntries(PRODUCTION_FIELD_IDS.map((field) => [field, ''])) as Record<ProductionFieldId, string>
}

function initialForm(stageId: ProductionStageId, dna: Record<string, string>): ProductionStageFormState {
  const stage = getProductionStage(stageId)
  return {
    stageRecord: emptyRecord(),
    creativePrompt: dna[productionStageCreativePromptDnaKey(stage.id)] ?? '',
    modelKey: dna[`draft_${stage.id}_modelKey`] ?? '',
    resolution: dna[`draft_${stage.id}_resolution`] ?? '',
    aspectRatio: dna[`draft_${stage.id}_aspectRatio`] ?? (stage.mediaType === 'video' ? '16:9' : '3:4'),
    duration: Number(dna[`draft_${stage.id}_duration`]) || 5,
  }
}

export function useProductionStageController(input: UseProductionStageControllerInput): {
  controller: ProductionStageWorkspaceController
  activeBatch: CastingBatchView | null
} {
  const [forms, setForms] = useState<Partial<Record<ProductionStageId, ProductionStageFormState>>>({})
  const [briefStates, setBriefStates] = useState<Partial<Record<ProductionStageId, StageBriefState>>>({})
  const [selectedBatchIds, setSelectedBatchIds] = useState<Partial<Record<ProductionStageId, string>>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSubmittingBrief, setIsSubmittingBrief] = useState(false)
  const lastSavedDraftsRef = useRef<Partial<Record<ProductionStageId, string>>>({})
  const loadedIdentityRef = useRef('')
  const initializedBriefFormsRef = useRef(new Set<string>())
  const stage = useMemo(() => getProductionStage(input.activeStageId), [input.activeStageId])
  const stageBatches = useMemo(
    () => input.batches.filter((item) => item.stage === stage.dbStage),
    [input.batches, stage.dbStage],
  )
  const batch = useMemo(() => (
    stageBatches.find((item) => item.id === selectedBatchIds[input.activeStageId])
      ?? stageBatches[0]
      ?? null
  ), [input.activeStageId, selectedBatchIds, stageBatches])
  const form = forms[input.activeStageId] ?? initialForm(input.activeStageId, input.characterDna)
  const briefState = briefStates[input.activeStageId] ?? null
  const stageBrief = briefState?.brief ?? null
  const stageLocked = Boolean(input.characterDna[`${stage.id}BatchId`])

  useEffect(() => {
    const identityKey = `${input.projectId}:${input.characterCode}`
    if (loadedIdentityRef.current === identityKey) return
    loadedIdentityRef.current = identityKey
    lastSavedDraftsRef.current = {}
    initializedBriefFormsRef.current.clear()
    setBriefStates({})
    setSelectedBatchIds({})
    setForms({ [input.activeStageId]: initialForm(input.activeStageId, input.characterDna) })
  }, [input.activeStageId, input.characterCode, input.characterDna, input.projectId])

  useEffect(() => {
    setForms((current) => current[input.activeStageId]
      ? current
      : { ...current, [input.activeStageId]: initialForm(input.activeStageId, input.characterDna) })
  }, [input.activeStageId, input.characterDna])

  const loadStageBrief = useCallback(async (stageId: ProductionStageId) => {
    if (!input.projectId || !input.characterCode) return
    const response = await fetch(
      `/api/visual-development/${input.projectId}/stages/${stageId}?characterCode=${encodeURIComponent(input.characterCode)}`,
    )
    const payload = await response.json() as {
      data?: StageBriefState
      error?: { message?: string; details?: { message?: string } }
    }
    if (!response.ok || !payload.data) {
      const message = payload.error?.details?.message ?? payload.error?.message ?? 'Stage brief load failed'
      setBriefStates((current) => ({
        ...current,
        [stageId]: {
          brief: null,
          creativePrompt: '',
          analysisModel: null,
          task: {
            id: '',
            status: 'failed',
            progress: 0,
            errorCode: 'STAGE_BRIEF_LOAD_FAILED',
            errorMessage: message,
            createdAt: '',
          },
        },
      }))
      return
    }
    setBriefStates((current) => ({ ...current, [stageId]: payload.data }))
    if (payload.data.brief) {
      const targetStage = getProductionStage(stageId)
      const formKey = `${input.projectId}:${input.characterCode}:${stageId}`
      const initializeCreativePrompt = !initializedBriefFormsRef.current.has(formKey)
      initializedBriefFormsRef.current.add(formKey)
      setForms((current) => {
        const active = current[stageId] ?? initialForm(stageId, input.characterDna)
        const stageRecord = emptyRecord()
        for (const field of targetStage.fields) stageRecord[field] = payload.data?.brief?.fields[field] ?? ''
        return {
          ...current,
          [stageId]: {
            ...active,
            stageRecord,
            creativePrompt: initializeCreativePrompt ? payload.data?.creativePrompt ?? '' : active.creativePrompt,
            ...(batch && stageId === input.activeStageId ? {
              modelKey: active.modelKey || batch.modelKey,
              resolution: active.resolution || batch.resolution || '',
              aspectRatio: active.aspectRatio || batch.aspectRatio,
            } : {}),
          },
        }
      })
    }
  }, [batch, input.activeStageId, input.characterCode, input.characterDna, input.projectId])

  useEffect(() => {
    void loadStageBrief(input.activeStageId)
  }, [input.activeStageId, input.characterCode, input.projectId, loadStageBrief])

  useEffect(() => {
    const status = briefState?.task?.status
    if (status !== 'queued' && status !== 'processing') return
    const timer = window.setInterval(() => void loadStageBrief(input.activeStageId), 2500)
    return () => window.clearInterval(timer)
  }, [briefState?.task?.status, input.activeStageId, loadStageBrief])

  useEffect(() => {
    if (!input.projectId || !input.characterCode || input.isLoading || stageLocked) return
    const signature = JSON.stringify(form)
    if (lastSavedDraftsRef.current[input.activeStageId] === signature) return
    const timer = window.setTimeout(() => {
      const characterDnaPatch: Record<string, string> = {
        [`draft_${stage.id}_modelKey`]: form.modelKey,
        [`draft_${stage.id}_resolution`]: form.resolution,
        [`draft_${stage.id}_aspectRatio`]: form.aspectRatio,
        [`draft_${stage.id}_duration`]: String(form.duration),
        [productionStageCreativePromptDnaKey(stage.id)]: form.creativePrompt,
      }
      void fetch(`/api/visual-development/${input.projectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save-draft', characterCode: input.characterCode, characterDnaPatch }),
      }).then((response) => {
        if (!response.ok) throw new Error(`${stage.id} autosave failed`)
        lastSavedDraftsRef.current[input.activeStageId] = signature
      }).catch((error) => window.alert(error instanceof Error ? error.message : String(error)))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [form, input.activeStageId, input.characterCode, input.isLoading, input.projectId, stage.id, stageLocked])

  const models = useMemo(() => stage.mediaType === 'video'
    ? input.videoModels.filter((model) => model.capabilities?.video?.supportReferenceImage === true)
    : input.imageModels.filter((model) =>
      model.capabilities?.image?.supportReferenceImage === true
      && model.capabilities.image.supportMultiReferenceImage === true),
  [input.imageModels, input.videoModels, stage.mediaType])

  useEffect(() => {
    if (!form.modelKey) return
    const selected = models.find((model) => model.value === form.modelKey)
    if (!selected) return
    const aspectRatio = reconcileVisualDevelopmentAspectRatio(form.aspectRatio, selected.capabilities, stage.mediaType)
    if (aspectRatio !== form.aspectRatio) {
      setForms((current) => ({
        ...current,
        [input.activeStageId]: {
          ...(current[input.activeStageId] ?? initialForm(input.activeStageId, input.characterDna)),
          aspectRatio,
        },
      }))
    }
  }, [form.aspectRatio, form.modelKey, input.activeStageId, input.characterDna, models, stage.mediaType])

  const updateForm = useCallback((change: (current: ProductionStageFormState) => ProductionStageFormState) => {
    setForms((current) => {
      const active = current[input.activeStageId] ?? initialForm(input.activeStageId, input.characterDna)
      return { ...current, [input.activeStageId]: change(active) }
    })
  }, [input.activeStageId, input.characterDna])

  const onCreativePromptChange = useCallback((value: string) => {
    updateForm((current) => ({ ...current, creativePrompt: value }))
  }, [updateForm])

  const onResetCreativePrompt = useCallback(() => {
    updateForm((current) => ({ ...current, creativePrompt: '' }))
  }, [updateForm])

  const onCreateStageBrief = useCallback(async () => {
    if (!input.projectId || !input.characterCode || stageBrief) return
    setIsSubmittingBrief(true)
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/stages/${stage.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create-stage-brief',
          characterCode: input.characterCode,
          meta: { locale: input.locale },
        }),
      })
      const payload = await response.json() as {
        data?: { taskId?: string; status?: string }
        error?: { message?: string; details?: { message?: string } }
      }
      if (!response.ok) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? 'Stage brief generation failed')
        return
      }
      await loadStageBrief(stage.id)
    } finally {
      setIsSubmittingBrief(false)
    }
  }, [input.characterCode, input.locale, input.projectId, loadStageBrief, stage.id, stageBrief])

  const onSettingChange = useCallback((field: 'modelKey' | 'resolution' | 'aspectRatio' | 'duration', value: string | number) => {
    updateForm((current) => {
      if (field !== 'modelKey') return { ...current, [field]: value }
      const selected = models.find((model) => model.value === value)
      const ratios = selected ? getVisualDevelopmentAspectRatios(selected.capabilities, stage.mediaType) : []
      const preferred = pickVisualDevelopmentAspectRatio(ratios, stage.mediaType)
      const durations = selected?.capabilities?.video?.durationOptions ?? []
      return { ...current, modelKey: String(value), resolution: '', aspectRatio: preferred, duration: durations[0] ?? current.duration }
    })
  }, [models, stage.mediaType, updateForm])

  const onGenerate = useCallback(async () => {
    if (!input.projectId || !form.modelKey) return
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/stages/${stage.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterCode: input.characterCode,
          modelKey: form.modelKey,
          resolution: form.resolution,
          aspectRatio: form.aspectRatio,
          duration: form.duration,
          creativePrompt: form.creativePrompt,
          meta: { locale: input.locale },
        }),
      })
      const payload = await response.json() as { data?: { batchId?: string }; error?: { message?: string; details?: { message?: string } } }
      if (!response.ok && response.status !== 207) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? 'Stage generation failed')
        return
      }
      if (payload.data?.batchId) {
        setSelectedBatchIds((current) => ({ ...current, [stage.id]: payload.data?.batchId }))
      }
      await input.onRefresh()
    } finally {
      setIsGenerating(false)
    }
  }, [form, input, stage.id])

  const patch = useCallback(async (body: Record<string, unknown>) => {
    if (!input.projectId) return
    const response = await fetch(`/api/visual-development/${input.projectId}/stages/${stage.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } }
      window.alert(payload.error?.message ?? 'Stage action failed')
      return
    }
    await input.onRefresh()
  }, [input, stage.id])

  const controller = useMemo<ProductionStageWorkspaceController>(() => ({
    ...input.candidateRegeneration,
    stage,
    stageBrief,
    stageBriefTaskStatus: briefState?.task?.status ?? null,
    stageBriefError: briefState?.task?.errorMessage ?? null,
    analysisModel: briefState?.analysisModel ?? null,
    batch,
    batches: stageBatches,
    activeBatchId: batch?.id ?? '',
    characterStatus: input.characterStatus,
    prerequisiteReady: canEnterProductionStage(input.characterStatus, stage.id),
    form,
    models,
    isGenerating,
    isGeneratingBrief: isSubmittingBrief
      || briefState?.task?.status === 'queued'
      || briefState?.task?.status === 'processing',
    isLoading: input.isLoading,
    onCreateStageBrief: () => void onCreateStageBrief(),
    onCreativePromptChange,
    onResetCreativePrompt,
    onSettingChange,
    onGenerate: () => void onGenerate(),
    onSelectBatch: (batchId) => setSelectedBatchIds((current) => ({ ...current, [stage.id]: batchId })),
    onReview: (candidateId, approved, rejectionNote) => void patch({ action: 'asset-review', candidateId, approved, rejectionNote }),
    onSelectPrimary: (candidateId) => void patch({ action: 'select-primary', candidateId }),
    onLock: () => batch && void patch({ action: 'canon-lock', batchId: batch.id }),
  }), [
    batch,
    briefState,
    form,
    input.characterStatus,
    input.candidateRegeneration,
    input.isLoading,
    isGenerating,
    isSubmittingBrief,
    models,
    onCreateStageBrief,
    onCreativePromptChange,
    onGenerate,
    onResetCreativePrompt,
    onSettingChange,
    patch,
    stage,
    stageBatches,
    stageBrief,
  ])

  return { controller, activeBatch: batch }
}

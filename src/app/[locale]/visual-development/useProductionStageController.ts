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
  getVisualDevelopmentAspectRatios,
  pickVisualDevelopmentAspectRatio,
  reconcileVisualDevelopmentAspectRatio,
} from '@/lib/visual-development/model-options'
import type {
  CastingBatchView,
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
}

function emptyRecord(): Record<ProductionFieldId, string> {
  return Object.fromEntries(PRODUCTION_FIELD_IDS.map((field) => [field, ''])) as Record<ProductionFieldId, string>
}

function initialForm(stageId: ProductionStageId, dna: Record<string, string>): ProductionStageFormState {
  const stage = getProductionStage(stageId)
  const record = emptyRecord()
  for (const field of stage.fields) record[field] = dna[`${stage.id}_${field}`] ?? ''
  return {
    stageRecord: record,
    modelKey: dna[`draft_${stage.id}_modelKey`] ?? '',
    resolution: dna[`draft_${stage.id}_resolution`] ?? '',
    aspectRatio: dna[`draft_${stage.id}_aspectRatio`] ?? (stage.mediaType === 'video' ? '16:9' : '3:4'),
    duration: Number(dna[`draft_${stage.id}_duration`]) || 5,
  }
}

function readStageRecord(batch: CastingBatchView | null, fields: readonly ProductionFieldId[]) {
  const raw = batch?.promptStack?.stageRecord
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const record = emptyRecord()
  for (const field of fields) record[field] = typeof source[field] === 'string' ? source[field].trim() : ''
  return fields.every((field) => record[field]) ? record : null
}

export function useProductionStageController(input: UseProductionStageControllerInput): {
  controller: ProductionStageWorkspaceController
  activeBatch: CastingBatchView | null
} {
  const [forms, setForms] = useState<Partial<Record<ProductionStageId, ProductionStageFormState>>>({})
  const [isGenerating, setIsGenerating] = useState(false)
  const lastSavedDraftsRef = useRef<Partial<Record<ProductionStageId, string>>>({})
  const loadedIdentityRef = useRef('')
  const stage = useMemo(() => getProductionStage(input.activeStageId), [input.activeStageId])
  const batch = useMemo(
    () => input.batches.find((item) => item.stage === stage.dbStage) ?? null,
    [input.batches, stage.dbStage],
  )
  const form = forms[input.activeStageId] ?? initialForm(input.activeStageId, input.characterDna)

  useEffect(() => {
    const identityKey = `${input.projectId}:${input.characterCode}`
    if (loadedIdentityRef.current === identityKey) return
    loadedIdentityRef.current = identityKey
    lastSavedDraftsRef.current = {}
    setForms({ [input.activeStageId]: initialForm(input.activeStageId, input.characterDna) })
  }, [input.activeStageId, input.characterCode, input.characterDna, input.projectId])

  useEffect(() => {
    setForms((current) => current[input.activeStageId]
      ? current
      : { ...current, [input.activeStageId]: initialForm(input.activeStageId, input.characterDna) })
  }, [input.activeStageId, input.characterDna])

  useEffect(() => {
    const restoredRecord = readStageRecord(batch, stage.fields)
    if (!restoredRecord || !batch) return
    setForms((current) => {
      const active = current[input.activeStageId] ?? initialForm(input.activeStageId, input.characterDna)
      if (stage.fields.some((field) => active.stageRecord[field]?.trim())) return current
      return {
        ...current,
        [input.activeStageId]: {
          ...active,
          stageRecord: restoredRecord,
          modelKey: batch.modelKey,
          resolution: batch.resolution ?? '',
          aspectRatio: batch.aspectRatio,
        },
      }
    })
  }, [batch, input.activeStageId, input.characterDna, stage.fields])

  useEffect(() => {
    if (!input.projectId || !input.characterCode || input.isLoading) return
    const signature = JSON.stringify(form)
    if (lastSavedDraftsRef.current[input.activeStageId] === signature) return
    const timer = window.setTimeout(() => {
      const characterDnaPatch: Record<string, string> = {
        [`draft_${stage.id}_modelKey`]: form.modelKey,
        [`draft_${stage.id}_resolution`]: form.resolution,
        [`draft_${stage.id}_aspectRatio`]: form.aspectRatio,
        [`draft_${stage.id}_duration`]: String(form.duration),
      }
      for (const field of stage.fields) characterDnaPatch[`${stage.id}_${field}`] = form.stageRecord[field]
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
  }, [form, input.activeStageId, input.characterCode, input.isLoading, input.projectId, stage.fields, stage.id])

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

  const onRecordChange = useCallback((field: ProductionFieldId, value: string) => {
    updateForm((current) => ({ ...current, stageRecord: { ...current.stageRecord, [field]: value } }))
  }, [updateForm])

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
          stageRecord: Object.fromEntries(stage.fields.map((field) => [field, form.stageRecord[field]])),
          meta: { locale: input.locale },
        }),
      })
      const payload = await response.json() as { error?: { message?: string; details?: { message?: string } } }
      if (!response.ok && response.status !== 207) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? 'Stage generation failed')
        return
      }
      await input.onRefresh()
    } finally {
      setIsGenerating(false)
    }
  }, [form, input, stage.fields, stage.id])

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
    stage,
    batch,
    characterStatus: input.characterStatus,
    prerequisiteReady: canEnterProductionStage(input.characterStatus, stage.id),
    form,
    models,
    isGenerating,
    isLoading: input.isLoading,
    onRecordChange,
    onSettingChange,
    onGenerate: () => void onGenerate(),
    onReview: (candidateId, approved, rejectionNote) => void patch({ action: 'asset-review', candidateId, approved, rejectionNote }),
    onSelectPrimary: (candidateId) => void patch({ action: 'select-primary', candidateId }),
    onLock: () => batch && void patch({ action: 'canon-lock', batchId: batch.id }),
  }), [batch, form, input.characterStatus, input.isLoading, isGenerating, models, onGenerate, onRecordChange, onSettingChange, patch, stage])

  return { controller, activeBatch: batch }
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { UserModelOption } from '@/lib/query/hooks/useUserModels'
import {
  getVisualDevelopmentAspectRatios,
  pickVisualDevelopmentAspectRatio,
  reconcileVisualDevelopmentAspectRatio,
} from '@/lib/visual-development/model-options'
import type {
  CastingBatchView,
  CastingCandidateView,
  HairDesignFormState,
  HairDesignWorkspaceController,
} from './visual-development-types'

const EMPTY_HAIR_FORM: HairDesignFormState = {
  hairSilhouette: 'distinctive at distance, readable around the face, and compatible with a high costume collar',
  partingAndHairline: 'preserve the natural Canon hairline; explore controlled, physically plausible parting',
  lengthAndTexture: 'natural strand grouping, believable density and weight, no wig-like volume',
  storyRequirements: 'support formal presentation and a later escape or battle-worn state without changing the core cut',
  forbiddenDrift: 'face, apparent age, ancestry, facial proportions, body, skin, makeup, wardrobe, accessories and background',
  modelKey: '',
  resolution: '',
  aspectRatio: '3:4',
}

interface UseHairDesignInput {
  projectId: string
  locale: string
  characterCode: string
  characterStatus: string
  characterDna: Record<string, string>
  faceBatch: CastingBatchView | null
  explorationBatch: CastingBatchView | null
  validationBatch: CastingBatchView | null
  imageModels: UserModelOption[]
  isLoading: boolean
  onRefresh: () => Promise<void>
}

interface ApiErrorPayload {
  error?: { message?: string; details?: { message?: string } }
}

export function useHairDesignController(input: UseHairDesignInput): {
  controller: HairDesignWorkspaceController
  activeBatch: CastingBatchView | null
} {
  const t = useTranslations('visualDevelopment')
  const [form, setForm] = useState<HairDesignFormState>(EMPTY_HAIR_FORM)
  const [isGenerating, setIsGenerating] = useState(false)
  const loadedProjectId = useRef('')
  const lastSavedDraftRef = useRef('')

  useEffect(() => {
    const identityKey = `${input.projectId}:${input.characterCode}`
    if (loadedProjectId.current !== identityKey) {
      loadedProjectId.current = identityKey
      const nextForm = {
        ...EMPTY_HAIR_FORM,
        hairSilhouette: input.characterDna.hairSilhouette || EMPTY_HAIR_FORM.hairSilhouette,
        partingAndHairline: input.characterDna.partingAndHairline || EMPTY_HAIR_FORM.partingAndHairline,
        lengthAndTexture: input.characterDna.lengthAndTexture || EMPTY_HAIR_FORM.lengthAndTexture,
        storyRequirements: input.characterDna.storyRequirements || EMPTY_HAIR_FORM.storyRequirements,
        forbiddenDrift: input.characterDna.hairForbiddenDrift || EMPTY_HAIR_FORM.forbiddenDrift,
        modelKey: input.characterDna.draft_hair_modelKey || '',
        resolution: input.characterDna.draft_hair_resolution || '',
        aspectRatio: input.characterDna.draft_hair_aspectRatio || '3:4',
      }
      setForm(nextForm)
      lastSavedDraftRef.current = JSON.stringify(nextForm)
      return
    }
    setForm((current) => ({
      ...current,
      hairSilhouette: input.characterDna.hairSilhouette || current.hairSilhouette,
      partingAndHairline: input.characterDna.partingAndHairline || current.partingAndHairline,
      lengthAndTexture: input.characterDna.lengthAndTexture || current.lengthAndTexture,
      storyRequirements: input.characterDna.storyRequirements || current.storyRequirements,
      forbiddenDrift: input.characterDna.hairForbiddenDrift || current.forbiddenDrift,
    }))
  }, [
    input.characterDna.hairForbiddenDrift,
    input.characterDna.draft_hair_aspectRatio,
    input.characterDna.draft_hair_modelKey,
    input.characterDna.draft_hair_resolution,
    input.characterDna.hairSilhouette,
    input.characterDna.lengthAndTexture,
    input.characterDna.partingAndHairline,
    input.characterDna.storyRequirements,
    input.projectId,
    input.characterCode,
  ])

  useEffect(() => {
    if (!input.projectId || !input.characterCode || input.isLoading) return
    const signature = JSON.stringify(form)
    if (signature === lastSavedDraftRef.current) return
    const timer = window.setTimeout(() => {
      const characterDnaPatch = {
        hairSilhouette: form.hairSilhouette,
        partingAndHairline: form.partingAndHairline,
        lengthAndTexture: form.lengthAndTexture,
        storyRequirements: form.storyRequirements,
        hairForbiddenDrift: form.forbiddenDrift,
        draft_hair_modelKey: form.modelKey,
        draft_hair_resolution: form.resolution,
        draft_hair_aspectRatio: form.aspectRatio,
      }
      void fetch(`/api/visual-development/${input.projectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save-draft', characterCode: input.characterCode, characterDnaPatch }),
      }).then((response) => {
        if (!response.ok) throw new Error('Hair Design autosave failed')
        lastSavedDraftRef.current = signature
      }).catch((error) => window.alert(error instanceof Error ? error.message : String(error)))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [form, input.characterCode, input.isLoading, input.projectId])

  const imageModels = useMemo(
    () => input.imageModels.filter((model) => (
      model.capabilities?.image?.supportReferenceImage === true
      && model.capabilities.image.supportMultiReferenceImage === true
    )),
    [input.imageModels],
  )

  useEffect(() => {
    if (!form.modelKey) return
    const selected = imageModels.find((model) => model.value === form.modelKey)
    if (!selected) return
    const aspectRatio = reconcileVisualDevelopmentAspectRatio(form.aspectRatio, selected.capabilities, 'image')
    if (aspectRatio !== form.aspectRatio) setForm((current) => ({ ...current, aspectRatio }))
  }, [form.aspectRatio, form.modelKey, imageModels])

  const updateField = useCallback((field: keyof HairDesignFormState, value: string) => {
    if (field === 'modelKey') {
      const selected = imageModels.find((model) => model.value === value)
      const ratios = selected ? getVisualDevelopmentAspectRatios(selected.capabilities, 'image') : []
      const preferredRatio = pickVisualDevelopmentAspectRatio(ratios, 'image')
      setForm((current) => ({ ...current, modelKey: value, resolution: '', aspectRatio: preferredRatio }))
      return
    }
    setForm((current) => ({ ...current, [field]: value }))
  }, [imageModels])

  const runGeneration = useCallback(async (action: 'explore' | 'validate') => {
    if (!input.projectId || !form.modelKey) return
    const selectedHairCandidate = input.explorationBatch?.candidates.find((candidate) => candidate.isCanon) ?? null
    if (action === 'validate' && !selectedHairCandidate) return
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/hair-design`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          characterCode: input.characterCode,
          modelKey: form.modelKey,
          resolution: form.resolution,
          aspectRatio: form.aspectRatio,
          ...(selectedHairCandidate ? { explorationCandidateId: selectedHairCandidate.id } : {}),
          hairRecord: {
            hairSilhouette: form.hairSilhouette,
            partingAndHairline: form.partingAndHairline,
            lengthAndTexture: form.lengthAndTexture,
            storyRequirements: form.storyRequirements,
            forbiddenDrift: form.forbiddenDrift,
          },
          meta: { locale: input.locale },
        }),
      })
      const payload = await response.json() as ApiErrorPayload
      if (!response.ok && response.status !== 207) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? t('workspace.hair.generateFailed'))
        return
      }
      await input.onRefresh()
    } finally {
      setIsGenerating(false)
    }
  }, [form, input, t])

  const patch = useCallback(async (body: Record<string, unknown>, fallback: string) => {
    if (!input.projectId) return false
    const response = await fetch(`/api/visual-development/${input.projectId}/hair-design`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const payload = await response.json() as ApiErrorPayload
      window.alert(payload.error?.details?.message ?? payload.error?.message ?? fallback)
      return false
    }
    await input.onRefresh()
    return true
  }, [input])

  const identityCandidate = useMemo<CastingCandidateView | null>(
    () => input.faceBatch?.candidates.find((candidate) => candidate.code === 'EXPR-RESTRAINED') ?? null,
    [input.faceBatch],
  )
  const selectedHairCandidate = useMemo<CastingCandidateView | null>(
    () => input.explorationBatch?.candidates.find((candidate) => candidate.isCanon) ?? null,
    [input.explorationBatch],
  )

  const controller = useMemo<HairDesignWorkspaceController>(() => ({
    explorationBatch: input.explorationBatch,
    validationBatch: input.validationBatch,
    identityCandidate,
    selectedHairCandidate,
    characterCode: input.characterCode,
    characterStatus: input.characterStatus,
    form,
    imageModels,
    isGenerating,
    isLoading: input.isLoading,
    onFieldChange: updateField,
    onGenerateExploration: () => void runGeneration('explore'),
    onSelectDirection: (candidateId) => void patch(
      { action: 'exploration-select', candidateId },
      t('workspace.hair.selectFailed'),
    ),
    onGenerateValidation: () => void runGeneration('validate'),
    onReviewValidation: (candidateId, approved, rejectionNote) => void patch(
      { action: 'asset-review', candidateId, approved, rejectionNote },
      t('workspace.hair.reviewFailed'),
    ),
    onLock: () => {
      if (!input.validationBatch) return
      void patch(
        { action: 'hair-lock', batchId: input.validationBatch.id },
        t('workspace.hair.lockFailed'),
      )
    },
  }), [
    form,
    identityCandidate,
    imageModels,
    input.characterCode,
    input.characterStatus,
    input.explorationBatch,
    input.isLoading,
    input.validationBatch,
    isGenerating,
    patch,
    runGeneration,
    selectedHairCandidate,
    t,
    updateField,
  ])

  return { controller, activeBatch: input.validationBatch ?? input.explorationBatch }
}

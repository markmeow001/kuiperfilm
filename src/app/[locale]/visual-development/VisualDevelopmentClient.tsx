'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { PRODUCTION_STAGE_IDS, type ProductionStageId } from '@/lib/visual-development/production-stages'
import {
  getVisualDevelopmentAspectRatios,
  pickVisualDevelopmentAspectRatio,
  reconcileVisualDevelopmentAspectRatio,
} from '@/lib/visual-development/model-options'
import { DevelopmentInspector } from './DevelopmentInspector'
import { DevelopmentRail, type LocalizedDevelopmentStage } from './DevelopmentRail'
import { StageWorkspace } from './StageWorkspace'
import { VisualDevelopmentHeader } from './VisualDevelopmentHeader'
import { useHairDesignController } from './useHairDesignController'
import { useCandidateRegeneration } from './useCandidateRegeneration'
import { useScriptImportController } from './useScriptImportController'
import { useResearchController } from './useResearchController'
import { useProductionStageController } from './useProductionStageController'
import { useWorldBibleController } from './useWorldBibleController'
import { useStageWorkspaceTranslations } from './useStageWorkspaceTranslations'
import { useVisualDevelopmentCharacterAutosave, useVisualDevelopmentProjectSelection } from './useVisualDevelopmentProjectState'
import { EMPTY_CASTING_FORM, EMPTY_FACE_FORM, toStringArray, toStringRecord, type WorkspaceResponse } from './visual-development-client-state'
import {
  DEFAULT_VISUAL_DEVELOPMENT_STAGE,
  VISUAL_DEVELOPMENT_STAGES,
  type VisualDevelopmentStageId,
} from './visual-development-config'
import type {
  CastingBatchView,
  CastingCandidateView,
  CastingWorkspaceController,
  FaceBibleFormState,
  FaceBibleWorkspaceController,
  CharacterOption,
} from './visual-development-types'

interface VisualDevelopmentClientProps {
  locale: string
}

export function VisualDevelopmentClient({ locale }: VisualDevelopmentClientProps) {
  const t = useTranslations('visualDevelopment')
  const [activeStageId, setActiveStageId] = useState<VisualDevelopmentStageId>(
    DEFAULT_VISUAL_DEVELOPMENT_STAGE,
  )
  const [candidateCount, setCandidateCount] = useState<4 | 8 | 10>(10)
  const { projects, projectId, changeProject, createProject } = useVisualDevelopmentProjectSelection(t('header.createFailed'))
  const [characters, setCharacters] = useState<CharacterOption[]>([])
  const [selectedCharacterCode, setSelectedCharacterCode] = useState('')
  const selectedCharacterCodeRef = useRef('')
  const selectedCastingBatchIdRef = useRef('')
  const selectedFaceBatchIdRef = useRef('')
  const selectedHairExplorationBatchIdRef = useRef('')
  const selectedHairValidationBatchIdRef = useRef('')
  const characterRevisionRef = useRef('')
  const [form, setForm] = useState(EMPTY_CASTING_FORM)
  const [batch, setBatch] = useState<CastingBatchView | null>(null)
  const [castingBatches, setCastingBatches] = useState<CastingBatchView[]>([])
  const [faceBatch, setFaceBatch] = useState<CastingBatchView | null>(null)
  const [faceBatches, setFaceBatches] = useState<CastingBatchView[]>([])
  const [hairExplorationBatch, setHairExplorationBatch] = useState<CastingBatchView | null>(null)
  const [hairExplorationBatches, setHairExplorationBatches] = useState<CastingBatchView[]>([])
  const [hairValidationBatch, setHairValidationBatch] = useState<CastingBatchView | null>(null)
  const [hairValidationBatches, setHairValidationBatches] = useState<CastingBatchView[]>([])
  const [productionBatches, setProductionBatches] = useState<CastingBatchView[]>([])
  const [faceForm, setFaceForm] = useState<FaceBibleFormState>(EMPTY_FACE_FORM)
  const [characterStatus, setCharacterStatus] = useState('draft')
  const [worldStatus, setWorldStatus] = useState('draft')
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isGeneratingFace, setIsGeneratingFace] = useState(false)
  const modelsQuery = useUserModels()
  const stageWorkspaceTranslations = useStageWorkspaceTranslations(candidateCount)

  const loadWorkspace = useCallback(async (selectedProjectId: string) => {
    if (!selectedProjectId) {
      setBatch(null)
      setCastingBatches([])
      setFaceBatch(null)
      setFaceBatches([])
      setHairExplorationBatch(null)
      setHairExplorationBatches([])
      setHairValidationBatch(null)
      setHairValidationBatches([])
      setProductionBatches([])
      setCharacters([])
      setSelectedCharacterCode('')
      selectedCharacterCodeRef.current = ''
      selectedCastingBatchIdRef.current = ''
      selectedFaceBatchIdRef.current = ''
      selectedHairExplorationBatchIdRef.current = ''
      selectedHairValidationBatchIdRef.current = ''
      characterRevisionRef.current = ''
      return
    }
    setIsLoadingWorkspace(true)
    try {
      const response = await fetch(`/api/visual-development/${selectedProjectId}`)
      if (!response.ok) return
      const payload = await response.json() as WorkspaceResponse
      const workspace = payload.data?.workspace
      setWorldStatus(workspace?.status ?? 'draft')
      const nextCharacters = workspace?.characters?.map(({ code, name, status }) => ({ code, name, status })) ?? []
      setCharacters(nextCharacters)
      const character = workspace?.characters?.find((item) => item.code === selectedCharacterCodeRef.current)
        ?? workspace?.characters?.[0]
      selectedCharacterCodeRef.current = character?.code ?? ''
      characterRevisionRef.current = character?.updatedAt ?? ''
      setSelectedCharacterCode(character?.code ?? '')
      const batches = character?.castingBatches ?? []
      const nextCastingBatches = batches.filter((item) => item.stage === 'casting')
      setCastingBatches(nextCastingBatches)
      const nextCastingBatch = nextCastingBatches.find((item) => item.id === selectedCastingBatchIdRef.current)
        ?? nextCastingBatches[0]
        ?? null
      selectedCastingBatchIdRef.current = nextCastingBatch?.id ?? ''
      setBatch(nextCastingBatch)
      const nextFaceBatches = batches.filter((item) => item.stage === 'face-lock')
      const nextFaceBatch = nextFaceBatches.find((item) => item.id === selectedFaceBatchIdRef.current) ?? nextFaceBatches[0] ?? null
      selectedFaceBatchIdRef.current = nextFaceBatch?.id ?? ''
      setFaceBatches(nextFaceBatches)
      setFaceBatch(nextFaceBatch)
      const nextHairExplorationBatches = batches.filter((item) => item.stage === 'hair-exploration')
      const nextHairExplorationBatch = nextHairExplorationBatches.find((item) => item.id === selectedHairExplorationBatchIdRef.current) ?? nextHairExplorationBatches[0] ?? null
      selectedHairExplorationBatchIdRef.current = nextHairExplorationBatch?.id ?? ''
      setHairExplorationBatches(nextHairExplorationBatches)
      setHairExplorationBatch(nextHairExplorationBatch)
      const nextHairValidationBatches = batches.filter((item) => item.stage === 'hair-validation')
      const nextHairValidationBatch = nextHairValidationBatches.find((item) => item.id === selectedHairValidationBatchIdRef.current) ?? nextHairValidationBatches[0] ?? null
      selectedHairValidationBatchIdRef.current = nextHairValidationBatch?.id ?? ''
      setHairValidationBatches(nextHairValidationBatches)
      setHairValidationBatch(nextHairValidationBatch)
      setProductionBatches(batches.filter((item) => item.stage.startsWith('phase-')))
      if (workspace) {
        setForm((current) => ({
          ...current,
          worldBible: {
            ...current.worldBible,
            projectPremise: workspace.worldBible?.projectPremise ?? '',
            visualThesis: workspace.worldBible?.visualThesis ?? '',
          },
        }))
      }
      if (workspace && character) {
        const characterDna = toStringRecord(character.characterDna)
        const castingBrief = toStringRecord(character.castingBrief)
        setCharacterStatus(character.status)
        setForm((current) => ({
          ...current,
          characterDna: { ...EMPTY_CASTING_FORM.characterDna, ...characterDna },
          castingBrief: { ...EMPTY_CASTING_FORM.castingBrief, ...castingBrief },
          characterCode: character.code,
          characterName: character.name,
        }))
        setFaceForm((current) => ({
          ...current,
          identityAnchors: characterDna.identityAnchors ?? EMPTY_FACE_FORM.identityAnchors,
          allowedVariation: characterDna.allowedVariation ?? EMPTY_FACE_FORM.allowedVariation,
          forbiddenDrift: characterDna.forbiddenDrift ?? EMPTY_FACE_FORM.forbiddenDrift,
        }))
      }
    } finally {
      setIsLoadingWorkspace(false)
    }
  }, [])

  const candidateRegeneration = useCandidateRegeneration({
    projectId,
    locale,
    onRefresh: async () => loadWorkspace(projectId),
  })

  useEffect(() => {
    selectedCharacterCodeRef.current = ''
    setSelectedCharacterCode('')
    setCharacters([])
    setBatch(null)
    setCastingBatches([])
    setFaceBatch(null)
    setFaceBatches([])
    setHairExplorationBatch(null)
    setHairExplorationBatches([])
    setHairValidationBatch(null)
    setHairValidationBatches([])
    setProductionBatches([])
    setForm(EMPTY_CASTING_FORM)
    setFaceForm(EMPTY_FACE_FORM)
    setCharacterStatus('draft')
    setWorldStatus('draft')
    selectedCastingBatchIdRef.current = ''
    selectedFaceBatchIdRef.current = ''
    selectedHairExplorationBatchIdRef.current = ''
    selectedHairValidationBatchIdRef.current = ''
    characterRevisionRef.current = ''
    void loadWorkspace(projectId)
  }, [projectId, loadWorkspace])

  const saveStatus = useVisualDevelopmentCharacterAutosave({
    projectId,
    characterCode: selectedCharacterCode || form.characterCode,
    form,
    faceForm,
    isLoading: isLoadingWorkspace,
    revisionRef: characterRevisionRef,
  })

  const selectCharacter = useCallback((characterCode: string) => {
    selectedCharacterCodeRef.current = characterCode
    selectedCastingBatchIdRef.current = ''
    selectedFaceBatchIdRef.current = ''
    selectedHairExplorationBatchIdRef.current = ''
    selectedHairValidationBatchIdRef.current = ''
    characterRevisionRef.current = ''
    setSelectedCharacterCode(characterCode)
    setCastingBatches([])
    setBatch(null)
    void loadWorkspace(projectId)
  }, [loadWorkspace, projectId])

  useEffect(() => {
    const hasActiveTasks = [...castingBatches, ...faceBatches, ...hairExplorationBatches, ...hairValidationBatches, ...productionBatches].some((activeBatch) => activeBatch.candidates.some((candidate) =>
      candidate.taskStatus === 'queued' || candidate.taskStatus === 'processing'))
    if (!projectId || !hasActiveTasks) return
    const timer = window.setInterval(() => void loadWorkspace(projectId), 3000)
    return () => window.clearInterval(timer)
  }, [castingBatches, faceBatches, hairExplorationBatches, hairValidationBatches, productionBatches, projectId, loadWorkspace])

  const updateField = useCallback((
    group: 'worldBible' | 'characterDna' | 'castingBrief',
    field: string,
    value: string,
  ) => {
    setForm((current) => ({ ...current, [group]: { ...current[group], [field]: value } }))
  }, [])

  const updateIdentity = useCallback((field: 'characterCode' | 'characterName' | 'modelKey' | 'resolution' | 'aspectRatio', value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'modelKey' ? { resolution: '', aspectRatio: '' } : {}),
    }))
  }, [])

  const generateCasting = useCallback(async () => {
    if (!projectId || !form.modelKey) return
    if (worldStatus !== 'world_locked') {
      window.alert(t('workspace.casting.worldRequired'))
      return
    }
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/visual-development/${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          candidateCount,
          meta: { locale },
        }),
      })
      const payload = await response.json() as {
        data?: { batchId?: string }
        error?: { message?: string; details?: { message?: string } }
      }
      if (!response.ok && response.status !== 207) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? t('workspace.casting.generateFailed'))
        return
      }
      selectedCastingBatchIdRef.current = payload.data?.batchId ?? ''
      await loadWorkspace(projectId)
    } finally {
      setIsGenerating(false)
    }
  }, [candidateCount, form, loadWorkspace, locale, projectId, t, worldStatus])

  const selectCastingBatch = useCallback((batchId: string) => {
    const selectedBatch = castingBatches.find((item) => item.id === batchId)
    if (!selectedBatch) return
    selectedCastingBatchIdRef.current = selectedBatch.id
    setBatch(selectedBatch)
  }, [castingBatches])

  const handleCandidateAction = useCallback(async (
    candidateId: string,
    action: 'shortlist' | 'canon-lock',
    shortlisted?: boolean,
  ) => {
    if (!projectId) return
    const response = await fetch(`/api/visual-development/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        candidateId,
        action,
        shortlisted,
        characterDraft: {
            characterName: form.characterName,
            characterDna: {
              ...form.characterDna,
              identityAnchors: faceForm.identityAnchors,
              allowedVariation: faceForm.allowedVariation,
              forbiddenDrift: faceForm.forbiddenDrift,
            },
            castingBrief: form.castingBrief,
        },
      }),
    })
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } }
      window.alert(payload.error?.message ?? t('workspace.casting.actionFailed'))
      return
    }
    await loadWorkspace(projectId)
  }, [faceForm, form, loadWorkspace, projectId, t])

  const referenceImageModels = useMemo(
    () => (modelsQuery.data?.image ?? []).filter((model) => model.capabilities?.image?.supportReferenceImage === true),
    [modelsQuery.data?.image],
  )

  useEffect(() => {
    if (!form.modelKey) return
    const selected = modelsQuery.data?.image?.find((model) => model.value === form.modelKey)
    if (!selected) return
    const aspectRatio = reconcileVisualDevelopmentAspectRatio(form.aspectRatio, selected.capabilities, 'image')
    if (aspectRatio !== form.aspectRatio) {
      setForm((current) => ({ ...current, aspectRatio }))
    }
  }, [form.aspectRatio, form.modelKey, modelsQuery.data?.image])

  useEffect(() => {
    if (!faceForm.modelKey) return
    const selected = referenceImageModels.find((model) => model.value === faceForm.modelKey)
    if (!selected) return
    const aspectRatio = reconcileVisualDevelopmentAspectRatio(faceForm.aspectRatio, selected.capabilities, 'image')
    if (aspectRatio !== faceForm.aspectRatio) setFaceForm((current) => ({ ...current, aspectRatio }))
  }, [faceForm.aspectRatio, faceForm.modelKey, referenceImageModels])

  const updateFaceField = useCallback((field: keyof FaceBibleFormState, value: string) => {
    if (field === 'modelKey') {
      const selected = referenceImageModels.find((model) => model.value === value)
      const ratios = selected ? getVisualDevelopmentAspectRatios(selected.capabilities, 'image') : []
      const preferredRatio = pickVisualDevelopmentAspectRatio(ratios, 'image')
      setFaceForm((current) => ({ ...current, modelKey: value, resolution: '', aspectRatio: preferredRatio }))
      return
    }
    setFaceForm((current) => ({ ...current, [field]: value }))
  }, [referenceImageModels])

  const generateFaceBible = useCallback(async () => {
    if (!projectId || !faceForm.modelKey) return
    setIsGeneratingFace(true)
    try {
      const response = await fetch(`/api/visual-development/${projectId}/face-bible`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterCode: form.characterCode,
          modelKey: faceForm.modelKey,
          resolution: faceForm.resolution,
          aspectRatio: faceForm.aspectRatio,
          faceLockRecord: {
            identityAnchors: faceForm.identityAnchors,
            allowedVariation: faceForm.allowedVariation,
            forbiddenDrift: faceForm.forbiddenDrift,
          },
          meta: { locale },
        }),
      })
      const payload = await response.json() as { data?: { batchId?: string }; error?: { message?: string; details?: { message?: string } } }
      if (!response.ok && response.status !== 207) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? t('workspace.face.generateFailed'))
        return
      }
      selectedFaceBatchIdRef.current = payload.data?.batchId ?? ''
      await loadWorkspace(projectId)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t('workspace.face.generateFailed'))
    } finally {
      setIsGeneratingFace(false)
    }
  }, [faceForm, form.characterCode, loadWorkspace, locale, projectId, t])

  const reviewFaceAsset = useCallback(async (candidateId: string, approved: boolean, rejectionNote?: string) => {
    if (!projectId) return
    const response = await fetch(`/api/visual-development/${projectId}/face-bible`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'asset-review', candidateId, approved, rejectionNote }),
    })
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } }
      window.alert(payload.error?.message ?? t('workspace.face.reviewFailed'))
      return
    }
    await loadWorkspace(projectId)
  }, [loadWorkspace, projectId, t])

  const lockFaceBible = useCallback(async () => {
    if (!projectId || !faceBatch) return
    const response = await fetch(`/api/visual-development/${projectId}/face-bible`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'face-bible-lock', batchId: faceBatch.id }),
    })
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } }
      window.alert(payload.error?.message ?? t('workspace.face.lockFailed'))
      return
    }
    await loadWorkspace(projectId)
  }, [faceBatch, loadWorkspace, projectId, t])

  const selectFaceBatch = useCallback((batchId: string) => {
    const selected = faceBatches.find((item) => item.id === batchId)
    if (!selected) return
    selectedFaceBatchIdRef.current = selected.id
    setFaceBatch(selected)
  }, [faceBatches])

  const selectHairExplorationBatch = useCallback((batchId: string) => {
    selectedHairExplorationBatchIdRef.current = batchId
    const selected = hairExplorationBatches.find((item) => item.id === batchId)
    if (!selected) return
    setHairExplorationBatch(selected)
  }, [hairExplorationBatches])

  const selectHairValidationBatch = useCallback((batchId: string) => {
    selectedHairValidationBatchIdRef.current = batchId
    const selected = hairValidationBatches.find((item) => item.id === batchId)
    if (!selected) return
    setHairValidationBatch(selected)
  }, [hairValidationBatches])

  const castingController = useMemo<CastingWorkspaceController>(() => ({
    ...candidateRegeneration,
    batch,
    batches: castingBatches,
    activeBatchId: batch?.id ?? '',
    form,
    worldStatus,
    imageModels: modelsQuery.data?.image ?? [],
    isGenerating,
    isLoading: isLoadingWorkspace || modelsQuery.isLoading,
    onFieldChange: updateField,
    onIdentityChange: updateIdentity,
    onOpenWorldBible: () => setActiveStageId('world'),
    onGenerate: () => void generateCasting(),
    onSelectBatch: selectCastingBatch,
    onCandidateAction: (candidateId, action, shortlisted) => void handleCandidateAction(candidateId, action, shortlisted),
  }), [batch, candidateRegeneration, castingBatches, form, generateCasting, handleCandidateAction, isGenerating, isLoadingWorkspace, modelsQuery.data?.image, modelsQuery.isLoading, selectCastingBatch, updateField, updateIdentity, worldStatus])

  const canonCandidate = useMemo<CastingCandidateView | null>(
    () => castingBatches.flatMap((castingBatch) => castingBatch.candidates)
      .find((candidate) => candidate.isCanon) ?? null,
    [castingBatches],
  )

  const faceBibleController = useMemo<FaceBibleWorkspaceController>(() => ({
    ...candidateRegeneration,
    batch: faceBatch,
    batches: faceBatches,
    activeBatchId: faceBatch?.id ?? '',
    canonCandidate,
    characterCode: form.characterCode,
    characterStatus,
    form: faceForm,
    imageModels: referenceImageModels,
    isGenerating: isGeneratingFace,
    isLoading: isLoadingWorkspace || modelsQuery.isLoading,
    onFieldChange: updateFaceField,
    onGenerate: () => void generateFaceBible(),
    onSelectBatch: selectFaceBatch,
    onReview: (candidateId, approved, rejectionNote) => void reviewFaceAsset(candidateId, approved, rejectionNote),
    onLock: () => void lockFaceBible(),
  }), [candidateRegeneration, canonCandidate, characterStatus, faceBatch, faceBatches, faceForm, form.characterCode, generateFaceBible, isGeneratingFace, isLoadingWorkspace, lockFaceBible, modelsQuery.isLoading, referenceImageModels, reviewFaceAsset, selectFaceBatch, updateFaceField])

  const worldBibleController = useWorldBibleController({
    projectId,
    locale,
    imageModels: modelsQuery.data?.image ?? [],
    onWorldChanged: () => void loadWorkspace(projectId),
  })

  const researchController = useResearchController({
    projectId,
    onResearchChanged: () => void worldBibleController.onReload(),
  })

  const scriptImportController = useScriptImportController({
    projectId,
    locale,
    llmModels: modelsQuery.data?.llm ?? [],
    onApplied: async () => {
      await Promise.all([loadWorkspace(projectId), worldBibleController.onReload()])
      setActiveStageId('research')
    },
  })

  const canonicalFaceBatch = faceBatches.find((candidateBatch) => (
    candidateBatch.id === form.characterDna.faceBibleBatchId
  )) ?? null

  const { controller: hairDesignController, activeBatch: activeHairBatch } = useHairDesignController({
    projectId,
    locale,
    characterCode: selectedCharacterCode,
    characterStatus,
    characterDna: form.characterDna,
    faceBatch: canonicalFaceBatch,
    explorationBatch: hairExplorationBatch,
    validationBatch: hairValidationBatch,
    explorationBatches: hairExplorationBatches,
    validationBatches: hairValidationBatches,
    onSelectExplorationBatch: selectHairExplorationBatch,
    onSelectValidationBatch: selectHairValidationBatch,
    imageModels: modelsQuery.data?.image ?? [],
    isLoading: isLoadingWorkspace || modelsQuery.isLoading,
    onRefresh: async () => loadWorkspace(projectId),
    candidateRegeneration,
  })

  const activeProductionStageId = (PRODUCTION_STAGE_IDS.includes(activeStageId as ProductionStageId)
    ? activeStageId
    : 'costume') as ProductionStageId
  const { controller: productionStageController, activeBatch: activeProductionBatch } = useProductionStageController({
    activeStageId: activeProductionStageId,
    projectId,
    locale,
    characterCode: selectedCharacterCode,
    characterStatus,
    characterDna: form.characterDna,
    batches: productionBatches,
    imageModels: modelsQuery.data?.image ?? [],
    videoModels: modelsQuery.data?.video ?? [],
    isLoading: isLoadingWorkspace || modelsQuery.isLoading,
    onRefresh: async () => loadWorkspace(projectId),
    candidateRegeneration,
  })

  const stages = useMemo<LocalizedDevelopmentStage[]>(
    () =>
      VISUAL_DEVELOPMENT_STAGES.map((stage) => ({
        ...stage,
        title: t(`stages.${stage.id}.title`),
        shortTitle: t(`stages.${stage.id}.shortTitle`),
        objective: t(`stages.${stage.id}.objective`),
        deliverables: toStringArray(t.raw(`stages.${stage.id}.deliverables`)),
        gate: t(`stages.${stage.id}.gate`),
      })),
    [t],
  )

  const activeStage = stages.find((stage) => stage.id === activeStageId) ?? stages[0]
  const activeStageIndex = stages.findIndex((stage) => stage.id === activeStage.id)
  const nextStage = activeStageIndex >= 0 ? stages[activeStageIndex + 1] ?? null : null

  return (
    <div className="kuiper-stage flex min-h-screen flex-col overflow-hidden text-text-primary xl:h-dvh xl:min-h-0">
      <VisualDevelopmentHeader locale={locale} projectId={projectId} projects={projects} characters={characters} characterCode={selectedCharacterCode} onProjectChange={changeProject} onCharacterChange={selectCharacter} onCreateProject={createProject} saveStatus={saveStatus} labels={{ back: t('header.back'), eyebrow: t('header.eyebrow'), system: t('header.system'), title: t('header.title'), project: t('header.project'), noProject: t('header.noProject'), character: t('header.character'), noCharacter: t('header.noCharacter'), preview: t('header.preview'), newProject: t('header.newProject'), projectName: t('header.projectName'), projectDescription: t('header.projectDescription'), create: t('header.create'), creating: t('header.creating'), cancel: t('header.cancel'), export: t('header.export'), exportCanon: t('header.exportCanon'), exportApproved: t('header.exportApproved'), exportFull: t('header.exportFull'), saving: t('header.saving'), saved: t('header.saved'), saveError: t('header.saveError') }} />

      <div className="grid min-h-0 flex-1 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_304px] xl:overflow-hidden">
        <DevelopmentRail
          activeStageId={activeStageId}
          groups={{
            foundation: t('rail.groups.foundation'),
            identity: t('rail.groups.identity'),
            design: t('rail.groups.design'),
            production: t('rail.groups.production'),
          }}
          locale={locale}
          onSelect={setActiveStageId}
          stages={stages}
          title={t('rail.title')}
        />

        <StageWorkspace
          scriptImportController={scriptImportController}
          researchController={researchController}
          worldBibleController={worldBibleController}
          castingController={castingController}
          faceBibleController={faceBibleController}
          hairDesignController={hairDesignController}
          productionStageController={productionStageController}
          candidateCount={candidateCount}
          characters={characters}
          characterCode={selectedCharacterCode}
          isLoadingCharacter={isLoadingWorkspace}
          onCharacterChange={selectCharacter}
          onCandidateCountChange={setCandidateCount}
          stage={activeStage}
          nextStage={nextStage}
          onStageSelect={setActiveStageId}
          translations={stageWorkspaceTranslations}
        />

        <DevelopmentInspector
          batch={activeStageId === 'face' ? faceBatch : activeStageId === 'hair' ? activeHairBatch : PRODUCTION_STAGE_IDS.includes(activeStageId as ProductionStageId) ? activeProductionBatch : batch}
          candidateCount={activeStageId === 'face' ? 10 : activeStageId === 'hair' && activeHairBatch?.stage === 'hair-validation' ? 8 : activeStageId === 'hair' ? 10 : PRODUCTION_STAGE_IDS.includes(activeStageId as ProductionStageId) ? (productionStageController.stage.variants.length === 8 ? 8 : 4) : candidateCount}
          worldReady={worldBibleController.status === 'world_locked'}
          characterReady={Boolean(form.characterName && form.characterDna.role && form.characterDna.coreTraits)}
          modelLabel={modelsQuery.data?.image.find((model) => model.value === (
            activeStageId === 'world'
              ? worldBibleController.form.modelKey
              : activeStageId === 'face'
              ? faceForm.modelKey
              : activeStageId === 'hair'
                ? hairDesignController.form.modelKey
                : PRODUCTION_STAGE_IDS.includes(activeStageId as ProductionStageId)
                  ? productionStageController.form.modelKey
                : form.modelKey
          ))?.label ?? null}
          labels={{
            title: t('inspector.title'),
            canon: t('inspector.canon'),
            promptStack: t('inspector.promptStack'),
            worldBible: t('inspector.worldBible'),
            characterDna: t('inspector.characterDna'),
            stageTemplate: t('inspector.stageTemplate'),
            modelAdapter: t('inspector.modelAdapter'),
            empty: t('inspector.empty'),
            loaded: t('inspector.loaded'),
            notConnected: t('inspector.notConnected'),
            seedRegistry: t('inspector.seedRegistry'),
            lockPolicy: t('inspector.lockPolicy'),
            lockPolicyDescription: t('inspector.lockPolicyDescription'),
            recordNotice: t('inspector.recordNotice'),
          }}
          stage={activeStage}
        />
      </div>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { usePlaygroundCostEstimate } from '@/lib/query/mutations/playground-mutations'
import {
  MAX_REFERENCE_IMAGES,
  TRACK_B_MODEL_RESOLUTIONS,
  TRACK_B_STANDARD_MODEL,
  isAllowedTrackBModel,
  type TrackBModelKey,
} from './lib/atlascloud-r2v-contract'
import { buildDepthRebuildPrompt } from './lib/depth-rebuild-prompt'
import {
  buildDepthRebuildFingerprint,
  depthRebuildDurationSeconds,
  fileToDepthRebuildFingerprint,
  getDepthRebuildPromptValidationError,
  getDepthRebuildValidationError,
} from './lib/depth-rebuild-workflow'
import { useDepthRebuildDescriptionAssist } from './useDepthRebuildDescriptionAssist'
import { useDepthRebuildGeneration } from './useDepthRebuildGeneration'
import { useDepthRebuildInputs } from './useDepthRebuildInputs'
import type {
  UseDepthRebuildOptions,
  UseDepthRebuildResult,
} from './depth-rebuild-assets'

export type {
  DepthGuideStageHandle,
  LocalDepthGuide,
  LocalDepthReferenceImage,
  DepthRebuildCharacterReference,
  DepthRebuildSceneReference,
  DepthRebuildResult,
  DepthGuideStatus,
  DepthRebuildGenerationStatus,
  UseDepthRebuildOptions,
  UseDepthRebuildResult,
} from './depth-rebuild-assets'

export function useDepthRebuild({
  userId,
  stageRef,
  metadata,
  videoHasAudio,
  locale = 'zh',
  workspaceId = null,
}: UseDepthRebuildOptions): UseDepthRebuildResult {
  const modelsQuery = useUserModels()
  const [error, setError] = useState<string | null>(null)
  const [modelKey, setModelKey] = useState<TrackBModelKey>(TRACK_B_STANDARD_MODEL)
  const [resolution, setResolution] = useState('720p')
  const [prompt, setPrompt] = useState('')
  const [promptFingerprint, setPromptFingerprint] = useState<string | null>(null)
  const descriptionAssistScope = workspaceId ?? [
    'source',
    metadata?.name ?? 'none',
    metadata?.duration ?? 0,
    metadata?.width ?? 0,
    metadata?.height ?? 0,
  ].join(':')
  const persistenceScope = [
    `user:${userId}`,
    `locale:${locale}`,
    descriptionAssistScope,
  ].join(':')
  const inputs = useDepthRebuildInputs({
    stageRef,
    metadata,
    videoHasAudio,
    onError: setError,
  })
  const descriptionAssist = useDepthRebuildDescriptionAssist({
    locale,
    scopeKey: persistenceScope,
    onError: setError,
  })

  const enabledModels = useMemo(() => (
    (modelsQuery.data?.video ?? [])
      .filter((model): model is typeof model & { value: TrackBModelKey } =>
        isAllowedTrackBModel(model.value))
      .map((model) => ({ value: model.value, label: model.label }))
  ), [modelsQuery.data?.video])
  const enabledModelKeys = useMemo(
    () => enabledModels.map((model) => model.value),
    [enabledModels],
  )
  const availableResolutions = TRACK_B_MODEL_RESOLUTIONS[modelKey]
  const outputDurationSeconds = useMemo(() => {
    if (!metadata) return null
    try {
      return depthRebuildDurationSeconds(metadata.duration)
    } catch {
      return null
    }
  }, [metadata])
  const costQuery = usePlaygroundCostEstimate({
    modelKey: outputDurationSeconds !== null && enabledModelKeys.includes(modelKey) ? modelKey : '',
    outputType: 'video',
    durationSec: outputDurationSeconds ?? undefined,
    resolution,
  })

  const currentFingerprint = useMemo(() => buildDepthRebuildFingerprint({
    sourceDurationSeconds: metadata?.duration ?? null,
    sourceWidth: metadata?.width ?? null,
    sourceHeight: metadata?.height ?? null,
    // Prompt 內容不依賴實際深度檔；先建立 Prompt、後產生或重產深度影片
    // 不應讓已檢查的角色／場景文字無故過期。
    depthGuide: null,
    characters: inputs.characters.map((character) => ({
      id: character.id,
      label: character.label,
      sourceBinding: character.sourceBinding,
      description: character.description,
      image: character.image
        ? fileToDepthRebuildFingerprint(character.image.file)
        : null,
    })),
    sceneReferences: inputs.sceneReferences.map((scene) => ({
      id: scene.id,
      note: scene.note,
      image: fileToDepthRebuildFingerprint(scene.image.file),
    })),
    sceneDescription: inputs.sceneDescription,
    modelKey,
    resolution,
    preserveSourceAudio: videoHasAudio === true,
  }), [
    metadata,
    inputs.characters,
    inputs.sceneReferences,
    inputs.sceneDescription,
    modelKey,
    resolution,
    videoHasAudio,
  ])
  const promptIsStale =
    promptFingerprint !== null && promptFingerprint !== currentFingerprint
  const promptValidationError = useMemo(() => getDepthRebuildPromptValidationError({
    sourceDurationSeconds: metadata?.duration ?? null,
    characters: inputs.characters.map((character) => ({
      label: character.label,
      sourceBinding: character.sourceBinding,
      description: character.description,
      imageExists: Boolean(character.image),
    })),
    sceneReferenceCount: inputs.sceneReferences.length,
    sceneDescription: inputs.sceneDescription,
  }), [
    metadata?.duration,
    inputs.characters,
    inputs.sceneReferences.length,
    inputs.sceneDescription,
  ])
  const workflowValidationError = useMemo(() => getDepthRebuildValidationError({
    sourceDurationSeconds: metadata?.duration ?? null,
    depthGuideExists: Boolean(inputs.depthGuide),
    depthGuideSufficient: inputs.depthGuide?.sufficient === true,
    characters: inputs.characters.map((character) => ({
      label: character.label,
      sourceBinding: character.sourceBinding,
      description: character.description,
      imageExists: Boolean(character.image),
    })),
    sceneReferenceCount: inputs.sceneReferences.length,
    sceneDescription: inputs.sceneDescription,
    modelKey,
    resolution,
    enabledModelKeys,
    prompt,
    promptIsFresh: promptFingerprint === currentFingerprint,
  }), [
    metadata?.duration,
    inputs.depthGuide,
    inputs.characters,
    inputs.sceneReferences.length,
    inputs.sceneDescription,
    modelKey,
    resolution,
    enabledModelKeys,
    prompt,
    promptFingerprint,
    currentFingerprint,
  ])
  const validationError = modelsQuery.isLoading
    ? '模型清單尚未載入完成'
    : modelsQuery.isError
      ? '模型清單讀取失敗，無法確認 AtlasCloud Seedance 2.0 是否已啟用'
      : workflowValidationError
        ? workflowValidationError
        : costQuery.isLoading
          ? '正在取得本次生成費用'
          : costQuery.isError
            ? '估價失敗，請勿在價格未知時送出'
            : costQuery.data?.amountUsd === null || costQuery.data === undefined
              ? '目前無法取得本次生成費用，已停止送出'
              : null

  const generation = useDepthRebuildGeneration({
    persistenceScopeKey: persistenceScope,
    metadata,
    videoHasAudio,
    workspaceId,
    depthGuide: inputs.depthGuide,
    characters: inputs.characters,
    sceneReferences: inputs.sceneReferences,
    prompt,
    modelKey,
    resolution,
    validationError,
    onError: setError,
  })
  const descriptionAssistBusy = descriptionAssist.target !== null
  const isBusy = inputs.depthBusy || generation.generationBusy || descriptionAssistBusy
  const canGenerate = generation.canResume
    || (
      generation.submittedRunId === null
      && validationError === null
      && !isBusy
    )

  function buildPrompt(): void {
    if (promptValidationError) {
      setError(promptValidationError)
      return
    }
    if (!metadata) {
      setError('請先上傳原始表演影片')
      return
    }
    try {
      const nextPrompt = buildDepthRebuildPrompt({
        durationSeconds: metadata.duration,
        characters: inputs.characters.map((character) => ({
          label: character.label,
          sourceBinding: character.sourceBinding,
          description: character.description,
        })),
        sceneReferences: inputs.sceneReferences.map((scene) => ({ note: scene.note })),
        sceneDescription: inputs.sceneDescription,
        preserveSourceAudio: videoHasAudio === true,
      })
      setPrompt(nextPrompt)
      setPromptFingerprint(currentFingerprint)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Prompt 建立失敗')
    }
  }

  async function assistCharacterDescription(characterId: string): Promise<void> {
    const character = inputs.characters.find((entry) => entry.id === characterId)
    if (!character) return
    const description = await descriptionAssist.assistCharacter(characterId, character.brief)
    if (description) inputs.setCharacterDescription(characterId, description)
  }

  async function assistSceneDescription(): Promise<void> {
    const description = await descriptionAssist.assistScene(inputs.sceneBrief)
    if (description) inputs.setSceneDescription(description)
  }

  function resetSource(): void {
    inputs.resetDepthSource()
    setPrompt('')
    setPromptFingerprint(null)
    generation.resetResult()
    setError(null)
  }

  async function generateDepthGuide(): Promise<void> {
    generation.resetResult()
    await inputs.generateDepthGuide()
  }

  function resetGenerationResult(): void {
    generation.resetResult()
    setError(null)
  }

  return {
    depthGuide: inputs.depthGuide,
    depthGuideStatus: inputs.depthGuideStatus,
    depthGuideProgress: inputs.depthGuideProgress,
    characters: inputs.characters,
    sceneReferences: inputs.sceneReferences,
    sceneBrief: inputs.sceneBrief,
    sceneDescription: inputs.sceneDescription,
    referenceImageCount: inputs.referenceImageCount,
    maxReferenceImages: MAX_REFERENCE_IMAGES,
    descriptionAssistTarget: descriptionAssist.target,
    modelKey,
    enabledModels,
    enabledModelsLoading: modelsQuery.isLoading,
    enabledModelsError: modelsQuery.isError ? '模型清單讀取失敗' : null,
    resolution,
    availableResolutions,
    prompt,
    promptIsStale,
    promptValidationError,
    validationError,
    canGenerate,
    costEstimate: costQuery.data ?? null,
    costEstimateLoading: costQuery.isLoading,
    costEstimateError: costQuery.isError ? '估價失敗，請勿在價格未知時送出' : null,
    generationStatus: generation.generationStatus,
    generationProgress: generation.generationProgress,
    submittedRunId: generation.submittedRunId,
    canResume: generation.canResume,
    result: generation.result,
    error,
    isBusy,
    addCharacter: inputs.addCharacter,
    removeCharacter: inputs.removeCharacter,
    setCharacterLabel: inputs.setCharacterLabel,
    setCharacterSourceBinding: inputs.setCharacterSourceBinding,
    setCharacterBrief: inputs.setCharacterBrief,
    setCharacterDescription: inputs.setCharacterDescription,
    selectCharacterImage: inputs.selectCharacterImage,
    rejectCharacterImage: inputs.rejectCharacterImage,
    clearCharacterImage: inputs.clearCharacterImage,
    addSceneImages: inputs.addSceneImages,
    removeSceneImage: inputs.removeSceneImage,
    rejectSceneImage: inputs.rejectSceneImage,
    setSceneReferenceNote: inputs.setSceneReferenceNote,
    setSceneBrief: inputs.setSceneBrief,
    setSceneDescription: inputs.setSceneDescription,
    assistCharacterDescription,
    assistSceneDescription,
    setModelKey,
    setResolution,
    setPrompt,
    generateDepthGuide,
    cancelDepthGuide: inputs.cancelDepthGuide,
    clearDepthGuide: inputs.clearDepthGuide,
    buildPrompt,
    generate: generation.generate,
    resetSource,
    resetResult: resetGenerationResult,
  }
}

'use client'

import { useMemo, useState } from 'react'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { usePlaygroundCostEstimate } from '@/lib/query/mutations/playground-mutations'
import {
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
  getDepthRebuildValidationError,
} from './lib/depth-rebuild-workflow'
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
  DepthRebuildResult,
  DepthGuideStatus,
  DepthRebuildGenerationStatus,
  UseDepthRebuildOptions,
  UseDepthRebuildResult,
} from './depth-rebuild-assets'

export function useDepthRebuild({
  stageRef,
  metadata,
  videoHasAudio,
  workspaceId = null,
}: UseDepthRebuildOptions): UseDepthRebuildResult {
  const modelsQuery = useUserModels()
  const [error, setError] = useState<string | null>(null)
  const [modelKey, setModelKey] = useState<TrackBModelKey>(TRACK_B_STANDARD_MODEL)
  const [resolution, setResolution] = useState('720p')
  const [prompt, setPrompt] = useState('')
  const [promptFingerprint, setPromptFingerprint] = useState<string | null>(null)
  const inputs = useDepthRebuildInputs({
    stageRef,
    metadata,
    videoHasAudio,
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
    depthGuide: inputs.depthGuide
      ? fileToDepthRebuildFingerprint(inputs.depthGuide.file)
      : null,
    characterImage: inputs.characterImage
      ? fileToDepthRebuildFingerprint(inputs.characterImage.file)
      : null,
    sceneImage: inputs.sceneImage
      ? fileToDepthRebuildFingerprint(inputs.sceneImage.file)
      : null,
    characterDescription: inputs.characterDescription,
    sceneDescription: inputs.sceneDescription,
    modelKey,
    resolution,
    preserveSourceAudio: videoHasAudio === true,
  }), [
    metadata,
    inputs.depthGuide,
    inputs.characterImage,
    inputs.sceneImage,
    inputs.characterDescription,
    inputs.sceneDescription,
    modelKey,
    resolution,
    videoHasAudio,
  ])
  const promptIsStale =
    promptFingerprint !== null && promptFingerprint !== currentFingerprint
  const workflowValidationError = useMemo(() => getDepthRebuildValidationError({
    sourceDurationSeconds: metadata?.duration ?? null,
    depthGuideExists: Boolean(inputs.depthGuide),
    depthGuideSufficient: inputs.depthGuide?.sufficient === true,
    characterImageExists: Boolean(inputs.characterImage),
    sceneImageExists: Boolean(inputs.sceneImage),
    characterDescription: inputs.characterDescription,
    sceneDescription: inputs.sceneDescription,
    modelKey,
    resolution,
    enabledModelKeys,
    prompt,
    promptIsFresh: promptFingerprint === currentFingerprint,
  }), [
    metadata?.duration,
    inputs.depthGuide,
    inputs.characterImage,
    inputs.sceneImage,
    inputs.characterDescription,
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
    metadata,
    videoHasAudio,
    workspaceId,
    depthGuide: inputs.depthGuide,
    characterImage: inputs.characterImage,
    sceneImage: inputs.sceneImage,
    prompt,
    modelKey,
    resolution,
    validationError,
    onError: setError,
  })
  const isBusy = inputs.depthBusy || generation.generationBusy
  const canGenerate = generation.canResume
    || (
      generation.submittedRunId === null
      && validationError === null
      && !isBusy
    )

  function buildPrompt(): void {
    if (!metadata) {
      setError('請先上傳原始表演影片')
      return
    }
    if (!inputs.characterImage) {
      setError('請先上傳新角色圖片')
      return
    }
    try {
      const nextPrompt = buildDepthRebuildPrompt({
        durationSeconds: metadata.duration,
        characterDescription: inputs.characterDescription,
        sceneDescription: inputs.sceneDescription,
        hasSceneImage: Boolean(inputs.sceneImage),
        preserveSourceAudio: videoHasAudio === true,
      })
      setPrompt(nextPrompt)
      setPromptFingerprint(currentFingerprint)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Prompt 建立失敗')
    }
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
    characterImage: inputs.characterImage,
    sceneImage: inputs.sceneImage,
    characterDescription: inputs.characterDescription,
    sceneDescription: inputs.sceneDescription,
    modelKey,
    enabledModels,
    enabledModelsLoading: modelsQuery.isLoading,
    enabledModelsError: modelsQuery.isError ? '模型清單讀取失敗' : null,
    resolution,
    availableResolutions,
    prompt,
    promptIsStale,
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
    setCharacterDescription: inputs.setCharacterDescription,
    setSceneDescription: inputs.setSceneDescription,
    setModelKey,
    setResolution,
    setPrompt,
    selectCharacterImage: inputs.selectCharacterImage,
    rejectCharacterImage: inputs.rejectCharacterImage,
    clearCharacterImage: inputs.clearCharacterImage,
    selectSceneImage: inputs.selectSceneImage,
    rejectSceneImage: inputs.rejectSceneImage,
    clearSceneImage: inputs.clearSceneImage,
    generateDepthGuide,
    cancelDepthGuide: inputs.cancelDepthGuide,
    clearDepthGuide: inputs.clearDepthGuide,
    buildPrompt,
    generate: generation.generate,
    resetSource,
    resetResult: resetGenerationResult,
  }
}

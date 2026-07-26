'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { usePlaygroundCostEstimate } from '@/lib/query/mutations/playground-mutations'
import {
  MAX_REFERENCE_IMAGES,
  TRACK_B_MODEL_RESOLUTIONS,
  TRACK_B_STANDARD_MODEL,
  isAllowedTrackBModel,
  type TrackBModelKey,
} from './lib/atlascloud-r2v-contract'
import { buildAdaptiveDepthRebuildPrompt } from './lib/depth-rebuild-prompt'
import {
  DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
  createDepthRebuildMotionContract,
  type CameraDirection,
  type FramingCrop,
  type SubjectMotionDirection,
} from './lib/depth-rebuild-motion-contract'
import { buildDepthRebuildGuidePlan } from './lib/depth-rebuild-guide-plan'
import {
  buildDepthRebuildFingerprint,
  DEPTH_GUIDE_REQUIRED_MESSAGE,
  fileToDepthRebuildFingerprint,
  getDepthRebuildPromptValidationError,
  getDepthRebuildValidationError,
  type DepthRebuildValidationInput,
} from './lib/depth-rebuild-workflow'
import { useDepthRebuildDescriptionAssist } from './useDepthRebuildDescriptionAssist'
import { useDepthRebuildGeneration } from './useDepthRebuildGeneration'
import { useDepthRebuildInputs } from './useDepthRebuildInputs'
import type {
  UseDepthRebuildOptions,
  UseDepthRebuildResult,
} from './depth-rebuild-assets'
import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'

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
  sourceVideoFile = null,
  sourceVideoStorageKey = null,
  videoHasAudio,
  locale = 'zh',
  workspaceId = null,
}: UseDepthRebuildOptions): UseDepthRebuildResult {
  const modelsQuery = useUserModels()
  const [error, setError] = useState<string | null>(null)
  const [modelKey, setModelKey] = useState<TrackBModelKey>(TRACK_B_STANDARD_MODEL)
  const [resolution, setResolution] = useState('720p')
  const [sourceAudioMode, setSourceAudioModeState] = useState<SourceAudioMode>(
    videoHasAudio === true ? 'preserve' : 'generate',
  )
  const sourceAudioModeWasChosenRef = useRef(false)
  const [prompt, setPrompt] = useState('')
  const [segmentPrompts, setSegmentPrompts] = useState<readonly string[]>([])
  const [promptFingerprint, setPromptFingerprint] = useState<string | null>(null)
  const [criticalCenterSeconds, setCriticalCenterSecondsState] = useState(
    () => metadata?.duration ? metadata.duration / 2 : 0,
  )
  const [motionSettings, setMotionSettings] = useState(() => ({
    ...DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
  }))
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
  useEffect(() => {
    setCriticalCenterSecondsState(metadata?.duration ? metadata.duration / 2 : 0)
  }, [metadata?.duration, metadata?.height, metadata?.name, metadata?.width])

  const guidePlan = useMemo(() => {
    if (!metadata) return null
    try {
      return buildDepthRebuildGuidePlan(metadata.duration, {
        criticalCenterSeconds: Math.min(
          Math.max(criticalCenterSeconds, 0),
          metadata.duration,
        ),
      })
    } catch {
      return null
    }
  }, [criticalCenterSeconds, metadata])
  const segmentCount = guidePlan ? 1 : 0
  const maxUserReferenceImages = MAX_REFERENCE_IMAGES
  const inputs = useDepthRebuildInputs({
    stageRef,
    metadata,
    videoHasAudio,
    maxReferenceImages: maxUserReferenceImages,
    onError: setError,
  })
  const descriptionAssist = useDepthRebuildDescriptionAssist({
    locale,
    scopeKey: persistenceScope,
    onError: setError,
  })

  useEffect(() => {
    const characterIds = new Set(inputs.characters.map((character) => character.id))
    setMotionSettings((current) => {
      const gazeSourceCharacterId = current.gazeSourceCharacterId
        && characterIds.has(current.gazeSourceCharacterId)
        ? current.gazeSourceCharacterId
        : null
      const gazeTargetCharacterId = gazeSourceCharacterId
        && current.gazeTargetCharacterId
        && characterIds.has(current.gazeTargetCharacterId)
        && current.gazeTargetCharacterId !== gazeSourceCharacterId
        ? current.gazeTargetCharacterId
        : null
      if (
        gazeSourceCharacterId === current.gazeSourceCharacterId
        && gazeTargetCharacterId === current.gazeTargetCharacterId
      ) {
        return current
      }
      return { ...current, gazeSourceCharacterId, gazeTargetCharacterId }
    })
  }, [inputs.characters])

  useEffect(() => {
    if (sourceAudioModeWasChosenRef.current || videoHasAudio === null) return
    setSourceAudioModeState(videoHasAudio ? 'preserve' : 'generate')
  }, [videoHasAudio])

  function setSourceAudioMode(value: SourceAudioMode): void {
    sourceAudioModeWasChosenRef.current = true
    setSourceAudioModeState(value)
  }

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
  const outputDurationSeconds = guidePlan?.outputDurationSeconds ?? null
  const segmentSummary = guidePlan
    ? `單次生成 ${guidePlan.outputDurationSeconds} 秒，完成後裁回 ${guidePlan.sourceDurationSeconds.toFixed(1)} 秒`
    : '尚未建立合法引導計畫'
  const costQuery = usePlaygroundCostEstimate({
    modelKey: outputDurationSeconds !== null && enabledModelKeys.includes(modelKey) ? modelKey : '',
    outputType: 'video',
    durationSec: outputDurationSeconds ?? undefined,
    resolution,
    count: 1,
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
    sourceAudioMode,
    motionSettings,
    criticalCenterSeconds,
  }), [
    metadata,
    inputs.characters,
    inputs.sceneReferences,
    inputs.sceneDescription,
    modelKey,
    resolution,
    sourceAudioMode,
    motionSettings,
    criticalCenterSeconds,
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
    reservedReferenceImageCount: 0,
    sceneDescription: inputs.sceneDescription,
  }), [
    metadata?.duration,
    inputs.characters,
    inputs.sceneReferences.length,
    inputs.sceneDescription,
  ])
  const validationInputBase = useMemo<Omit<
    DepthRebuildValidationInput,
    'depthGuideExists' | 'depthGuideSufficient'
  >>(() => ({
    sourceDurationSeconds: metadata?.duration ?? null,
    sourceVideoAvailable: Boolean(sourceVideoFile || sourceVideoStorageKey),
    characters: inputs.characters.map((character) => ({
      label: character.label,
      sourceBinding: character.sourceBinding,
      description: character.description,
      imageExists: Boolean(character.image),
    })),
    sceneReferenceCount: inputs.sceneReferences.length,
    reservedReferenceImageCount: 0,
    sceneDescription: inputs.sceneDescription,
    modelKey,
    resolution,
    enabledModelKeys,
    sourceAudioMode,
    sourceAudioDetected: videoHasAudio,
    prompt,
    segmentPromptCount: segmentPrompts.length,
    promptIsFresh: promptFingerprint === currentFingerprint,
    criticalCenterSeconds,
  }), [
    metadata?.duration,
    sourceVideoFile,
    sourceVideoStorageKey,
    inputs.characters,
    inputs.sceneReferences.length,
    inputs.sceneDescription,
    modelKey,
    resolution,
    enabledModelKeys,
    sourceAudioMode,
    videoHasAudio,
    prompt,
    segmentPrompts.length,
    promptFingerprint,
    currentFingerprint,
    criticalCenterSeconds,
  ])
  const workflowValidationError = useMemo(() => getDepthRebuildValidationError({
    ...validationInputBase,
    depthGuideExists: Boolean(inputs.depthGuide),
    depthGuideSufficient: inputs.depthGuide?.sufficient === true,
  }), [inputs.depthGuide, validationInputBase])
  const workflowValidationAfterDepthError = useMemo(() => getDepthRebuildValidationError({
    ...validationInputBase,
    depthGuideExists: true,
    depthGuideSufficient: true,
  }), [validationInputBase])

  function resolveSubmissionValidationError(workflowError: string | null): string | null {
    if (modelsQuery.isLoading) return '模型清單尚未載入完成'
    if (modelsQuery.isError) {
      return '模型清單讀取失敗，無法確認 AtlasCloud Seedance 2.0 是否已啟用'
    }
    if (workflowError) return workflowError
    if (costQuery.isLoading) return '正在取得本次生成費用'
    if (costQuery.isError) return '估價失敗，請勿在價格未知時送出'
    if (costQuery.data?.amountUsd === null || costQuery.data === undefined) {
      return '目前無法取得本次生成費用，已停止送出'
    }
    return null
  }

  const validationError = resolveSubmissionValidationError(workflowValidationError)
  const validationAfterDepthError = resolveSubmissionValidationError(
    workflowValidationAfterDepthError,
  )

  const generation = useDepthRebuildGeneration({
    persistenceScopeKey: persistenceScope,
    metadata,
    sourceVideoFile,
    sourceVideoStorageKey,
    sourceAudioMode,
    workspaceId,
    depthGuide: inputs.depthGuide,
    characters: inputs.characters,
    sceneReferences: inputs.sceneReferences,
    guidePlan,
    segmentPrompts,
    modelKey,
    resolution,
    validationError,
    onError: setError,
  })
  const descriptionAssistBusy = descriptionAssist.target !== null
  const isBusy = inputs.depthBusy || generation.generationBusy || descriptionAssistBusy
  const willPrepareDepthGuide = Boolean(
    !generation.canResume
    && generation.submittedRunId === null
    && !inputs.depthGuide
    && workflowValidationError === DEPTH_GUIDE_REQUIRED_MESSAGE
    && validationAfterDepthError === null
  )
  const canGenerate = generation.canResume
    || (
      generation.submittedRunId === null
      && !isBusy
      && (validationError === null || willPrepareDepthGuide)
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
    if (!guidePlan) {
      setError('目前秒數無法建立合法的自適應 Depth 引導計畫；原片需介於 4–15 秒')
      return
    }
    try {
      const nextPrompt = buildAdaptiveDepthRebuildPrompt({
        guidePlan,
        characters: inputs.characters.map((character) => ({
          label: character.label,
          sourceBinding: character.sourceBinding,
          description: character.description,
        })),
        sceneReferences: inputs.sceneReferences.map((scene) => ({ note: scene.note })),
        sceneDescription: inputs.sceneDescription,
        sourceAudioMode,
        motionContract: createDepthRebuildMotionContract({
          durationSeconds: guidePlan.sourceDurationSeconds,
          characters: inputs.characters.map((character) => ({
            id: character.id,
            label: character.label,
            sourceBinding: character.sourceBinding,
          })),
          settings: motionSettings,
        }),
      })
      setSegmentPrompts([nextPrompt])
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
    sourceAudioModeWasChosenRef.current = false
    setSourceAudioModeState('generate')
    setMotionSettings({ ...DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS })
    setCriticalCenterSecondsState(0)
    setPrompt('')
    setSegmentPrompts([])
    setPromptFingerprint(null)
    generation.resetResult()
    setError(null)
  }

  async function generateDepthGuide(): Promise<void> {
    generation.resetResult()
    await inputs.generateDepthGuide()
  }

  async function generate(): Promise<UseDepthRebuildResult['result']> {
    if (generation.canResume || inputs.depthGuide) {
      return generation.generate()
    }
    if (!willPrepareDepthGuide) {
      setError(validationError ?? '目前的設定還不能送出')
      return null
    }

    generation.resetResult()
    const preparedDepthGuide = await inputs.generateDepthGuide()
    if (!preparedDepthGuide) return null

    const preparedValidationError = resolveSubmissionValidationError(
      getDepthRebuildValidationError({
        ...validationInputBase,
        depthGuideExists: true,
        depthGuideSufficient: preparedDepthGuide.sufficient,
      }),
    )
    if (preparedValidationError) {
      setError(preparedValidationError)
      return null
    }
    return generation.generate({
      depthGuideOverride: preparedDepthGuide,
      validationErrorOverride: null,
    })
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
    maxReferenceImages: maxUserReferenceImages,
    descriptionAssistTarget: descriptionAssist.target,
    modelKey,
    enabledModels,
    enabledModelsLoading: modelsQuery.isLoading,
    enabledModelsError: modelsQuery.isError ? '模型清單讀取失敗' : null,
    resolution,
    availableResolutions,
    sourceAudioMode,
    sourceAudioDetected: videoHasAudio,
    motionSettings,
    guidePlan,
    criticalCenterSeconds,
    segmentCount,
    segmentSummary,
    prompt,
    promptIsStale,
    promptValidationError,
    validationError,
    willPrepareDepthGuide,
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
    setSourceAudioMode,
    setCameraDirection: (value: CameraDirection) => {
      setMotionSettings((current) => ({ ...current, cameraDirection: value }))
    },
    setFramingCrop: (value: FramingCrop) => {
      setMotionSettings((current) => ({ ...current, framingCrop: value }))
    },
    setSubjectDirection: (value: SubjectMotionDirection) => {
      setMotionSettings((current) => ({ ...current, subjectDirection: value }))
    },
    setSingleTake: (value: boolean) => {
      setMotionSettings((current) => ({ ...current, singleTake: value }))
    },
    setLockFraming: (value: boolean) => {
      setMotionSettings((current) => ({ ...current, lockFraming: value }))
    },
    setNoDirectionReversal: (value: boolean) => {
      setMotionSettings((current) => ({ ...current, noDirectionReversal: value }))
    },
    setGazeSourceCharacterId: (value: string | null) => {
      setMotionSettings((current) => ({
        ...current,
        gazeSourceCharacterId: value,
        gazeTargetCharacterId: value === null || value === current.gazeTargetCharacterId
          ? null
          : current.gazeTargetCharacterId,
      }))
    },
    setGazeTargetCharacterId: (value: string | null) => {
      setMotionSettings((current) => ({
        ...current,
        gazeTargetCharacterId: current.gazeSourceCharacterId !== null
          && value !== current.gazeSourceCharacterId
          ? value
          : null,
      }))
    },
    setInteractionDescription: (value: string) => {
      setMotionSettings((current) => ({ ...current, interactionDescription: value }))
    },
    setCriticalCenterSeconds: (value: number) => {
      if (!metadata || !Number.isFinite(value)) return
      setCriticalCenterSecondsState(Math.min(Math.max(value, 0), metadata.duration))
    },
    setPrompt,
    generateDepthGuide,
    cancelDepthGuide: inputs.cancelDepthGuide,
    clearDepthGuide: inputs.clearDepthGuide,
    buildPrompt,
    generate,
    resetSource,
    resetResult: resetGenerationResult,
  }
}

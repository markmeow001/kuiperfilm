'use client'

import { DepthRebuildPanel } from './DepthRebuildPanel'
import type { VideoMetadata } from './live-composite-types'
import type { UseDepthRebuildResult } from './useDepthRebuild'
import { isAllowedTrackBModel } from './lib/atlascloud-r2v-contract'

interface DepthRebuildControlsProps {
  controller: UseDepthRebuildResult
  metadata: VideoMetadata | null
  interactionDisabled: boolean
  onVideoSelect: (file: File) => void
}

function progressFraction(controller: UseDepthRebuildResult): number | null {
  const progress = controller.depthGuideProgress
  if (!progress) return null
  if (progress.phase === 'analyzing') {
    return 0.75 * (progress.totalFrames > 0 ? progress.completedFrames / progress.totalFrames : 0)
  }
  return 0.75 + 0.25 * (progress.duration > 0 ? progress.currentTime / progress.duration : 0)
}

function estimatedCostLabel(controller: UseDepthRebuildResult): string {
  if (controller.costEstimateLoading) return '計算中…'
  if (controller.costEstimateError) return '無法估價'
  if (controller.costEstimate?.amountUsd === null || controller.costEstimate === null) {
    return '完成設定後顯示'
  }
  return `US$${controller.costEstimate.amountUsd.toFixed(4)}`
}

export function DepthRebuildControls({
  controller,
  metadata,
  interactionDisabled,
  onVideoSelect,
}: DepthRebuildControlsProps) {
  const generating = controller.generationStatus === 'uploading'
    || controller.generationStatus === 'submitting'
    || controller.generationStatus === 'generating'

  return (
    <DepthRebuildPanel
      source={metadata ? {
        name: metadata.name,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
      } : null}
      depthGuide={controller.depthGuide ? {
        url: controller.depthGuide.previewUrl,
        effectiveFps: controller.depthGuide.effectiveDepthFps,
        sufficient: controller.depthGuide.sufficient,
      } : null}
      depthProgress={progressFraction(controller)}
      depthBusy={controller.depthGuideStatus === 'generating'}
      characters={controller.characters.map((character) => ({
        id: character.id,
        label: character.label,
        sourceBinding: character.sourceBinding,
        brief: character.brief,
        description: character.description,
        reference: character.image ? {
          url: character.image.previewUrl,
          name: character.image.file.name,
        } : null,
      }))}
      sceneReferences={controller.sceneReferences.map((scene) => ({
        id: scene.id,
        note: scene.note,
        reference: {
          url: scene.image.previewUrl,
          name: scene.image.file.name,
        },
      }))}
      sceneBrief={controller.sceneBrief}
      sceneDescription={controller.sceneDescription}
      referenceImageCount={controller.referenceImageCount}
      maxReferenceImages={controller.maxReferenceImages}
      descriptionAssistTarget={controller.descriptionAssistTarget}
      modelOptions={controller.enabledModels}
      modelKey={controller.modelKey}
      resolutionOptions={controller.availableResolutions.map((value) => ({ value, label: value }))}
      resolution={controller.resolution}
      sourceAudioMode={controller.sourceAudioMode}
      sourceAudioDetected={controller.sourceAudioDetected}
      motionSettings={controller.motionSettings}
      guidePlan={controller.guidePlan}
      criticalCenterSeconds={controller.criticalCenterSeconds}
      segmentCount={controller.segmentCount}
      segmentSummary={controller.segmentSummary}
      prompt={controller.prompt}
      promptStale={controller.promptIsStale}
      promptBlockingMessage={controller.promptValidationError}
      generating={generating}
      interactionDisabled={interactionDisabled}
      canGenerate={controller.canGenerate}
      estimatedCostLabel={controller.submittedRunId ? '已送出，不重複計費' : estimatedCostLabel(controller)}
      errorMessage={controller.error}
      blockingMessage={metadata && !controller.submittedRunId ? controller.validationError : null}
      submittedRunId={controller.submittedRunId}
      canResume={controller.canResume}
      hasResult={Boolean(controller.result)}
      onVideoSelect={onVideoSelect}
      onCreateDepthGuide={() => void controller.generateDepthGuide()}
      onCancelDepthGuide={controller.cancelDepthGuide}
      onAddCharacter={controller.addCharacter}
      onRemoveCharacter={controller.removeCharacter}
      onCharacterSelect={controller.selectCharacterImage}
      onCharacterPreviewError={controller.rejectCharacterImage}
      onRemoveCharacterImage={controller.clearCharacterImage}
      onCharacterLabelChange={controller.setCharacterLabel}
      onCharacterSourceBindingChange={controller.setCharacterSourceBinding}
      onCharacterBriefChange={controller.setCharacterBrief}
      onCharacterDescriptionChange={controller.setCharacterDescription}
      onAssistCharacter={(characterId) => void controller.assistCharacterDescription(characterId)}
      onAddSceneImages={controller.addSceneImages}
      onRemoveSceneImage={controller.removeSceneImage}
      onScenePreviewError={controller.rejectSceneImage}
      onSceneNoteChange={controller.setSceneReferenceNote}
      onSceneBriefChange={controller.setSceneBrief}
      onSceneDescriptionChange={controller.setSceneDescription}
      onAssistScene={() => void controller.assistSceneDescription()}
      onModelChange={(value) => {
        if (isAllowedTrackBModel(value)) controller.setModelKey(value)
      }}
      onResolutionChange={controller.setResolution}
      onSourceAudioModeChange={controller.setSourceAudioMode}
      onCameraDirectionChange={controller.setCameraDirection}
      onFramingCropChange={controller.setFramingCrop}
      onSubjectDirectionChange={controller.setSubjectDirection}
      onSingleTakeChange={controller.setSingleTake}
      onLockFramingChange={controller.setLockFraming}
      onNoDirectionReversalChange={controller.setNoDirectionReversal}
      onGazeSourceCharacterIdChange={controller.setGazeSourceCharacterId}
      onGazeTargetCharacterIdChange={controller.setGazeTargetCharacterId}
      onInteractionDescriptionChange={controller.setInteractionDescription}
      onCriticalCenterChange={controller.setCriticalCenterSeconds}
      onBuildPrompt={controller.buildPrompt}
      onGenerate={() => void controller.generate()}
      onResetSubmittedRun={controller.resetResult}
    />
  )
}

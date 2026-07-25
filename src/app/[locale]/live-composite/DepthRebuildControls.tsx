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
      characterReference={controller.characterImage ? {
        url: controller.characterImage.previewUrl,
        name: controller.characterImage.file.name,
      } : null}
      sceneReference={controller.sceneImage ? {
        url: controller.sceneImage.previewUrl,
        name: controller.sceneImage.file.name,
      } : null}
      characterDescription={controller.characterDescription}
      sceneDescription={controller.sceneDescription}
      modelOptions={controller.enabledModels}
      modelKey={controller.modelKey}
      resolutionOptions={controller.availableResolutions.map((value) => ({ value, label: value }))}
      resolution={controller.resolution}
      prompt={controller.prompt}
      promptStale={controller.promptIsStale}
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
      onCharacterSelect={controller.selectCharacterImage}
      onCharacterPreviewError={controller.rejectCharacterImage}
      onSceneSelect={controller.selectSceneImage}
      onScenePreviewError={controller.rejectSceneImage}
      onRemoveCharacter={controller.clearCharacterImage}
      onRemoveScene={controller.clearSceneImage}
      onCharacterDescriptionChange={controller.setCharacterDescription}
      onSceneDescriptionChange={controller.setSceneDescription}
      onModelChange={(value) => {
        if (isAllowedTrackBModel(value)) controller.setModelKey(value)
      }}
      onResolutionChange={controller.setResolution}
      onBuildPrompt={controller.buildPrompt}
      onGenerate={() => void controller.generate()}
      onResetSubmittedRun={controller.resetResult}
    />
  )
}

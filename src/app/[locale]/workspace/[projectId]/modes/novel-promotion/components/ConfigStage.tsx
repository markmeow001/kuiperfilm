'use client'

import { useParams } from 'next/navigation'
import NovelInputStage from './NovelInputStage'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import { StyleProfilePanel } from '../../../components/StyleProfilePanel'

export default function ConfigStage() {
  const runtime = useWorkspaceStageRuntime()
  const { episodeName, novelText } = useWorkspaceEpisodeStageData()
  const params = useParams()
  const projectId = typeof params?.projectId === 'string' ? params.projectId : null

  return (
    <div className="space-y-6">
      <NovelInputStage
        novelText={novelText}
        episodeName={episodeName}
        onNovelTextChange={runtime.onNovelTextChange}
        isSubmittingTask={runtime.isSubmittingTTS}
        isSwitchingStage={runtime.isTransitioning}
        videoRatio={runtime.videoRatio ?? undefined}
        targetDuration={runtime.targetDuration}
        onVideoRatioChange={runtime.onVideoRatioChange}
        onTargetDurationChange={runtime.onTargetDurationChange}
        onNext={runtime.onRunStoryToScript}
      />

      {/* Phase 11.5 — Project 级 styleProfile 编辑面板（GET endpoint prefill） */}
      {projectId ? <StyleProfilePanel projectId={projectId} /> : null}
    </div>
  )
}

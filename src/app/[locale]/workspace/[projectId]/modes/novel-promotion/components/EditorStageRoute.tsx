'use client'

import { useEffect, useState } from 'react'
import { VideoEditorStage } from '@/features/video-editor/components/VideoEditorStage'
import { createProjectFromPanels } from '@/features/video-editor/hooks/useEditorActions'
import type { VideoEditorProject } from '@/features/video-editor/types/editor.types'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import { useWorkspaceProvider } from '../WorkspaceProvider'

export default function EditorStageRoute() {
  const runtime = useWorkspaceStageRuntime()
  const { projectId, episodeId } = useWorkspaceProvider()
  const { storyboards } = useWorkspaceEpisodeStageData()

  const [initialProject, setInitialProject] = useState<VideoEditorProject | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!episodeId) return

    const eid = episodeId
    let cancelled = false

    function buildFromPanels() {
      const panels = storyboards.flatMap((sb) =>
        (sb.panels || []).map((panel, idx) => ({
          id: panel.id,
          panelIndex: idx,
          storyboardId: sb.id,
          videoUrl: panel.videoUrl || undefined,
          description: panel.description || undefined,
          duration: panel.duration || undefined,
        }))
      )
      return createProjectFromPanels(eid, panels)
    }

    async function loadOrCreate() {
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/editor?episodeId=${eid}`)
        if (res.ok) {
          const data = await res.json()
          if (data.projectData && !cancelled) {
            setInitialProject(data.projectData)
            setLoading(false)
            return
          }
        }

        if (!cancelled) {
          setInitialProject(buildFromPanels())
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setInitialProject(buildFromPanels())
          setLoading(false)
        }
      }
    }

    loadOrCreate()
    return () => { cancelled = true }
  }, [projectId, episodeId, storyboards])

  if (!episodeId) return null
  if (loading) return null

  return (
    <VideoEditorStage
      projectId={projectId}
      episodeId={episodeId}
      initialProject={initialProject}
      onBack={() => runtime.onStageChange('videos')}
    />
  )
}

'use client'

import { useState, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import EpisodeList, { type EpisodeWithProgress } from './EpisodeList'
import ProjectSettings from './ProjectSettings'
import { SettingsModal } from '@/components/ui/ConfigModals'
import type { Project } from '@/types/project'
import type { CapabilitySelections } from '@/lib/model-config-contract'
import { useUserModels } from '@/lib/query/hooks/useUserModels'

/**
 * Phase 11.1: Dashboard 「劇 → 集」第一公民化的 Overview 子畫面
 *
 * 包：EpisodeList（集卡片網格）+ ProjectSettings（唯讀區塊 + Settings Modal 觸發）
 * 透過 React Query 拉 `/episodes`（含 progress + thumbnail）。
 */

interface EpisodeApiPayload {
  id: string
  episodeNumber: number
  name: string
  description: string | null
  progress?: {
    scriptDone: number
    scriptTotal: number
    storyboardDone: number
    storyboardTotal: number
    videoDone: number
    videoTotal: number
  }
  thumbnailUrl?: string | null
}

export interface OverviewViewProps {
  projectId: string
  project: Project
  onEpisodeOpen: (episodeId: string) => void
  onEpisodeCreate: () => Promise<void> | void
  onEpisodeRename: (episodeId: string, newName: string) => Promise<void>
  onEpisodeDelete: (episodeId: string) => Promise<void>
  onUpdateConfig: (key: string, value: unknown) => Promise<void>
}

function parseReferenceImageCount(json: string | null | undefined): number {
  if (!json) return 0
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr.length : 0
  } catch {
    return 0
  }
}

export default function OverviewView({
  projectId,
  project,
  onEpisodeOpen,
  onEpisodeCreate,
  onEpisodeRename,
  onEpisodeDelete,
  onUpdateConfig,
}: OverviewViewProps) {
  const t = useTranslations('workspaceDetail')
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  const { data: episodesData, isLoading: episodesLoading } = useQuery({
    queryKey: queryKeys.project.episodes(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes`)
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || 'Failed to load episodes')
      }
      const json = await res.json()
      return (json.episodes ?? []) as EpisodeApiPayload[]
    },
    staleTime: 5_000,
  })

  const episodes: EpisodeWithProgress[] = useMemo(() => {
    if (!episodesData) return []
    return episodesData.map((ep) => ({
      id: ep.id,
      episodeNumber: ep.episodeNumber,
      name: ep.name,
      description: ep.description,
      progress: ep.progress ?? {
        scriptDone: 0,
        scriptTotal: 0,
        storyboardDone: 0,
        storyboardTotal: 0,
        videoDone: 0,
        videoTotal: 0,
      },
      thumbnailUrl: ep.thumbnailUrl ?? null,
    }))
  }, [episodesData])

  const npd = project.novelPromotionData

  const characterCount = npd?.characters?.length ?? 0
  const locationCount = npd?.locations?.length ?? 0

  const styleProfileSummary = useMemo(() => {
    const positive = npd?.stylePositivePrompt
    const negative = npd?.styleNegativePrompt
    const refImages = parseReferenceImageCount(npd?.styleReferenceImages ?? null)
    const isCustom =
      Boolean((positive && positive.trim().length > 0) ||
        (negative && negative.trim().length > 0) ||
        refImages > 0)
    return { isCustom, referenceImageCount: refImages }
  }, [npd?.stylePositivePrompt, npd?.styleNegativePrompt, npd?.styleReferenceImages])

  const userModels = useUserModels()

  // Capability overrides 可能是 string / object / null — 需要正規化
  const capabilityOverrides: CapabilitySelections = useMemo(() => {
    const raw = npd?.capabilityOverrides
    if (!raw) return {}
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return (parsed && typeof parsed === 'object') ? parsed as CapabilitySelections : {}
      } catch {
        return {}
      }
    }
    return raw as CapabilitySelections
  }, [npd?.capabilityOverrides])

  const handleCreate = useCallback(() => {
    void onEpisodeCreate()
  }, [onEpisodeCreate])

  if (!npd) {
    return (
      <div className="text-center text-[var(--glass-text-secondary)] py-12">
        {t('projectNotFound')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <EpisodeList
        projectName={project.name}
        episodes={episodes}
        characterCount={characterCount}
        locationCount={locationCount}
        onEpisodeOpen={onEpisodeOpen}
        onEpisodeCreate={handleCreate}
        onEpisodeRename={onEpisodeRename}
        onEpisodeDelete={onEpisodeDelete}
        onOpenProjectSettings={() => setIsSettingsModalOpen(true)}
      />

      <ProjectSettings
        videoRatio={npd.videoRatio}
        targetDuration={npd.targetDuration}
        ttsRate={npd.ttsRate}
        models={{
          analysis: npd.analysisModel ?? null,
          character: npd.characterModel ?? null,
          location: npd.locationModel ?? null,
          storyboard: npd.storyboardModel ?? null,
          edit: npd.editModel ?? null,
          video: npd.videoModel ?? null,
        }}
        styleProfileSummary={styleProfileSummary}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        availableModels={userModels.data || undefined}
        modelsLoaded={!userModels.isLoading}
        analysisModel={npd.analysisModel ?? undefined}
        characterModel={npd.characterModel ?? undefined}
        locationModel={npd.locationModel ?? undefined}
        imageModel={npd.storyboardModel ?? undefined}
        editModel={npd.editModel ?? undefined}
        videoModel={npd.videoModel ?? undefined}
        videoRatio={npd.videoRatio ?? undefined}
        targetDuration={npd.targetDuration ?? undefined}
        capabilityOverrides={capabilityOverrides}
        ttsRate={npd.ttsRate ?? undefined}
        onAnalysisModelChange={(value) => { void onUpdateConfig('analysisModel', value) }}
        onCharacterModelChange={(value) => { void onUpdateConfig('characterModel', value) }}
        onLocationModelChange={(value) => { void onUpdateConfig('locationModel', value) }}
        onImageModelChange={(value) => { void onUpdateConfig('storyboardModel', value) }}
        onEditModelChange={(value) => { void onUpdateConfig('editModel', value) }}
        onVideoModelChange={(value) => { void onUpdateConfig('videoModel', value) }}
        onVideoRatioChange={(value) => { void onUpdateConfig('videoRatio', value) }}
        onTargetDurationChange={(value) => { void onUpdateConfig('targetDuration', value) }}
        onCapabilityOverridesChange={(value) => { void onUpdateConfig('capabilityOverrides', value) }}
        onTTSRateChange={(value) => { void onUpdateConfig('ttsRate', value) }}
      />

      {episodesLoading && episodes.length === 0 && (
        <div className="text-center text-[var(--glass-text-tertiary)] py-4 text-sm">
          {/* loading hint shown only on first fetch */}
        </div>
      )}
    </div>
  )
}

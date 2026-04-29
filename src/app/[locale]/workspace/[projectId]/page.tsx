'use client'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

import { useCallback, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { useProjectData, useEpisodeData } from '@/lib/query/hooks'
import { queryKeys } from '@/lib/query/keys'
import NovelPromotionWorkspace from './modes/novel-promotion/NovelPromotionWorkspace'
import SmartImportWizard, { SplitEpisode } from './modes/novel-promotion/components/SmartImportWizard'
import OverviewView from './components/OverviewView'
import ProjectAssets from './components/ProjectAssets'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { resolveSelectedEpisodeId } from './episode-selection'

// 有效的stage值
const VALID_STAGES = ['config', 'script', 'assets', 'text-storyboard', 'storyboard', 'videos', 'voice', 'editor'] as const
type Stage = typeof VALID_STAGES[number]

// Phase 11.1: view enum，將 dashboard / 集 / 全局資產 變第一公民
// Phase 11.2: 'assets' view 加入（project-level 跨集角色/場景）
const VALID_VIEWS = ['overview', 'episode', 'global-assets', 'assets'] as const
type ViewMode = typeof VALID_VIEWS[number]

interface Episode {
  id: string
  episodeNumber: number
  name: string
  description?: string | null
  novelText?: string | null
  audioUrl?: string | null
  srtContent?: string | null
  createdAt: string
}

type NovelPromotionData = {
  episodes?: Episode[]
  importStatus?: string
}

/**
 * 项目详情页 - 带侧边栏的剧集管理
 *
 * Phase 11.1:
 * - 新增 ?view= 參數（overview | episode | global-assets）
 * - 預設 view=overview，**完全停止「自動跳第一集」**（Q-4 A）
 * - 切集時 stage 不重置（Q-2 B）
 */
export default function ProjectDetailPage() {
  const params = useParams<{ projectId?: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  if (!params?.projectId) {
    throw new Error('ProjectDetailPage requires projectId route param')
  }
  if (!searchParams) {
    throw new Error('ProjectDetailPage requires searchParams')
  }
  const projectId = params.projectId
  const t = useTranslations('workspaceDetail')
  const tc = useTranslations('common')

  // 从URL读取参数
  const urlStage = searchParams.get('stage') as Stage | null
  const urlEpisodeId = searchParams.get('episode') ?? null
  const urlView = searchParams.get('view') as ViewMode | null
  const currentUrlStage = urlStage && VALID_STAGES.includes(urlStage) ? urlStage : null
  const effectiveView: ViewMode = urlView && VALID_VIEWS.includes(urlView) ? urlView : 'overview'

  // 🔥 React Query 数据获取
  const queryClient = useQueryClient()
  const { data: project, isLoading: loading, error: projectError } = useProjectData(projectId)
  const error = projectError?.message || null

  // 更新URL参数（stage / episode / view）
  const updateUrlParams = useCallback((updates: { stage?: string; episode?: string | null; view?: ViewMode | null }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (updates.stage !== undefined) {
      params.set('stage', updates.stage)
    }
    if (updates.episode !== undefined) {
      if (updates.episode) {
        params.set('episode', updates.episode)
      } else {
        params.delete('episode')
      }
    }
    if (updates.view !== undefined) {
      if (updates.view) {
        params.set('view', updates.view)
      } else {
        params.delete('view')
      }
    }
    router.replace(`/workspace/${projectId}?${params.toString()}`, { scroll: false })
  }, [router, projectId, searchParams])

  // 更新URL中的stage参数（保持向后兼容）
  const updateUrlStage = useCallback((stage: string) => {
    updateUrlParams({ stage })
  }, [updateUrlParams])

  // Stage 状态完全由 URL 控制
  // 如果 URL 没有 stage 参数，默认使用 'config'
  // 🚧 剪辑阶段 (editor) 暂时禁用，自动重定向到成片阶段 (videos)
  const effectiveStage = currentUrlStage === 'editor' ? 'videos' : (currentUrlStage || 'config')

  // 获取剧集列表
  const novelPromotionData = project?.novelPromotionData as NovelPromotionData | undefined
  const episodes = useMemo<Episode[]>(() => {
    const getNum = (name: string) => { const m = name.match(/\d+/); return m ? parseInt(m[0], 10) : Infinity }
    return [...(novelPromotionData?.episodes ?? [])].sort((a, b) => {
      const diff = getNum(a.name) - getNum(b.name)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh')
    })
  }, [novelPromotionData?.episodes])

  // Phase 11.1: 只在「有 episode URL」時計算 selectedEpisodeId（避免 fallback 到第一集）
  // Q-4 A：URL 沒有 episode → 不挑、不自動跳
  const selectedEpisodeId = useMemo(
    () => (urlEpisodeId ? resolveSelectedEpisodeId(episodes, urlEpisodeId) : null),
    [episodes, urlEpisodeId],
  )

  // 🔥 使用 React Query 获取剧集数据（只在 episode view 拉）
  const isEpisodeView = effectiveView === 'episode'
  const { data: currentEpisode } = useEpisodeData(
    projectId,
    isEpisodeView ? selectedEpisodeId : null,
  )

  // 获取导入状态
  const importStatus = novelPromotionData?.importStatus

  // 检测是否需要显示导入向导：无剧集或导入中
  const isZeroState = episodes.length === 0
  const shouldShowImportWizard = isZeroState || importStatus === 'pending'

  // Q-4 A: 不再自動跳第一集
  // 之前的 useEffect (line 122-129) 在 URL 沒 episode 時會自動寫第一集 ID 進 URL，
  // 現在拿掉 — overview view 是預設行為。

  // 创建剧集
  const handleCreateEpisode = useCallback(async (name: string, description?: string) => {
    const res = await fetch(`/api/novel-promotion/${projectId}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || t('createFailed'))
    }

    const data = await res.json()
    // 🔥 刷新项目数据获取新的剧集列表
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.project.episodes(projectId) })
    // 自动切换到新创建的剧集（episode view）
    updateUrlParams({ view: 'episode', episode: data.episode.id })
  }, [projectId, queryClient, t, updateUrlParams])

  // 智能导入 - 完成后刷新数据（数据已由 SmartImportWizard 保存）
  const handleSmartImportComplete = async (splitEpisodes: SplitEpisode[], triggerGlobalAnalysis?: boolean) => {
    _ulogInfo('[Page] handleSmartImportComplete 被调用，triggerGlobalAnalysis:', triggerGlobalAnalysis)

    try {
      // 🔥 刷新项目数据
      queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.project.episodes(projectId) })

      // 刷新后重新获取最新的剧集列表
      const res = await fetch(`/api/projects/${projectId}/data`)
      const data = await res.json()
      // API 返回结构是 { project: { novelPromotionData: { episodes: [...] } } }
      const newEpisodes = data?.project?.novelPromotionData?.episodes || []
      _ulogInfo('[Page] 获取到新剧集:', newEpisodes.length, '个')

      // 如果有剧集，进入第一个
      if (newEpisodes.length > 0) {
        // 如果需要触发全局分析，切换到 assets 阶段并带上参数
        if (triggerGlobalAnalysis) {
          _ulogInfo('[Page] 触发全局分析，跳转到 assets 阶段，带 globalAnalyze=1 参数')
          // 使用相对路径更新，保留 locale
          const params = new URLSearchParams()
          params.set('view', 'episode')
          params.set('stage', 'assets')
          params.set('episode', newEpisodes[0].id)
          params.set('globalAnalyze', '1')
          const newUrl = `?${params.toString()}`
          _ulogInfo('[Page] 跳转到:', newUrl)
          router.replace(newUrl, { scroll: false })
        } else {
          _ulogInfo('[Page] 不触发全局分析，跳到 overview view')
          // Phase 11.1: 預設進 overview，讓使用者看「劇 → 集」dashboard
          updateUrlParams({ view: 'overview', episode: null })
        }
      }
    } catch (err: unknown) {
      _ulogError('刷新失败:', err)
    }
  }

  // 重命名剧集
  const handleRenameEpisode = useCallback(async (episodeId: string, newName: string) => {
    const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${episodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    })

    if (!res.ok) {
      throw new Error(t('renameFailed'))
    }

    // 🔥 刷新项目数据
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.project.episodes(projectId) })
    // 剧集详情也刷新
    if (selectedEpisodeId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, selectedEpisodeId) })
    }
  }, [projectId, queryClient, selectedEpisodeId, t])

  // 删除剧集
  const handleDeleteEpisode = useCallback(async (episodeId: string) => {
    const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${episodeId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      throw new Error(t('deleteFailed'))
    }
    // 刷新项目数据
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.project.episodes(projectId) })
    // 如果删除的是当前正在查看的剧集，回 overview（Q-4 A：不自動跳下一集）
    if (episodeId === selectedEpisodeId) {
      updateUrlParams({ view: 'overview', episode: null })
    }
  }, [projectId, queryClient, selectedEpisodeId, t, updateUrlParams])

  // 进入某集（從 overview / tab 點選）— Q-2 B：保留當前 stage
  const handleEpisodeOpen = useCallback((episodeId: string) => {
    updateUrlParams({ view: 'episode', episode: episodeId })
  }, [updateUrlParams])

  // 选择剧集（Tab Bar 切集）— Q-2 B：URL stage 不變，只換 episode
  const handleEpisodeSelect = useCallback((episodeId: string) => {
    updateUrlParams({ view: 'episode', episode: episodeId })
  }, [updateUrlParams])

  // 项目设定更新（Settings Modal 的 callback）
  const handleUpdateConfig = useCallback(async (key: string, value: unknown) => {
    const res = await fetch(`/api/novel-promotion/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to update project config')
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
  }, [projectId, queryClient])

  // Loading状态：等待项目数据
  // Phase 11.1: episode view 才需要等 currentEpisode；overview / global-assets 不需要
  const isInitializing = loading ||
    (isEpisodeView && !shouldShowImportWizard && episodes.length > 0 && (!selectedEpisodeId || !currentEpisode)) ||
    (project && !project.novelPromotionData)
  const initLoadingState = resolveTaskPresentationState({
    phase: 'processing',
    intent: 'generate',
    resource: 'text',
    hasOutput: false,
  })

  if (isInitializing) {
    return (
      <div className="glass-page min-h-screen">
        <Navbar />
        <main className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-[var(--glass-text-secondary)]">{tc('loading')}</div>
        </main>
      </div>
    )
  }

  // Error状态
  if (error || !project) {
    return (
      <div className="glass-page min-h-screen">
        <Navbar />
        <main className="container mx-auto px-4 py-8">
          <div className="glass-surface p-6 text-center">
            <p className="text-[var(--glass-tone-danger-fg)] mb-4">{error || t('projectNotFound')}</p>
            <button
              onClick={() => router.push('/workspace')}
              className="glass-btn-base glass-btn-primary px-6 py-2"
            >
              {t('backToWorkspace')}
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="glass-page min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 py-8">
          {shouldShowImportWizard ? (
            // 零状态或导入中：显示智能导入向导
            <SmartImportWizard
              projectId={projectId}
              onManualCreate={() => handleCreateEpisode(`${t('episode')} 1`)}
              onImportComplete={handleSmartImportComplete}
              importStatus={importStatus}
            />
          ) : effectiveView === 'global-assets' && project.novelPromotionData ? (
            // 全局资产视图
            <div>
              <h1 className="text-2xl font-bold text-[var(--glass-text-primary)] mb-6">{t('globalAssets')}</h1>
              <NovelPromotionWorkspace
                project={project}
                projectId={projectId}
                viewMode="global-assets"
                urlStage={effectiveStage}
                onStageChange={updateUrlStage}
              />
            </div>
          ) : effectiveView === 'assets' ? (
            // Phase 11.2: project-level 跨集角色/場景管理
            <ProjectAssets projectId={projectId} />
          ) : effectiveView === 'episode' && selectedEpisodeId && currentEpisode ? (
            // 剧集工作区
            <NovelPromotionWorkspace
              project={project}
              projectId={projectId}
              episodeId={selectedEpisodeId}
              episode={currentEpisode}
              viewMode="episode"
              urlStage={effectiveStage}
              onStageChange={updateUrlStage}
              episodes={episodes}
              onEpisodeSelect={handleEpisodeSelect}
              onEpisodeCreate={() => handleCreateEpisode(`${t('episode')} ${episodes.length + 1}`)}
              onEpisodeRename={handleRenameEpisode}
              onEpisodeDelete={handleDeleteEpisode}
            />
          ) : effectiveView === 'episode' ? (
            // episode view 但無 currentEpisode（loading 或 ID 不存在）
            <div className="glass-surface p-8 text-center">
              <div className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                <TaskStatusInline state={initLoadingState} className="[&>span]:sr-only" />
              </div>
              <h2 className="text-xl font-semibold text-[var(--glass-text-secondary)] mb-2">{tc('loading')}</h2>
            </div>
          ) : (
            // 預設 overview：劇本管理 dashboard
            <OverviewView
              projectId={projectId}
              project={project}
              onEpisodeOpen={handleEpisodeOpen}
              onEpisodeCreate={() => handleCreateEpisode(`${t('episode')} ${episodes.length + 1}`)}
              onEpisodeRename={handleRenameEpisode}
              onEpisodeDelete={handleDeleteEpisode}
              onUpdateConfig={handleUpdateConfig}
            />
          )}
        </div>
      </main>
    </div>
  )
}

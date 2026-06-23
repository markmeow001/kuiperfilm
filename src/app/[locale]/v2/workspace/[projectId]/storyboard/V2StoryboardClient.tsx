'use client'

/**
 * Phase 12.5.1 — v2 StoryboardPage minimum viable 3-column layout.
 *
 * Top: horizontal panel strip (click to select).
 * Below split into 3 columns:
 *   Left   prompt builder (camera angle / shot size / movement / quality words)
 *   Center selected panel preview + actions
 *   Right  inspector (cast / audio / notes)
 *
 * 12.5.2 will add the "Kling 智能多鏡頭" CTA + auto-grouping.
 * Read-only for now — clicking panels just changes the selection.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { VideoModelPickerInline } from './VideoModelPickerInline'
import { getVideoModelVariant, isMultiShotCapable } from '@/lib/video-models/variants'
import { videoModelToleratesTextOnlyPanels } from '@/lib/video-models/multi-shot-text-only'
import { resolveGenerationModeBehavior } from '@/lib/novel-promotion/generation-mode'
import {
  useStoryboards,
  useUpdatePanelText,
  useGenerateVideo,
} from '@/lib/query/hooks/useStoryboards'
import {
  useRegenerateProjectPanelImage,
  useUpdateProjectPanel,
  useCreateProjectPanel,
  useCreateProjectStoryboardGroup,
} from '@/lib/query/mutations/storyboard-panel-mutations'
import { useAutoGroupMultiShot } from '@/lib/query/mutations/auto-group-multi-shot-mutation'
import { useTaskSnapshot, useActiveTasks, useTaskList } from '@/lib/query/hooks/useTaskStatus'
import { useProjectAssets } from '@/lib/query/hooks/useProjectAssets'
import { useEpisodeCharacterBindings } from '@/lib/query/mutations/episode-character-binding-mutations'
import { queryKeys } from '@/lib/query/keys'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { V2StoryboardGroupsView } from './V2StoryboardGroupsView'
import { V2StoryboardGalleryView } from './V2StoryboardGalleryView'
import { V2StoryboardTimelineView } from './V2StoryboardTimelineView'
import { V2ManualPanelModal, type ManualPanelDraft } from './V2ManualPanelModal'
import { StaleStoryboardCleanupModal } from './StaleStoryboardCleanupModal'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { PromptChipGroup } from './PromptChipGroup'
import {
  KLING_GROUP_SIZE,
  GROUP_ACCENTS,
  aspectClassFromRatio,
  accentForGroupId,
  chunk,
  type PanelLike,
  type StoryboardLike,
  type ProjectLikeFull,
  type MultiShotState,
  type AnalyzeState,
  type MediaDisplayMode,
} from './storyboard-client-helpers'

interface V2StoryboardClientProps {
  projectId: string
}

export function V2StoryboardClient({ projectId }: V2StoryboardClientProps) {
  const t = useTranslations('v2Storyboard')
  const queryClient = useQueryClient()
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLikeFull | undefined
  // Phase 12.5 — viewer-role users see disabled mutation buttons across
  // the storyboard page + per-group cards (passed via GroupCard prop).
  const { canEdit } = useProjectAccess(projectId)
  const viewerTip = canEdit ? undefined : t('viewerHint')
  const projectVideoRatio = project?.novelPromotionData?.videoRatio ?? '16:9'
  // 2026-05-22 — project-level resolution choice (480p / 720p / 1080p).
  // Threaded into every multi-shot dispatch so ARK Seedance 2.0 worker
  // honors user pick instead of always defaulting to 720p. taijiai /
  // atlascloud / fal Seedance routes ignore this (their model id bakes
  // resolution).
  const projectVideoResolution = (project?.novelPromotionData?.videoResolution ?? '720p') as '480p' | '720p' | '1080p'
  const aspectClass = aspectClassFromRatio(projectVideoRatio)
  const projectVideoModel = project?.novelPromotionData?.videoModel ?? ''
  // 2026-05-29 — per-project generation mode behavior (auto-chain, picker filter).
  const modeBehavior = resolveGenerationModeBehavior(project?.novelPromotionData?.generationMode)
  // 2026-05-17 — Derived from variant registry. Drives multi-shot button
  // disable + tooltip; null/unknown ids fail closed.
  const canMultiShot = isMultiShotCapable(projectVideoModel)
  // 2026-05-17 — Family-aware labels: Kling = batch multi-shot (N stitched
  // clips), Seedance composite = single video with 9-ref content[] @N. The
  // CTA wording must match what the worker actually produces or the user
  // sees one composite mp4 after expecting N clips (or vice versa).
  const videoFamily = getVideoModelVariant(projectVideoModel)?.family ?? null
  // Heuristic for thumb sizing: portrait projects (9:16, 3:4, 2:3) get
  // a taller-narrower thumb; landscape stays compact-wide. Without this
  // 9:16 thumbs at h-24 fixed-height end up only ~54px wide — readable
  // but cramped to the point of unusable.
  const isPortraitRatio = (() => {
    const [w, h] = projectVideoRatio.split(':').map((n) => Number.parseFloat(n))
    return Number.isFinite(w) && Number.isFinite(h) && h > w
  })()
  const thumbHeightClass = isPortraitRatio ? 'h-40' : 'h-24'
  // Episode picked via the V2WorkspaceShell tab bar (URL ?episode=<id>);
  // falls back to first episode when none is selected.
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)

  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined
  const projectAssetsQuery = useProjectAssets(projectId)
  const characterRoster = projectAssetsQuery.data?.characters ?? []
  const locationRoster = projectAssetsQuery.data?.locations ?? []
  // Phase 11.4 — per-episode character appearance bindings. Lets the
  // CAST chip in the inspector show which appearance the worker would
  // actually use when generating panels for THIS episode (instead of
  // the user having to navigate back to the subjects page to verify).
  const episodeBindingsQuery = useEpisodeCharacterBindings(projectId, currentEpisodeId)
  const episodeBindings = episodeBindingsQuery.data ?? []
  const regenPanel = useRegenerateProjectPanelImage(projectId)
  const updatePanel = useUpdateProjectPanel(projectId)
  const updatePanelText = useUpdatePanelText(projectId, currentEpisodeId)
  const generateVideo = useGenerateVideo(projectId, currentEpisodeId)
  const autoGroup = useAutoGroupMultiShot(projectId)
  const createPanel = useCreateProjectPanel(projectId)
  const createStoryboardGroup = useCreateProjectStoryboardGroup(projectId)

  // 手動新增分鏡 (Phase 1 of B 組 free-prompt workflow):
  // open via the toolbar button, submit creates panel + auto-triggers
  // image gen. State is intentionally local — only one modal at a time.
  const [manualPanelOpen, setManualPanelOpen] = useState(false)
  const [manualPanelSubmitting, setManualPanelSubmitting] = useState(false)
  // 2026-05-13 — stale storyboard cleanup modal. Lets the user nuke a
  // single storyboard (and all its panels) when a partial re-analyze
  // left old panels in the DB. See StaleStoryboardCleanupModal.
  const [staleCleanupOpen, setStaleCleanupOpen] = useState(false)

  // 2026-06-02 — native-audio on/off for multi-shot video. Default on.
  // Lets the user turn audio off when a provider's audio moderation
  // false-flags Seedance's native audio and blocks the whole clip.
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [multiShotState, setMultiShotState] = useState<MultiShotState>({ status: 'idle' })
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>({ status: 'idle' })
  // 2026-05-13 — Selected Shot 圖/視頻顯示切換。
  // 以前 render 只看 videoUrl 有無 → 一旦 panel 跑過 B 路徑就只能看視頻、
  // 看不回原圖（user 報「無法切回去圖」）。改成 per-panel override：
  // - 沒紀錄 → auto（有 video 顯示 video，否則顯示 image，等同舊行為）
  // - user 點 toggle → 紀錄 'image' / 'video'，下次選回同個 panel 還記得
  // MediaDisplayMode imported from storyboard-client-helpers (Phase 1 step 4 prep).
  const [mediaDisplayOverride, setMediaDisplayOverride] = useState<Record<string, MediaDisplayMode>>({})
  // Lightbox: when set, render a full-screen overlay of this URL. Lets
  // the timeline-view Selected Shot stay tile-sized (matching the
  // multi-shot 9:16 player on the right) while preserving zoom-in for
  // detail inspection.
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null)
  // Batch-generate progress state. Exposed to the user via toolbar
  // status pills so they know N panels are being processed without
  // having to scroll the strip and watch each thumbnail's overlay.
  const [batchImageState, setBatchImageState] = useState<{ submitted: number; total: number } | null>(null)
  const [batchVideoState, setBatchVideoState] = useState<{ submitted: number; total: number } | null>(null)

  // Stage 1 chip-rail bookkeeping. We persist the most-recent
  // multi-shot taskId per groupId so the chip rail survives page
  // refresh without re-running the worker. Storage key includes
  // projectId+episodeId so different episodes don't smear into each
  // other's bindings.
  const taskByGroupStorageKey = currentEpisodeId
    ? `multi-shot-task-by-group:${projectId}:${currentEpisodeId}`
    : null
  const [taskByGroup, setTaskByGroup] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined' || !taskByGroupStorageKey) return {}
    try {
      const raw = window.localStorage.getItem(taskByGroupStorageKey)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    } catch {
      return {}
    }
  })
  // Reload bookkeeping when the active episode changes — different
  // episodes have different group IDs and tasks.
  useEffect(() => {
    if (typeof window === 'undefined' || !taskByGroupStorageKey) {
      setTaskByGroup({})
      return
    }
    try {
      const raw = window.localStorage.getItem(taskByGroupStorageKey)
      if (!raw) {
        setTaskByGroup({})
        return
      }
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setTaskByGroup({})
        return
      }
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v
      }
      setTaskByGroup(out)
    } catch {
      setTaskByGroup({})
    }
  }, [taskByGroupStorageKey])
  useEffect(() => {
    if (typeof window === 'undefined' || !taskByGroupStorageKey) return
    try {
      window.localStorage.setItem(taskByGroupStorageKey, JSON.stringify(taskByGroup))
    } catch {
      // Quota error or private mode; ignore — bookkeeping is best-effort.
    }
  }, [taskByGroup, taskByGroupStorageKey])

  // Phase V (2026-05-28) — fetch server-side groupId → taskId map and
  // merge into taskByGroup so cross-user viewers (admin / workspace
  // teammate) can see the project owner's generated videos on first
  // visit. localStorage on its own only carries entries for tasks the
  // viewer's own browser submitted — for a teammate's project that's
  // always empty, so without this fetch every group reads as 「尚未生成」
  // regardless of how many videos the owner has actually rendered.
  //
  // Merge policy: server fills MISSING entries only. localStorage wins
  // for groups the viewer has just submitted in this session so the
  // chip rail's optimistic update doesn't get overwritten by a stale
  // server snapshot.
  useEffect(() => {
    if (!currentEpisodeId || !projectId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/novel-promotion/${projectId}/episodes/${currentEpisodeId}/multi-shot-tasks-by-group`,
        )
        if (!res.ok) return
        const body = (await res.json()) as { tasksByGroup?: Record<string, string> }
        const fromServer = body.tasksByGroup ?? {}
        if (cancelled) return
        setTaskByGroup((prev) => {
          const merged = { ...prev }
          let touched = false
          for (const [groupId, taskId] of Object.entries(fromServer)) {
            if (!merged[groupId]) {
              merged[groupId] = taskId
              touched = true
            }
          }
          return touched ? merged : prev
        })
      } catch {
        // Best-effort. Falls back to localStorage-only behavior.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, currentEpisodeId])

  // Layout mode toggle — three modes:
  //   gallery  — V3 portrait grid + right-side detail (image-driven)
  //   timeline — V4 horizontal strip + 3-col body  (image-driven)
  //   groups   — Phase 12.5.4 group-card stack     (text-driven Kling B-path)
  //
  // Persisted in localStorage so the user's choice sticks across
  // navigation. Default is gallery per user decision 「V3變成主板」,
  // but a smarter default kicks in below for B-path video models.
  const [layoutMode, setLayoutMode] = useState<'gallery' | 'timeline' | 'groups'>(() => {
    if (typeof window === 'undefined') return 'gallery'
    const stored = window.localStorage.getItem('v2-storyboard-layout')
    if (stored === 'timeline' || stored === 'groups') return stored
    return 'gallery'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('v2-storyboard-layout', layoutMode)
  }, [layoutMode])

  // Smart default: if videoModel is a Kling-3 / Omni / O1 (B-path
  // text-to-video), and the user hasn't explicitly stored a layout
  // preference, switch to 'groups' on first render. We only do this
  // BEFORE any user interaction — once the user picks a mode, that
  // localStorage entry locks the choice. MUST sit above all early
  // returns so hooks call order stays stable across renders.
  const isBPathModel = /^tencent-vod::Kling-(3|O1)/i.test(projectVideoModel)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem('v2-storyboard-layout')
    if (stored) return
    if (isBPathModel) setLayoutMode('groups')
  }, [isBPathModel])

  // Server-side task snapshot for script_to_storyboard_run, scoped to the
  // current episode. Survives navigation and is the source of truth for
  // the analyze status banner — same pattern as V2SubjectsClient.
  const analyzeSnapshot = useTaskSnapshot({
    projectId,
    targetType: currentEpisodeId ? 'NovelPromotionEpisode' : null,
    targetId: currentEpisodeId,
    type: ['script_to_storyboard_run'],
    enabled: Boolean(currentEpisodeId),
  })
  const analyzeStatus = analyzeSnapshot.data?.status ?? null
  const analyzeProgress = analyzeSnapshot.data?.progress ?? 0
  const isAnalyzing = analyzeStatus === 'queued' || analyzeStatus === 'processing'
  // Unified state for the 重新分析 button / banner. Covers the click → worker-
  // surfaces gap (analyzeState.status) AND the worker progress phase
  // (analyzeStatus from the snapshot poll). Without this, the user clicks
  // 重新分析 and sees no progress for the 2-8s before polling first surfaces
  // the queued task — they think the click was lost.
  const analyzePhase: 'idle' | 'submitting' | 'queued' | 'processing' | 'done' =
    analyzeState.status === 'submitting'
      ? 'submitting'
      : analyzeState.status === 'submitted' && !isAnalyzing
        ? 'queued' // submitted to API, worker hasn't surfaced yet
        : analyzeStatus === 'queued'
          ? 'queued'
          : analyzeStatus === 'processing'
            ? 'processing'
            : 'idle'
  const analyzeBusy = analyzePhase !== 'idle'
  const analyzeBusyLabel =
    analyzePhase === 'submitting'
      ? t('status.analyzeSubmitting')
      : analyzePhase === 'queued'
        ? t('status.analyzeQueued')
        : analyzePhase === 'processing'
          ? t('status.analyzingProgress', { progress: analyzeProgress })
          : t('buttons.reanalyze')
  const analyzeBannerLabel =
    analyzePhase === 'submitting'
      ? t('status.submitting')
      : analyzePhase === 'queued'
        ? t('status.queuedWaitWorker')
        : analyzePhase === 'processing'
          ? t('status.reanalyzeProgress', { progress: analyzeProgress })
          : ''
  const analyzeError = analyzeSnapshot.data?.errorMessage ?? null
  // Map the raw worker error to a user-facing string via the shared
  // code → message table. Prevents leaking Prisma stack traces / DB
  // column names into the UI when the worker fails on an internal
  // exception (e.g. FK violation).
  const analyzeErrorDisplay = resolveErrorDisplay({
    code: analyzeSnapshot.data?.errorCode ?? null,
    message: analyzeSnapshot.data?.errorMessage ?? null,
  })

  // Poll while EITHER (a) the snapshot reports an active task OR (b) we
  // just submitted one ourselves. Active tasks get a faster 3s tick,
  // idle pages still get a slower 8s baseline so cascades triggered
  // OUTSIDE this page (e.g. subjects 一鍵分析 → clips_build →
  // script_to_storyboard_run) surface within ~8s instead of "never"
  // (chicken-and-egg: status was 'failed' from prior run, isAnalyzing
  // false, polling never starts, user sees frozen 90% from the old
  // failed task even though a fresh task is mid-flight).
  const isActivelySubmitting = analyzeState.status === 'submitted' || analyzeState.status === 'submitting'
  const pollInterval = isAnalyzing || isActivelySubmitting ? 3000 : 8000
  useEffect(() => {
    const interval = setInterval(() => { void analyzeSnapshot.refetch() }, pollInterval)
    return () => clearInterval(interval)
  }, [pollInterval, analyzeSnapshot])

  const previousAnalyzeStatus = useRef(analyzeStatus)
  useEffect(() => {
    if (previousAnalyzeStatus.current !== 'completed' && analyzeStatus === 'completed' && currentEpisodeId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(currentEpisodeId) })
      // 2026-05-29 — R2V auto-chain: after analyze regenerates panels, auto-run
      // grouping so the user doesn't have to manually click 自動切組 then
      // 重生敘事. Server-side autoGroup reads the already-persisted DB panels.
      // Only for r2v-narrative projects; t2i-storyboard keeps the manual flow.
      // Guarded against re-fire by the previousAnalyzeStatus !== 'completed' check.
      if (modeBehavior.autoChainAfterAnalyze && canEdit && !autoGroup.isPending) {
        void autoGroup.mutateAsync({ episodeId: currentEpisodeId }).catch(() => {
          // surfaced via autoGroup.error; manual 自動切組 button remains available
        })
      }
    }
    // Once the server confirms the new task has actually surfaced in the
    // snapshot (active or terminal), drop the local 'submitted' flag so
    // polling can wind down. Without this, polling keeps firing every 3s
    // forever after one analyze click.
    if (
      (analyzeStatus === 'queued' || analyzeStatus === 'processing' ||
        analyzeStatus === 'completed' || analyzeStatus === 'failed') &&
      analyzeState.status === 'submitted'
    ) {
      setAnalyzeState({ status: 'idle' })
    }
    previousAnalyzeStatus.current = analyzeStatus
  }, [analyzeStatus, currentEpisodeId, queryClient, analyzeState.status, modeBehavior.autoChainAfterAnalyze, canEdit, autoGroup])

  const allPanels = useMemo<PanelLike[]>(() => {
    const sb = storyboardsData?.storyboards ?? []
    return sb.flatMap((s) => s.panels ?? [])
  }, [storyboardsData])

  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId) return
    if (allPanels.length > 0) setSelectedId(allPanels[0].id)
  }, [allPanels, selectedId])

  const selected = allPanels.find((p) => p.id === selectedId) ?? null
  const selectedIndex = allPanels.findIndex((p) => p.id === selectedId)

  // Compute which media to render in the Selected Shot preview.
  // Priority: explicit override (if the chosen asset exists) → auto
  // (video if available else image) → null when nothing is generated.
  // The toggle UI below only renders when BOTH assets exist, so the
  // explicit-override branch is only reachable in that case.
  const selectedMediaDisplayMode: MediaDisplayMode | null = (() => {
    if (!selected) return null
    const override = selected.id ? mediaDisplayOverride[selected.id] : undefined
    if (override === 'image' && selected.imageUrl) return 'image'
    if (override === 'video' && selected.videoUrl) return 'video'
    if (selected.videoUrl) return 'video'
    if (selected.imageUrl) return 'image'
    return null
  })()

  // 2026-05-02 — clear regen mutation state when the user picks a
  // different panel. Without this, regenPanel.isSuccess stays true
  // globally after the last submit and the green "已送出重生任務"
  // banner sticks around on every panel the user clicks into next,
  // making them think they accidentally submitted a regen on that
  // panel too. User-reported confusion.
  useEffect(() => {
    regenPanel.reset()
    generateVideo.reset()
    // mutation refs are stable — only re-run when selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // V2 storyboard editor — local drafts for the panel's description (場景
  // 描述詞) and srtSegment (對話/字幕). Re-seeded whenever the user picks
  // a different panel so editing one doesn't leak into another.
  const [descDraft, setDescDraft] = useState<string>('')
  const [dialogueDraft, setDialogueDraft] = useState<string>('')
  useEffect(() => {
    setDescDraft(selected?.description ?? selected?.prompt ?? '')
    setDialogueDraft(selected?.srtSegment ?? '')
  }, [selected?.id, selected?.description, selected?.prompt, selected?.srtSegment])
  const descChanged = descDraft !== (selected?.description ?? selected?.prompt ?? '')
  const dialogueChanged = dialogueDraft !== (selected?.srtSegment ?? '')

  function handleSaveDescription() {
    if (!selected) return
    updatePanelText.mutate(
      { panelId: selected.id, description: descDraft },
      { onError: (err) => alert(err instanceof Error ? err.message : t('errors.saveDescriptionFailed')) },
    )
  }
  function handleSaveDialogue() {
    if (!selected) return
    updatePanelText.mutate(
      { panelId: selected.id, srtSegment: dialogueDraft },
      { onError: (err) => alert(err instanceof Error ? err.message : t('errors.saveDialogueFailed')) },
    )
  }
  // Track per-panel image / video gen in-flight so the user sees a clear
  // overlay the instant they click the button. Without local state, the
  // overlay relies on the server-side useActiveTasks polling (3s tick),
  // so users see a 0-3s gap between click and overlay appearing — felt
  // like the click "didn't register". Local state covers the gap until
  // the next poll surfaces the task; once the server set picks it up,
  // both sources agree and the overlay stays consistent.
  const [imageInFlight, setImageInFlight] = useState<Set<string>>(new Set())
  const [videoInFlight, setVideoInFlight] = useState<Set<string>>(new Set())

  // Server-side image / video panel tasks. These survive page navigation
  // because they're polled from the DB, not stored in React state. Without
  // this, the user clicks 重新生成圖, switches to /subjects to check
  // characters, returns — sees no overlay and assumes the task is gone
  // even though it's still running in the background. User reported:
  // 「當我在這邊按重新生成圖, 我切換到劇本拆解或其他頁面, 就會消失了」.
  const activePanelImageTasks = useActiveTasks({
    projectId,
    type: ['image_panel', 'video_panel'],
  })
  const serverInflightPanelImageIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of activePanelImageTasks.data ?? []) {
      if (t.targetType === 'NovelPromotionPanel' && typeof t.targetId === 'string' && t.type === 'image_panel') {
        set.add(t.targetId)
      }
    }
    return set
  }, [activePanelImageTasks.data])
  const serverInflightPanelVideoIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of activePanelImageTasks.data ?? []) {
      if (t.targetType === 'NovelPromotionPanel' && typeof t.targetId === 'string' && t.type === 'video_panel') {
        set.add(t.targetId)
      }
    }
    return set
  }, [activePanelImageTasks.data])
  // 2026-05-02 — recently-failed panel tasks. User reported a batch
  // generate run where two thumbnails ended without an image and
  // without any error indicator — looked like the click "didn't
  // register". The tasks were actually status=failed in DB
  // (Tencent VOD RATE_LIMIT after 5 retries, or content-policy
  // ViolationContent rejection). Surfacing this set as a Set<panelId>
  // lets the strip render a rose-coloured "失敗 ✗" overlay so users
  // know to retry instead of assuming the system silently dropped
  // their click.
  const failedPanelTasks = useTaskList({
    projectId,
    type: ['image_panel', 'video_panel'],
    statuses: ['failed'],
    limit: 50,
  })
  const failedPanelImageIds = useMemo(() => {
    const map = new Map<string, { errorCode: string | null; errorMessage: string | null }>()
    for (const t of failedPanelTasks.data ?? []) {
      if (
        t.targetType === 'NovelPromotionPanel'
        && typeof t.targetId === 'string'
        && t.type === 'image_panel'
      ) {
        // Latest failure wins per-panel (the API sorts by createdAt
        // desc by default). The Map key is the panel id, value is
        // a brief error packet for the tooltip.
        if (!map.has(t.targetId)) {
          map.set(t.targetId, {
            errorCode: t.errorCode ?? null,
            errorMessage: t.errorMessage ?? null,
          })
        }
      }
    }
    return map
  }, [failedPanelTasks.data])
  const failedPanelVideoIds = useMemo(() => {
    const map = new Map<string, { errorCode: string | null; errorMessage: string | null }>()
    for (const t of failedPanelTasks.data ?? []) {
      if (
        t.targetType === 'NovelPromotionPanel'
        && typeof t.targetId === 'string'
        && t.type === 'video_panel'
      ) {
        if (!map.has(t.targetId)) {
          map.set(t.targetId, {
            errorCode: t.errorCode ?? null,
            errorMessage: t.errorMessage ?? null,
          })
        }
      }
    }
    return map
  }, [failedPanelTasks.data])
  // Poll while any in-flight, including video tracked locally — that way
  // we catch tasks no matter where they were submitted from.
  useEffect(() => {
    if (
      serverInflightPanelImageIds.size === 0 &&
      serverInflightPanelVideoIds.size === 0 &&
      videoInFlight.size === 0
    ) return
    const interval = setInterval(() => { void activePanelImageTasks.refetch() }, 3000)
    return () => clearInterval(interval)
  }, [
    serverInflightPanelImageIds.size,
    serverInflightPanelVideoIds.size,
    videoInFlight.size,
    activePanelImageTasks,
  ])
  // When the server set of in-flight image/video tasks shrinks, refresh
  // storyboards so the new imageUrl / videoUrl surfaces immediately.
  const previousServerImageInflight = useRef(serverInflightPanelImageIds.size)
  const previousServerVideoInflight = useRef(serverInflightPanelVideoIds.size)
  useEffect(() => {
    if (
      (previousServerImageInflight.current > serverInflightPanelImageIds.size ||
        previousServerVideoInflight.current > serverInflightPanelVideoIds.size) &&
      currentEpisodeId
    ) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(currentEpisodeId) })
    }
    previousServerImageInflight.current = serverInflightPanelImageIds.size
    previousServerVideoInflight.current = serverInflightPanelVideoIds.size
  }, [
    serverInflightPanelImageIds.size,
    serverInflightPanelVideoIds.size,
    currentEpisodeId,
    queryClient,
  ])

  // Poll storyboards while any panel video is in flight so the new
  // videoUrl surfaces and the indicator clears automatically.
  useEffect(() => {
    if (videoInFlight.size === 0) return
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(currentEpisodeId || '') })
    }, 5000)
    return () => clearInterval(interval)
  }, [videoInFlight.size, queryClient, currentEpisodeId])

  // Sync against panel.videoUrl arriving — drop panels that completed
  // from the in-flight set so the indicator clears.
  useEffect(() => {
    if (videoInFlight.size === 0) return
    const next = new Set(videoInFlight)
    let changed = false
    for (const p of allPanels) {
      if (videoInFlight.has(p.id) && p.videoUrl) {
        next.delete(p.id)
        changed = true
      }
    }
    if (changed) setVideoInFlight(next)
  }, [allPanels, videoInFlight])

  // Same drop-on-completion sync for image regen — release the local
  // imageInFlight slot once the worker has actually written the new
  // imageUrl onto the panel. Without this, the local overlay would
  // hang around even after the image is back on screen.
  useEffect(() => {
    if (imageInFlight.size === 0) return
    const next = new Set(imageInFlight)
    let changed = false
    for (const p of allPanels) {
      if (imageInFlight.has(p.id) && p.imageUrl && !serverInflightPanelImageIds.has(p.id)) {
        next.delete(p.id)
        changed = true
      }
    }
    if (changed) setImageInFlight(next)
  }, [allPanels, imageInFlight, serverInflightPanelImageIds])

  // 2026-05-17 — modelOverride lets the per-shot Seedance buttons
  // (added in the Selected Shot card) submit a one-off video gen using
  // fal Seedance 2.0 without touching project.videoModel. The default
  // path (no override → use project setting) is unchanged.
  function handleGenerateVideo(modelOverride?: string) {
    if (!selected) return
    const videoModel = modelOverride ?? project?.novelPromotionData?.videoModel
    if (!videoModel) {
      alert(t('errors.noVideoModelPicked'))
      return
    }
    const panelIdAtSubmit = selected.id
    generateVideo.mutate(
      {
        panelId: panelIdAtSubmit,
        storyboardId: selected.storyboardId ?? '',
        panelIndex: selected.panelIndex ?? 0,
        videoModel,
      },
      {
        onSuccess: () => {
          setVideoInFlight((prev) => {
            const next = new Set(prev)
            next.add(panelIdAtSubmit)
            return next
          })
        },
        onError: (err) => alert(err instanceof Error ? err.message : t('errors.submitVideoFailed')),
      },
    )
  }
  const isCurrentPanelVideoInFlight =
    !!selected && (videoInFlight.has(selected.id) || serverInflightPanelVideoIds.has(selected.id))
  const isCurrentPanelImageInFlight =
    !!selected && (imageInFlight.has(selected.id) || serverInflightPanelImageIds.has(selected.id))

  // Distinct group ids in the order panels appear, for stable colour cycling.
  const orderedGroupIds = useMemo(() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const p of allPanels) {
      if (p.multiShotGroupId && !seen.has(p.multiShotGroupId)) {
        seen.add(p.multiShotGroupId)
        ordered.push(p.multiShotGroupId)
      }
    }
    return ordered
  }, [allPanels])
  const hasGroups = orderedGroupIds.length > 0
  const groupedPanelCount = allPanels.filter((p) => p.multiShotGroupId).length

  // Phase 1 step 2 (2026-06-21) — hoisted out of the groups-branch
  // inline IIFE so V2StoryboardGroupsView can receive it as a plain
  // prop. Flattens storyboards[].referenceVideoUrl into a lookup map
  // keyed by storyboardId; pre-signed by the route response.
  const referenceVideoByStoryboardId = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const sb of storyboardsData?.storyboards ?? []) {
      const id = (sb as { id?: string }).id
      const url = (sb as { referenceVideoUrl?: string | null }).referenceVideoUrl ?? null
      if (typeof id === 'string') map[id] = url
    }
    return map
  }, [storyboardsData])

  // Stage 1 chip rail target: which multi-shot taskId belongs to the
  // currently-selected panel's group? Resolves null when the panel
  // either isn't grouped (mechanical chunk) or no multi-shot has been
  // submitted for this group yet — the rail stays hidden in that case.
  const selectedGroupId = selected?.multiShotGroupId ?? null
  const selectedGroupTaskId = selectedGroupId ? (taskByGroup[selectedGroupId] ?? null) : null
  const selectedGroupOrdinal = selectedGroupId ? orderedGroupIds.indexOf(selectedGroupId) : -1
  const selectedGroupLabel = selectedGroupOrdinal >= 0
    ? `GROUP ${String(selectedGroupOrdinal + 1).padStart(2, '0')}`
    : null

  // Recover server-side multi-shot tasks that were submitted before
  // localStorage tracking was wired (or from another browser / device).
  // Strategy: query video_multi_shot tasks for each storyboard, look
  // at task.payload.panelIds[0], cross-reference panel → groupId,
  // pick most-recent task per groupId. Local state wins on conflict
  // so a fresh submit doesn't get clobbered by a slightly-older
  // server view.
  const storyboardIds = useMemo(() => {
    const sb = storyboardsData?.storyboards ?? []
    return sb.map((s) => s.id).filter(Boolean)
  }, [storyboardsData])
  const storyboardKey = storyboardIds.join(',')

  useEffect(() => {
    if (!currentEpisodeId || storyboardIds.length === 0) return
    const panelToGroup = new Map<string, string>()
    for (const p of allPanels) {
      if (p.multiShotGroupId) panelToGroup.set(p.id, p.multiShotGroupId)
    }
    if (panelToGroup.size === 0) return

    let cancelled = false
    void (async () => {
      const recovered: Record<string, { taskId: string; createdAt: string }> = {}
      let totalTasksScanned = 0
      let httpErrors = 0
      for (const sbId of storyboardIds) {
        try {
          const params = new URLSearchParams()
          params.set('targetType', 'NovelPromotionStoryboard')
          params.set('targetId', sbId)
          params.append('type', 'video_multi_shot')
          params.set('limit', '50')
          const res = await fetch(`/api/tasks?${params.toString()}`)
          if (!res.ok) {
            httpErrors += 1
            continue
          }
          const json = (await res.json()) as { tasks?: Array<Record<string, unknown>> }
          const tasks = Array.isArray(json.tasks) ? json.tasks : []
          totalTasksScanned += tasks.length
          for (const t of tasks) {
            const taskId = typeof t.id === 'string' ? t.id : null
            const createdAt = typeof t.createdAt === 'string' ? t.createdAt : ''
            const payload = (t.payload && typeof t.payload === 'object' && !Array.isArray(t.payload))
              ? (t.payload as Record<string, unknown>)
              : null
            const panelIds = Array.isArray(payload?.panelIds) ? (payload!.panelIds as unknown[]) : []
            const firstPanelId = typeof panelIds[0] === 'string' ? (panelIds[0] as string) : null
            if (!taskId || !firstPanelId) continue
            const groupId = panelToGroup.get(firstPanelId)
            if (!groupId) continue
            const existing = recovered[groupId]
            if (!existing || createdAt > existing.createdAt) {
              recovered[groupId] = { taskId, createdAt }
            }
          }
        } catch (err) {
          // Visible breadcrumb so cross-browser issues are debuggable
          // from the browser console without a server hit.
           
          console.warn('[multi-shot-recovery] fetch failed for storyboard', sbId, err)
        }
      }
      if (cancelled) return
      const recoveredMap: Record<string, string> = {}
      for (const [g, v] of Object.entries(recovered)) recoveredMap[g] = v.taskId
       
      console.info(
        '[multi-shot-recovery]',
        `storyboards=${storyboardIds.length}`,
        `tasks=${totalTasksScanned}`,
        `httpErrors=${httpErrors}`,
        `mappedGroups=${Object.keys(recoveredMap).length}`,
      )
      if (Object.keys(recoveredMap).length === 0) return
      // Server is the source of truth for cross-browser consistency,
      // but a fresh-from-this-tab submit captured into localStorage
      // wins because the server query may lag behind it by a few
      // hundred ms.
      setTaskByGroup((prev) => ({ ...recoveredMap, ...prev }))
    })()
    return () => {
      cancelled = true
    }
  }, [currentEpisodeId, storyboardKey, allPanels, storyboardIds])

  async function handleAnalyzeStoryboard() {
    if (!currentEpisodeId) {
      setAnalyzeState({ status: 'error', message: t('errors.needEpisodeFirst') })
      return
    }
    setAnalyzeState({ status: 'submitting' })
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/script-to-storyboard-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: currentEpisodeId,
          displayMode: 'detail',
          async: true,
          // 2026-05-13 — opt out of the post-analysis IMAGE_PANEL cascade
          // that script-to-storyboard handler runs by default (added
          // 2026-05-04 for mobile review UX). On V2 desktop the user wants
          // explicit control: image gen only fires when they click the
          // per-panel "生成圖片" or the toolbar batch button. Mobile flow
          // (which still benefits from auto-cascade for on-the-go review)
          // is unaffected — it has its own analysis trigger path.
          cascadeImageGen: false,
        }),
      })
      if (!res.ok) {
        // 2026-05-21 — Pre-fix this dumped the raw JSON response body
        // straight into analyzeState.message → user saw a wall of
        // {"success":false,"requestId":...,"error":{...}}. Route through
        // resolveErrorDisplay so the CONFLICT / EPISODE_NO_CLIPS /
        // TASK_STILL_PROCESSING codes get their targeted friendly text.
        let errBody: { error?: { code?: string; message?: string }; message?: string } = {}
        try {
          errBody = await res.json()
        } catch {
          // body not JSON — fall through to status-based message
        }
        const display = resolveErrorDisplay({
          code: errBody?.error?.code ?? null,
          message: errBody?.error?.message ?? errBody?.message ?? null,
        })
        throw new Error(display?.message ?? t('errors.submitFailedHttp', { status: res.status }))
      }
      setAnalyzeState({ status: 'submitted' })
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
      void analyzeSnapshot.refetch()
    } catch (err) {
      setAnalyzeState({
        status: 'error',
        message: err instanceof Error ? err.message : t('errors.submitFailedGeneric'),
      })
    }
  }

  async function handleAutoGroup() {
    if (!currentEpisodeId) return
    try {
      await autoGroup.mutateAsync({ episodeId: currentEpisodeId })
    } catch {
      // surfaced via autoGroup.error
    }
  }

  /**
   * Submit the manual panel modal — B 組 free-prompt workflow.
   *
   * Steps:
   *   1. Find a storyboard group for the current episode. If none
   *      exists yet (which is the common case for B 組 — they skip
   *      the auto-flow entirely), create one via
   *      useCreateProjectStoryboardGroup so the panel has somewhere
   *      to land.
   *   2. POST the panel with description + characters JSON + location.
   *      The worker side panel-image-task-handler already knows how
   *      to read these fields (parsePanelCharacterReferences etc.) —
   *      no special "manual" branch needed.
   *   3. Auto-trigger image gen on the new panel so the user sees a
   *      result immediately, no need to click 重新生成 after create.
   *   4. Close modal regardless of gen success — the panel exists in
   *      the grid even if gen errors out, and users can always retry
   *      via the per-card button.
   */
  async function handleManualPanelSubmit(draft: ManualPanelDraft) {
    if (!currentEpisodeId) {
      alert(t('errors.needPanelEpisode'))
      return
    }
    setManualPanelSubmitting(true)
    try {
      // Pick or create the destination storyboard group.
      const existingGroups = storyboardsData?.storyboards ?? []
      let storyboardId: string | null = existingGroups[existingGroups.length - 1]?.id ?? null
      if (!storyboardId) {
        const created = (await createStoryboardGroup.mutateAsync({
          episodeId: currentEpisodeId,
          insertIndex: 0,
        })) as { storyboard?: { id?: string }; id?: string } | null
        storyboardId =
          (created && (created.storyboard?.id ?? created.id ?? null)) || null
        if (!storyboardId) {
          throw new Error(t('errors.cannotCreateGroup'))
        }
      }

      // 2026-05-13 — assign a fresh multiShotGroupId so the new panel
      // shows up immediately as its own group in the multi-shot view.
      // Without this the panel lives in the storyboard but is invisible
      // in the groups layout (which renders by multiShotGroupId only).
      // User can later use 自動切組 to merge / reshuffle.
      const manualGroupId = `manual-${
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      }`

      const created = (await createPanel.mutateAsync({
        storyboardId,
        description: draft.description,
        characters: draft.characterNames.length > 0
          ? JSON.stringify(draft.characterNames)
          : null,
        location: draft.locationName,
        duration: draft.durationSeconds,
        multiShotGroupId: manualGroupId,
        multiShotGroupOrder: 0,
      })) as { panel?: { id?: string }; id?: string } | null
      const newPanelId =
        (created && (created.panel?.id ?? created.id ?? null)) || null

      if (newPanelId) {
        // Best-effort kick-off; if gen fails (rate limit, sensitive
        // content) the panel still lives in the grid for retry.
        regenPanel.mutate({ panelId: newPanelId }, {
          onError: () => {
            // surfaced via per-card error overlay; nothing more to do here
          },
        })
      }

      // Force the storyboards query to refetch so the timeline / multi-
      // shot view picks up the new panel + group immediately.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.storyboards.all(currentEpisodeId),
      })

      setManualPanelOpen(false)
    } catch (err) {
      alert(t('errors.createFailed', { reason: (err as Error)?.message ?? t('errors.unknown') }))
    } finally {
      setManualPanelSubmitting(false)
    }
  }

  /**
   * Batch-generate static images for every panel that doesn't have
   * one yet. Each panel goes through the same regenPanel mutation
   * the per-card button uses, so worker dispatch / dedupe / billing
   * are identical — we just don't make the user click 17 times.
   *
   * Submitted serially with a 100ms gap between requests so we don't
   * smash the API or trip BullMQ's per-second add-job limit. The
   * panels are filtered to those WITHOUT an existing imageUrl: this
   * is a "fill in the blanks" action, not a "regenerate everything"
   * action. Users who want to nuke + redo can click per-card 重新生
   * 成圖 individually.
   */
  async function handleBatchGenerateImages() {
    const targets = allPanels.filter((p) => !p.imageUrl && !imageInFlight.has(p.id))
    if (targets.length === 0) return
    setBatchImageState({ submitted: 0, total: targets.length })
    let i = 0
    for (const p of targets) {
      try {
        await regenPanel.mutateAsync({ panelId: p.id })
        setImageInFlight((prev) => {
          const next = new Set(prev)
          next.add(p.id)
          return next
        })
      } catch {
        // Per-panel failure is non-fatal — surface via the per-card
        // overlay; the loop should keep submitting siblings.
      }
      i += 1
      setBatchImageState({ submitted: i, total: targets.length })
      // Tiny gap so BullMQ + Tencent VOD ingest doesn't burst-reject.
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    void activePanelImageTasks.refetch()
    // Auto-clear the toolbar pill 5s after the last submit so it
    // doesn't sit there forever — the per-card overlays still show
    // generation state.
    setTimeout(() => setBatchImageState(null), 5000)
  }

  /**
   * Batch-generate video for every panel that has an imageUrl but no
   * videoUrl yet. Same submit-serial-with-gap pattern as
   * handleBatchGenerateImages. Non-eligible panels (missing imageUrl
   * for i2v video models) are silently skipped — the multi-shot
   * B-path button is the right tool for projects that don't generate
   * static images.
   */
  async function handleBatchGenerateVideos() {
    const videoModel = project?.novelPromotionData?.videoModel
    if (!videoModel) {
      alert(t('errors.noVideoModelPicked'))
      return
    }
    const targets = allPanels.filter(
      (p) => Boolean(p.imageUrl) && !p.videoUrl && !videoInFlight.has(p.id),
    )
    if (targets.length === 0) return
    setBatchVideoState({ submitted: 0, total: targets.length })
    let i = 0
    for (const p of targets) {
      try {
        await generateVideo.mutateAsync({
          panelId: p.id,
          storyboardId: p.storyboardId ?? '',
          panelIndex: p.panelIndex ?? 0,
          videoModel,
        })
        setVideoInFlight((prev) => {
          const next = new Set(prev)
          next.add(p.id)
          return next
        })
      } catch {
        // surfaced per-card; continue the loop
      }
      i += 1
      setBatchVideoState({ submitted: i, total: targets.length })
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    setTimeout(() => setBatchVideoState(null), 5000)
  }

  async function handleSubmitMultiShot() {
    const videoModel = project?.novelPromotionData?.videoModel
    if (!videoModel) {
      setMultiShotState({
        status: 'error',
        message: t('errors.noVideoModelMultiShot'),
      })
      return
    }
    // 2026-05-17 — use the variant registry's capability bit so adding
    // a new multi-shot-capable model in src/lib/video-models/variants.ts
    // automatically lights up this button. Unknown ids (legacy DB rows)
    // fail closed by isMultiShotCapable → user sees the same gentle
    // error + can switch via the new inline picker.
    if (!isMultiShotCapable(videoModel)) {
      setMultiShotState({
        status: 'error',
        message: t('errors.modelNotMultiShot', { model: videoModel }),
      })
      return
    }
    // Routes that anchor identity outside per-panel imageUrl (B-path
    // SubjectInfos.N, Seedance composite via taijiai/atlascloud/ark/fal which
    // pull from project character/scene catalog) tolerate text-only panels.
    // Single source of truth in videoModelToleratesTextOnlyPanels — keep this
    // in sync with the route + worker dispatcher (regression test enforces).
    const tolerateTextOnly = videoModelToleratesTextOnlyPanels(videoModel)
    const eligible = tolerateTextOnly
      ? allPanels
      : allPanels.filter((p) => Boolean(p.imageUrl))
    if (eligible.length < 2) {
      setMultiShotState({
        status: 'error',
        message: tolerateTextOnly
          ? t('errors.needTwoPanels')
          : t('errors.needTwoImagedPanels'),
      })
      return
    }

    // Prefer LLM-assigned groups (Phase 12.5.3): if any panel has a
    // multiShotGroupId, group everything by that, otherwise fall back to
    // mechanical chunk(5). When LLM-assigned, we also keep the groupId
    // so the chip rail can later look up the resulting bindings keyed
    // by the same ID — mechanical chunks stay anonymous and just won't
    // light up a rail (still get the video, just no binding affordance).
    type SubmitGroup = { groupId: string | null; panelIds: string[] }
    let groups: SubmitGroup[]
    const grouped = new Map<string, PanelLike[]>()
    let anyAssigned = false
    for (const p of eligible) {
      if (p.multiShotGroupId) {
        anyAssigned = true
        const list = grouped.get(p.multiShotGroupId) ?? []
        list.push(p)
        grouped.set(p.multiShotGroupId, list)
      }
    }
    if (anyAssigned) {
      const tmp: SubmitGroup[] = []
      for (const [groupId, panels] of grouped.entries()) {
        const sorted = panels
          .slice()
          .sort((a, b) => (a.multiShotGroupOrder ?? 0) - (b.multiShotGroupOrder ?? 0))
        if (sorted.length < 2) continue
        const ids = (sorted.length > 6 ? sorted.slice(0, 6) : sorted).map((p) => p.id)
        tmp.push({ groupId, panelIds: ids })
      }
      groups = tmp
    } else {
      groups = chunk(eligible.map((p) => p.id), KLING_GROUP_SIZE).map((panelIds) => ({
        groupId: null,
        panelIds,
      }))
    }
    if (groups.length === 0) {
      setMultiShotState({
        status: 'error',
        message: t('errors.noMultiShotGroups'),
      })
      return
    }
    setMultiShotState({ status: 'submitting', sent: 0, total: groups.length })
    let sent = 0
    let failures = 0
    const submittedTaskIds: Record<string, string> = {}
    for (const group of groups) {
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/generate-multi-shot-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            panelIds: group.panelIds,
            videoModel,
            aspectRatio: projectVideoRatio,
            resolution: projectVideoResolution,
            sound: soundEnabled,
            meta: { locale: 'zh-TW' },
            async: true,
          }),
        })
        if (!res.ok) {
          failures += 1
        } else if (group.groupId) {
          // Capture taskId per groupId so the chip rail can show
          // bindings as soon as the worker completes.
          try {
            const body = (await res.json()) as { taskId?: unknown }
            if (body && typeof body.taskId === 'string' && body.taskId.length > 0) {
              submittedTaskIds[group.groupId] = body.taskId
            }
          } catch {
            // Ignore JSON parse failure — still counts as sent;
            // chip rail just won't light up for this group.
          }
        }
      } catch {
        failures += 1
      }
      sent += 1
      setMultiShotState({ status: 'submitting', sent, total: groups.length })
    }
    if (Object.keys(submittedTaskIds).length > 0) {
      setTaskByGroup((prev) => ({ ...prev, ...submittedTaskIds }))
    }
    setMultiShotState({ status: 'done', sent, failures })
  }

  if (projectQuery.isLoading || storyboardsQuery.isLoading) {
    return (
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">{t('loading')}</p>
      </div>
    )
  }

  if (!currentEpisodeId) {
    return (
      <div className="px-12 py-10">
        <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
          <p className="font-fraunces text-base italic text-stone-400">
            {t('page.noEpisodeHint')}
          </p>
        </div>
      </div>
    )
  }

  if (allPanels.length === 0) {
    const submitDisabled = analyzeBusy || !currentEpisodeId || !canEdit
    const ctaLabel = analyzeBusy
      ? analyzeBusyLabel
      : analyzeStatus === 'failed'
        ? t('buttons.reanalyze')
        : t('generateSplash.titleGeneric')
    return (
      <div className="px-12 py-10">
        <div className="rounded-sm border border-amber-500/30 bg-amber-500/5 p-8 text-center">
          <div className="mx-auto max-w-xl space-y-4">
            <div className="font-fraunces text-lg italic text-amber-400">
              {currentEpisode ? t('generateSplash.titleForEpisode', { episode: currentEpisode.name }) : t('generateSplash.titleGeneric')}
            </div>
            <p className="font-serif-cn text-sm leading-relaxed text-stone-400">
              {t('generateSplash.subtitle')}
            </p>
            <button
              type="button"
              onClick={handleAnalyzeStoryboard}
              disabled={submitDisabled}
              className="inline-flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-2.5 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {ctaLabel}
            </button>
            {analyzeState.status === 'error' ? (
              <p className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {t('generateSplash.submitErrorPrefix', { message: analyzeState.message })}
              </p>
            ) : null}
            {analyzeStatus === 'failed' && (analyzeErrorDisplay || analyzeError) ? (
              <p
                className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
                title={analyzeError ?? undefined}
              >
                {t('generateSplash.lastAnalyzeErrorPrefix', { message: analyzeErrorDisplay?.message ?? t('errors.lastAnalyzeFailedNoMsg') })}
              </p>
            ) : null}
            {!currentEpisodeId ? (
              <p className="font-mono text-[14px] tracking-wider text-stone-500">
                {t('generateSplash.noEpisodes')}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  // Shared layout toggle widget — all layout branches render this in
  // their toolbar so the user can flip between Gallery / Timeline /
  // Groups without leaving the page.
  const layoutToggleNode = (
    <div className="flex items-center gap-0 overflow-hidden rounded-sm border border-stone-800">
      <button
        type="button"
        onClick={() => setLayoutMode('gallery')}
        title={t('layouts.galleryTitle')}
        className={`px-2.5 py-1.5 font-mono text-[14px] tracking-wider transition-colors ${
          layoutMode === 'gallery'
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-stone-500 hover:text-amber-400'
        }`}
      >
        {t('layouts.gallery')}
      </button>
      <button
        type="button"
        onClick={() => setLayoutMode('timeline')}
        title={t('layouts.timelineTitle')}
        className={`px-2.5 py-1.5 font-mono text-[14px] tracking-wider transition-colors ${
          layoutMode === 'timeline'
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-stone-500 hover:text-amber-400'
        }`}
      >
        {t('layouts.timeline')}
      </button>
      <button
        type="button"
        onClick={() => setLayoutMode('groups')}
        title={t('layouts.multiShotTitle')}
        className={`px-2.5 py-1.5 font-mono text-[14px] tracking-wider transition-colors ${
          layoutMode === 'groups'
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-stone-500 hover:text-amber-400'
        }`}
      >
        {t('layouts.multiShot')}
      </button>
    </div>
  )

  // 2026-05-19 — Shared video-model picker. Originally only mounted inside
  // the groups toolbar (so gallery / timeline users couldn't see or change
  // the current model from their layout — they had to switch to groups
  // first). Hoisted out so all three toolbars can mount the same widget;
  // existing tooltip strings ("請從上方視頻模型 picker 切到 …") finally
  // point at a picker that's actually visible in the current layout.
  const videoModelPickerNode = (
    <VideoModelPickerInline
      projectId={projectId}
      currentVideoModel={projectVideoModel || null}
      videoRatio={projectVideoRatio || '9:16'}
      targetDuration={project?.novelPromotionData?.targetDuration ?? null}
      videoResolution={projectVideoResolution}
      seedanceOnly={modeBehavior.videoModelFilter === 'seedance-only'}
      soundEnabled={soundEnabled}
      onSoundToggle={() => setSoundEnabled((v) => !v)}
    />
  )

  // 2026-05-13 — Modals (manual panel + stale storyboard cleanup) live
  // outside the per-layout branches because each layout used to
  // early-return its layout JSX without including modals → button
  // onClick fired, state updated, but the modal never rendered.
  // Surface them here so all three layout branches (gallery / timeline /
  // groups) can mount the same overlay tree.
  const globalOverlaysNode = (
    <>
      {manualPanelOpen ? (
        <V2ManualPanelModal
          characters={characterRoster.map((c) => ({ id: c.id, name: c.name ?? t('untitled.character') }))}
          locations={locationRoster.map((l) => ({ id: l.id, name: l.name ?? t('untitled.scene') }))}
          onSubmit={handleManualPanelSubmit}
          onClose={() => setManualPanelOpen(false)}
          isSubmitting={manualPanelSubmitting}
          contextHint={
            (storyboardsData?.storyboards?.length ?? 0) === 0
              ? t('header.noGroupsHint')
              : undefined
          }
        />
      ) : null}

      {currentEpisodeId ? (
        <StaleStoryboardCleanupModal
          projectId={projectId}
          episodeId={currentEpisodeId}
          open={staleCleanupOpen}
          onClose={() => setStaleCleanupOpen(false)}
          onAfterDelete={() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.storyboards.all(currentEpisodeId),
            })
          }}
        />
      ) : null}
    </>
  )

  // ─── Groups layout (text-driven multi-shot) ──────────────────────
  // Phase 1 step 2 (2026-06-21) — full branch extracted to
  // V2StoryboardGroupsView. See that file for the toolbar JSX +
  // onRegenerateGroup async callback. Pure relocation; behavior
  // unchanged.
  if (layoutMode === 'groups') {
    return (
      <V2StoryboardGroupsView
        projectId={projectId}
        currentEpisodeId={currentEpisodeId}
        episodeNumber={(currentEpisode as { episodeNumber?: number } | null)?.episodeNumber ?? null}
        projectVideoModel={projectVideoModel}
        projectVideoRatio={projectVideoRatio}
        projectVideoResolution={projectVideoResolution}
        projectVisualStyleId={project?.novelPromotionData?.visualStyleId ?? null}
        targetDurationSec={project?.novelPromotionData?.targetDuration ?? null}
        canMultiShot={canMultiShot}
        videoFamily={videoFamily}
        canEdit={canEdit}
        viewerTip={viewerTip}
        globalOverlaysNode={globalOverlaysNode}
        layoutToggleNode={layoutToggleNode}
        videoModelPickerNode={videoModelPickerNode}
        manualPanelSubmitting={manualPanelSubmitting}
        onManualPanelOpen={() => setManualPanelOpen(true)}
        analyzeBusy={analyzeBusy}
        analyzeBusyLabel={analyzeBusyLabel}
        onAnalyzeStoryboard={handleAnalyzeStoryboard}
        onStaleCleanupOpen={() => setStaleCleanupOpen(true)}
        autoGroup={autoGroup}
        multiShotState={multiShotState}
        onSubmitMultiShot={handleSubmitMultiShot}
        allPanels={allPanels}
        orderedGroupIds={orderedGroupIds}
        groupedPanelCount={groupedPanelCount}
        hasGroups={hasGroups}
        taskByGroup={taskByGroup}
        setTaskByGroup={setTaskByGroup}
        referenceVideoByStoryboardId={referenceVideoByStoryboardId}
        updatePanelText={updatePanelText}
        characterRoster={characterRoster}
        locationRoster={locationRoster}
        episodeBindings={episodeBindings}
        soundEnabled={soundEnabled}
      />
    )
  }

  // ─── Gallery layout (default) ────────────────────────────────────
  // Phase 1 step 3 (2026-06-21) — full branch extracted to
  // V2StoryboardGalleryView. See that file for the toolbar JSX +
  // 60/40 grid + selected-shot inspector. Pure relocation; behavior
  // unchanged.
  if (layoutMode === 'gallery') {
    return (
      <V2StoryboardGalleryView
        projectId={projectId}
        currentEpisodeId={currentEpisodeId}
        projectVideoRatio={projectVideoRatio}
        aspectClass={aspectClass}
        canMultiShot={canMultiShot}
        videoFamily={videoFamily}
        canEdit={canEdit}
        globalOverlaysNode={globalOverlaysNode}
        layoutToggleNode={layoutToggleNode}
        videoModelPickerNode={videoModelPickerNode}
        analyzeBusy={analyzeBusy}
        analyzeBusyLabel={analyzeBusyLabel}
        analyzeBannerLabel={analyzeBannerLabel}
        analyzePhase={analyzePhase}
        analyzeProgress={analyzeProgress}
        onAnalyzeStoryboard={handleAnalyzeStoryboard}
        onStaleCleanupOpen={() => setStaleCleanupOpen(true)}
        autoGroup={autoGroup}
        onAutoGroup={handleAutoGroup}
        multiShotState={multiShotState}
        onSubmitMultiShot={handleSubmitMultiShot}
        allPanels={allPanels}
        hasGroups={hasGroups}
        orderedGroupIds={orderedGroupIds}
        groupedPanelCount={groupedPanelCount}
        selected={selected}
        setSelectedId={setSelectedId}
        selectedGroupTaskId={selectedGroupTaskId}
        selectedGroupLabel={selectedGroupLabel}
        imageInFlight={imageInFlight}
        setImageInFlight={setImageInFlight}
        videoInFlight={videoInFlight}
        serverInflightPanelImageIds={serverInflightPanelImageIds}
        serverInflightPanelVideoIds={serverInflightPanelVideoIds}
        isCurrentPanelImageInFlight={isCurrentPanelImageInFlight}
        isCurrentPanelVideoInFlight={isCurrentPanelVideoInFlight}
        regenPanel={regenPanel}
        generateVideo={generateVideo}
        updatePanelText={updatePanelText}
        activePanelImageTasks={activePanelImageTasks}
        onGenerateVideo={handleGenerateVideo}
        descDraft={descDraft}
        setDescDraft={setDescDraft}
        descChanged={descChanged}
        onSaveDescription={handleSaveDescription}
        dialogueDraft={dialogueDraft}
        setDialogueDraft={setDialogueDraft}
        dialogueChanged={dialogueChanged}
        onSaveDialogue={handleSaveDialogue}
      />
    )
  }

  // ─── Timeline layout (existing) ──────────────────────────────────
  // Phase 1 step 4 (2026-06-22) — full branch extracted to
  // V2StoryboardTimelineView (which orchestrates 4 sub-views: Strip,
  // Text, Shot, Inspector). All derived values computed here in the
  // parent (per reviewer Q1 qualify) and flow down. Pure relocation;
  // behavior unchanged.
  return (
    <V2StoryboardTimelineView
      projectId={projectId}
      project={project}
      currentEpisodeId={currentEpisodeId}
      currentEpisode={currentEpisode as { episodeNumber?: number } | null}
      projectVideoRatio={projectVideoRatio}
      isPortraitRatio={isPortraitRatio}
      thumbHeightClass={thumbHeightClass}
      canMultiShot={canMultiShot}
      videoFamily={videoFamily}
      canEdit={canEdit}
      globalOverlaysNode={globalOverlaysNode}
      layoutToggleNode={layoutToggleNode}
      videoModelPickerNode={videoModelPickerNode}
      allPanels={allPanels}
      orderedGroupIds={orderedGroupIds}
      hasGroups={hasGroups}
      groupedPanelCount={groupedPanelCount}
      selected={selected}
      selectedId={selectedId}
      selectedIndex={selectedIndex}
      setSelectedId={setSelectedId}
      selectedGroupTaskId={selectedGroupTaskId}
      selectedGroupLabel={selectedGroupLabel}
      selectedMediaDisplayMode={selectedMediaDisplayMode}
      setMediaDisplayOverride={setMediaDisplayOverride}
      analyzeBusy={analyzeBusy}
      analyzeBusyLabel={analyzeBusyLabel}
      analyzeBannerLabel={analyzeBannerLabel}
      analyzePhase={analyzePhase}
      analyzeProgress={analyzeProgress}
      analyzeState={analyzeState}
      onAnalyzeStoryboard={handleAnalyzeStoryboard}
      onStaleCleanupOpen={() => setStaleCleanupOpen(true)}
      autoGroup={autoGroup}
      onAutoGroup={handleAutoGroup}
      multiShotState={multiShotState}
      onSubmitMultiShot={handleSubmitMultiShot}
      batchImageState={batchImageState}
      batchVideoState={batchVideoState}
      onBatchGenerateImages={handleBatchGenerateImages}
      onBatchGenerateVideos={handleBatchGenerateVideos}
      imageInFlight={imageInFlight}
      setImageInFlight={setImageInFlight}
      videoInFlight={videoInFlight}
      serverInflightPanelImageIds={serverInflightPanelImageIds}
      serverInflightPanelVideoIds={serverInflightPanelVideoIds}
      failedPanelImageIds={failedPanelImageIds}
      failedPanelVideoIds={failedPanelVideoIds}
      isCurrentPanelImageInFlight={isCurrentPanelImageInFlight}
      isCurrentPanelVideoInFlight={isCurrentPanelVideoInFlight}
      regenPanel={regenPanel}
      generateVideo={generateVideo}
      updatePanelText={updatePanelText}
      updatePanel={updatePanel}
      activePanelImageTasks={activePanelImageTasks}
      onGenerateVideo={handleGenerateVideo}
      descDraft={descDraft}
      setDescDraft={setDescDraft}
      descChanged={descChanged}
      onSaveDescription={handleSaveDescription}
      dialogueDraft={dialogueDraft}
      setDialogueDraft={setDialogueDraft}
      dialogueChanged={dialogueChanged}
      onSaveDialogue={handleSaveDialogue}
      characterRoster={characterRoster}
      episodeBindings={episodeBindings}
      zoomImageUrl={zoomImageUrl}
      setZoomImageUrl={setZoomImageUrl}
    />
  )
}


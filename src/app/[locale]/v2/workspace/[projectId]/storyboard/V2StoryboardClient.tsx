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
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { VideoModelPickerInline } from './VideoModelPickerInline'
import { getVideoModelVariant, isMultiShotCapable } from '@/lib/video-models/variants'
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
import { MultiShotBindingsRail } from './MultiShotBindingsRail'
import { V2GroupsLayout } from './V2GroupsLayout'
import { V2ManualPanelModal, type ManualPanelDraft } from './V2ManualPanelModal'
import { StaleStoryboardCleanupModal } from './StaleStoryboardCleanupModal'
import { resolveErrorDisplay } from '@/lib/errors/display'

interface V2StoryboardClientProps {
  projectId: string
}

interface PanelCharacterRef {
  name: string
  appearance?: string
}

interface PanelLike {
  id: string
  storyboardId?: string | null
  panelIndex?: number | null
  description?: string | null
  srtSegment?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  prompt?: string | null
  videoPrompt?: string | null
  shotType?: string | null
  cameraMove?: string | null
  location?: string | null
  // Decoded server-side; see storyboards API route.
  characters?: PanelCharacterRef[] | null
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
}

interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

interface ProjectLikeFull {
  novelPromotionData?: {
    videoModel?: string | null
    videoRatio?: string | null
    videoResolution?: string | null
    episodes?: Array<{ id: string }> | null
    // 2026-05-18 — top-level column on NovelPromotionProject. The Seedance
    // narrative builder uses it to drive the styleAnchor + visualModifiers
    // footer (replacing the old hardcoded cinematic terms) and the worker
    // reads it server-side for negative_prompt resolution.
    visualStyleId?: string | null
    // Phase Q (2026-05-21) — episode target total video duration in
    // seconds. Drives script_to_storyboard panel count + auto_group_multi_shot
    // group count. Exposed via VideoModelPickerInline so user can edit
    // inline from STEP 03.
    targetDuration?: number | null
  } | null
}

/**
 * Build a tailwind aspect-ratio class from a "W:H" project setting.
 * Supports the same set of ratios Tencent VOD GG/Kling expose
 * (1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9 / 2:3 / 3:2). Anything else
 * falls back to 16:9 so the layout doesn't break when the project
 * setting is malformed or absent.
 */
function aspectClassFromRatio(ratio: string | null | undefined): string {
  if (!ratio) return 'aspect-video'
  const trimmed = ratio.trim()
  switch (trimmed) {
    case '1:1':  return 'aspect-square'
    case '16:9': return 'aspect-video'
    case '9:16': return 'aspect-[9/16]'
    case '4:3':  return 'aspect-[4/3]'
    case '3:4':  return 'aspect-[3/4]'
    case '3:2':  return 'aspect-[3/2]'
    case '2:3':  return 'aspect-[2/3]'
    case '21:9': return 'aspect-[21/9]'
    default: {
      const [w, h] = trimmed.split(':').map((n) => Number.parseFloat(n))
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return `aspect-[${w}/${h}]`
      }
      return 'aspect-video'
    }
  }
}

type MultiShotState =
  | { status: 'idle' }
  | { status: 'submitting'; sent: number; total: number }
  | { status: 'done'; sent: number; failures: number }
  | { status: 'error'; message: string }

type AnalyzeState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'submitted' }
  | { status: 'error'; message: string }

const KLING_GROUP_SIZE = 5 // panel/group; API allows 2-6

// 6 distinct accent colours for multi-shot group ribbons. Cycles if more
// groups than colours (rare — typical episode has 5-8 groups for 25-40 panels).
const GROUP_ACCENTS = [
  'border-l-amber-500',
  'border-l-rose-500',
  'border-l-emerald-500',
  'border-l-sky-500',
  'border-l-violet-500',
  'border-l-orange-500',
] as const

function accentForGroupId(groupId: string | null | undefined, allGroupIds: string[]): string {
  if (!groupId) return 'border-l-transparent'
  const idx = allGroupIds.indexOf(groupId)
  if (idx < 0) return 'border-l-transparent'
  return GROUP_ACCENTS[idx % GROUP_ACCENTS.length]
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return []
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  // The last chunk could be of size 1, which the API rejects. Merge it
  // into the previous chunk if there is one.
  if (out.length >= 2 && out[out.length - 1].length === 1) {
    const tail = out.pop() as T[]
    out[out.length - 1].push(tail[0])
  }
  return out
}

export function V2StoryboardClient({ projectId }: V2StoryboardClientProps) {
  const queryClient = useQueryClient()
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLikeFull | undefined
  // Phase 12.5 — viewer-role users see disabled mutation buttons across
  // the storyboard page + per-group cards (passed via GroupCard prop).
  const { canEdit } = useProjectAccess(projectId)
  const viewerTip = canEdit ? undefined : '你是 viewer · 唯讀模式 · 編輯按鈕需要請求權限'
  const projectVideoRatio = project?.novelPromotionData?.videoRatio ?? '16:9'
  // 2026-05-22 — project-level resolution choice (480p / 720p / 1080p).
  // Threaded into every multi-shot dispatch so ARK Seedance 2.0 worker
  // honors user pick instead of always defaulting to 720p. taijiai /
  // atlascloud / fal Seedance routes ignore this (their model id bakes
  // resolution).
  const projectVideoResolution = (project?.novelPromotionData?.videoResolution ?? '720p') as '480p' | '720p' | '1080p'
  const aspectClass = aspectClassFromRatio(projectVideoRatio)
  const projectVideoModel = project?.novelPromotionData?.videoModel ?? ''
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

  const [multiShotState, setMultiShotState] = useState<MultiShotState>({ status: 'idle' })
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>({ status: 'idle' })
  // 2026-05-13 — Selected Shot 圖/視頻顯示切換。
  // 以前 render 只看 videoUrl 有無 → 一旦 panel 跑過 B 路徑就只能看視頻、
  // 看不回原圖（user 報「無法切回去圖」）。改成 per-panel override：
  // - 沒紀錄 → auto（有 video 顯示 video，否則顯示 image，等同舊行為）
  // - user 點 toggle → 紀錄 'image' / 'video'，下次選回同個 panel 還記得
  type MediaDisplayMode = 'image' | 'video'
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
      ? '提交中…'
      : analyzePhase === 'queued'
        ? '排隊中…'
        : analyzePhase === 'processing'
          ? `分析中… ${analyzeProgress}%`
          : '重新分析'
  const analyzeBannerLabel =
    analyzePhase === 'submitting'
      ? '正在提交分析任務…'
      : analyzePhase === 'queued'
        ? '任務已排隊,等 worker 開始處理(約 3-10 秒)…'
        : analyzePhase === 'processing'
          ? `正在重新分析劇本… ${analyzeProgress}% — 完成後分鏡會自動刷新`
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
  }, [analyzeStatus, currentEpisodeId, queryClient, analyzeState.status])

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
      { onError: (err) => alert(err instanceof Error ? err.message : '儲存描述詞失敗') },
    )
  }
  function handleSaveDialogue() {
    if (!selected) return
    updatePanelText.mutate(
      { panelId: selected.id, srtSegment: dialogueDraft },
      { onError: (err) => alert(err instanceof Error ? err.message : '儲存對話失敗') },
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
      alert('專案還沒選視頻模型 — 請從分鏡頂部的「視頻模型」picker 選一個（Seedance 或 Kling）')
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
        onError: (err) => alert(err instanceof Error ? err.message : '提交視頻生成失敗'),
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
      setAnalyzeState({ status: 'error', message: '請先選擇集數並貼好劇本' })
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
        throw new Error(display?.message ?? `提交失敗 (HTTP ${res.status})`)
      }
      setAnalyzeState({ status: 'submitted' })
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
      void analyzeSnapshot.refetch()
    } catch (err) {
      setAnalyzeState({
        status: 'error',
        message: err instanceof Error ? err.message : '提交失敗',
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
      alert('請先選一集再新增分鏡')
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
          throw new Error('無法建立分鏡組,請重試')
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
      alert(`建立失敗:${(err as Error)?.message ?? '未知錯誤'}`)
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
      alert('專案還沒選視頻模型 — 請從分鏡頂部的「視頻模型」picker 選一個（Seedance 或 Kling）')
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
        message: '請從分鏡頂部的「視頻模型」picker 選一個支援多鏡頭的變體(Kling 系列或 Seedance 2.0 720p BobAPI)',
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
        message: `「${videoModel}」不支援多鏡頭。請從分鏡頂部的視頻模型 picker 切到 Kling 或 Seedance 2.0 720p (BobAPI)。`,
      })
      return
    }
    // B path = Tencent VOD Kling-3 / Omni / O1 (text-to-video with
    // multi_shot=intelligence). Panels without imageUrl are still
    // eligible because the model goes straight from text to video.
    // Seedance composite (BobAPI taijiai::) also tolerates text-only panels
    // (falls back to project's character/scene refs).
    // AtlasCloud composite (atlascloud::seedance-2.0-*) also tolerates
    // text-only panels: t2v uses no images at all; i2v/r2v fall back to
    // character/scene refs when panels are imageless.
    // C path (Kling i2v) needs imageUrl for first-frame.
    const isBPath = /^tencent-vod::Kling-(3|O1)/i.test(videoModel)
    const isSeedanceComposite = /^taijiai::seedance-2\.0/i.test(videoModel)
    const isAtlasCloudComposite = /^atlascloud::seedance-2\.0/i.test(videoModel)
    const tolerateTextOnly = isBPath || isSeedanceComposite || isAtlasCloudComposite
    const eligible = tolerateTextOnly
      ? allPanels
      : allPanels.filter((p) => Boolean(p.imageUrl))
    if (eligible.length < 2) {
      setMultiShotState({
        status: 'error',
        message: tolerateTextOnly
          ? '至少需要 2 個分鏡才能跑 multi-shot'
          : '至少需要 2 個有圖的分鏡才能跑 multi-shot(或切到支援 t2v 的模型,免生圖)',
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
        message: '沒有可送出的 multi-shot 群組',
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
            sound: true,
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
        <p className="font-mono text-xs tracking-wider text-stone-500">載入中…</p>
      </div>
    )
  }

  if (!currentEpisodeId) {
    return (
      <div className="px-12 py-10">
        <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
          <p className="font-fraunces text-base italic text-stone-400">
            此 project 還沒有 episode — 請先到劇本 step 跑 LLM 分析
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
        ? '重新分析'
        : '一鍵生成分鏡'
    return (
      <div className="px-12 py-10">
        <div className="rounded-sm border border-amber-500/30 bg-amber-500/5 p-8 text-center">
          <div className="mx-auto max-w-xl space-y-4">
            <div className="font-fraunces text-lg italic text-amber-400">
              {currentEpisode ? `為「${currentEpisode.name}」生成分鏡` : '一鍵生成分鏡'}
            </div>
            <p className="font-serif-cn text-sm leading-relaxed text-stone-400">
              從劇本自動拆解成多個鏡頭 — 由 LLM 依場景/角色連續性切組,
              生成後可在每個分鏡卡片做圖像 / 視頻 / 提示詞調整。
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
                提交失敗:{analyzeState.message}
              </p>
            ) : null}
            {analyzeStatus === 'failed' && (analyzeErrorDisplay || analyzeError) ? (
              <p
                className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
                title={analyzeError ?? undefined}
              >
                上次分析失敗:{analyzeErrorDisplay?.message ?? '請點「重新分析」重試'}
              </p>
            ) : null}
            {!currentEpisodeId ? (
              <p className="font-mono text-[14px] tracking-wider text-stone-500">
                沒有可用集數 — 請先回上方分頁建立或選擇集數,並到劇本 step 貼劇本
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
        title="畫廊版面 — 直幅 9:16 友善(每分鏡圖驅動)"
        className={`px-2.5 py-1.5 font-mono text-[14px] tracking-wider transition-colors ${
          layoutMode === 'gallery'
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-stone-500 hover:text-amber-400'
        }`}
      >
        ▦ 畫廊
      </button>
      <button
        type="button"
        onClick={() => setLayoutMode('timeline')}
        title="時間軸版面 — 橫幅 16:9 友善(每分鏡圖驅動)"
        className={`px-2.5 py-1.5 font-mono text-[14px] tracking-wider transition-colors ${
          layoutMode === 'timeline'
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-stone-500 hover:text-amber-400'
        }`}
      >
        ☰ 時間軸
      </button>
      <button
        type="button"
        onClick={() => setLayoutMode('groups')}
        title="多鏡頭版面 — 文字驅動(Kling-3 / Omni B-path,免生圖)"
        className={`px-2.5 py-1.5 font-mono text-[14px] tracking-wider transition-colors ${
          layoutMode === 'groups'
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-stone-500 hover:text-amber-400'
        }`}
      >
        ◷ 多鏡頭
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
          characters={characterRoster.map((c) => ({ id: c.id, name: c.name ?? '未命名角色' }))}
          locations={locationRoster.map((l) => ({ id: l.id, name: l.name ?? '未命名場景' }))}
          onSubmit={handleManualPanelSubmit}
          onClose={() => setManualPanelOpen(false)}
          isSubmitting={manualPanelSubmitting}
          contextHint={
            (storyboardsData?.storyboards?.length ?? 0) === 0
              ? '本集還沒有分鏡組,送出時會自動建立第一組'
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
  if (layoutMode === 'groups') {
    // 2026-05-18 — toolbar reorganized into 3 rows so 16+ elements aren't
    // crammed into one line. Old layout was visually exhausting + the
    // primary CTA (多鏡頭合成) competed for attention with secondary
    // affordances. New rows:
    //   1. Layout toggle  (right-aligned, identity only)
    //   2. State + video model picker (state row, no actions here)
    //   3. Actions split into two clusters:
    //        LEFT  — data ops (new / re-analyse / cleanup) — muted stone
    //        RIGHT — workflow ops (auto-group / composite) — accent
    //        Primary CTA "多鏡頭合成" sits at the far right with stronger
    //        visual weight (filled bg, brighter border) so the eye lands
    //        on the next step.
    const groupsToolbar = (
      <div className="flex flex-col gap-3">
        {/* Row 1: layout toggle */}
        <div className="flex justify-end">{layoutToggleNode}</div>

        {/* Row 2: state badge + video model picker (wraps on narrow screens) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {hasGroups ? (
            <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-emerald-400">
              ◷ {orderedGroupIds.length} GROUPS · {groupedPanelCount}/{allPanels.length} 已切組
            </span>
          ) : null}
          {videoModelPickerNode}
        </div>

        {/* Row 3: actions, split into data ops (left) + workflow ops (right) */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* LEFT cluster — data ops (muted stone style, secondary) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!currentEpisodeId || manualPanelSubmitting}
              onClick={() => setManualPanelOpen(true)}
              title="自己寫提示詞 + 選角色場景,單一鏡頭手動建立"
              className="flex items-center gap-1.5 rounded-sm border border-stone-700 bg-stone-900/50 px-3 py-1.5 font-mono text-[13px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="plus" className="h-3 w-3" />
              手動新增
            </button>
            <button
              type="button"
              disabled={analyzeBusy || !currentEpisodeId || !canEdit}
              onClick={handleAnalyzeStoryboard}
              title="重新從劇本生成分鏡"
              className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-mono text-[13px] tracking-wider transition-all disabled:cursor-not-allowed ${
                analyzeBusy
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                  : 'border-stone-700 bg-stone-900/50 text-stone-300 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300 disabled:opacity-50'
              }`}
            >
              <AppIcon name="sparklesAlt" className={`h-3 w-3 ${analyzeBusy ? 'animate-pulse' : ''}`} />
              {analyzeBusyLabel}
            </button>
            <button
              type="button"
              disabled={!currentEpisodeId}
              onClick={() => setStaleCleanupOpen(true)}
              title="再分析失敗時舊分鏡會殘留 — 從這裡挑出多餘的分鏡來源刪掉"
              className="flex items-center gap-1.5 rounded-sm border border-stone-700 bg-stone-900/50 px-3 py-1.5 font-mono text-[13px] tracking-wider text-stone-300 transition-all hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              整理來源
            </button>
          </div>

          {/* RIGHT cluster — workflow ops; 自動切組 violet (prep), 多鏡頭合成 amber filled (primary CTA) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              // 2026-05-21 — also disable while analyzeBusy so user doesn't
              // trigger 自動切組 against an incomplete panel list (script
              // analysis at 65% means more panels are still arriving — LLM
              // would group only the ones persisted so far → user has to
              // re-group after analysis finishes anyway).
              disabled={autoGroup.isPending || !currentEpisodeId || allPanels.length < 2 || analyzeBusy || !canEdit}
              onClick={() => autoGroup.mutate({ episodeId: currentEpisodeId! })}
              title={
                analyzeBusy
                  ? '劇本分析中,等分鏡全部生成完再切組(不然 LLM 只會看到目前已有的分鏡)'
                  : autoGroup.isPending
                    ? '切組中…'
                    : '把分鏡按對白 / 角色 / 場景連續性切成 multi-shot 群,並依目標時長分配秒數'
              }
              className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[13px] tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              {autoGroup.isPending ? '切組中…' : analyzeBusy ? '切組(分析中)' : '自動切組'}
            </button>
            <button
              type="button"
              disabled={multiShotState.status === 'submitting' || !canMultiShot}
              onClick={handleSubmitMultiShot}
              title={
                !canMultiShot
                  ? '當前模型不支援多鏡頭 — 請從上方視頻模型 picker 切到 Kling 或 Seedance 2.0 720p (BobAPI)'
                  : videoFamily === 'seedance'
                    ? '每個 group 合成為一支 4-15s 影片(Seedance BobAPI 9-ref @N 合成)'
                    : '把所有 group 一次送 Kling 多鏡頭'
              }
              className="flex items-center gap-1.5 rounded-sm border border-amber-500/60 bg-amber-500/25 px-3.5 py-1.5 font-mono text-[14px] font-semibold tracking-wider text-amber-100 shadow-sm shadow-amber-500/10 transition-all hover:border-amber-400 hover:bg-amber-500/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
              {multiShotState.status === 'submitting'
                ? `送出中 ${multiShotState.sent}/${multiShotState.total}`
                : videoFamily === 'seedance'
                  ? '多鏡頭合成'
                  : '智能多鏡頭'}
            </button>
          </div>
        </div>
      </div>
    )
    return (
      <>
      {globalOverlaysNode}
      <V2GroupsLayout
        projectId={projectId}
        panels={allPanels}
        orderedGroupIds={orderedGroupIds}
        taskByGroup={taskByGroup}
        toolbarNode={groupsToolbar}
        updatePanelText={updatePanelText}
        characterRoster={characterRoster}
        locationRoster={locationRoster}
        episodeBindings={episodeBindings}
        episodeNumber={(currentEpisode as { episodeNumber?: number } | null)?.episodeNumber ?? null}
        canMultiShot={canMultiShot}
        videoFamily={videoFamily}
        projectVisualStyleId={project?.novelPromotionData?.visualStyleId ?? null}
        canEdit={canEdit}
        viewerTip={viewerTip}
        targetDurationSec={project?.novelPromotionData?.targetDuration ?? null}
        onRegenerateGroup={async (groupId, panelIds, overrides) => {
          if (!projectVideoModel) {
            return { taskId: null, error: '尚未設定視頻模型 — 請從分鏡頂部的「視頻模型」picker 選一個 Kling 或 Seedance 2.0 720p (BobAPI) 模型' }
          }
          // 2026-05-17 — use the variant registry's capability bit so this
          // gate stays in sync with the inline picker + handleSubmitMultiShot.
          // Fails closed for unknown ids (legacy DB rows).
          if (!isMultiShotCapable(projectVideoModel)) {
            return {
              taskId: null,
              error: `「${projectVideoModel}」不支援多鏡頭。請從分鏡頂部的視頻模型 picker 切到 Kling 或 Seedance 2.0 720p (BobAPI)。`,
            }
          }
          try {
            const body: Record<string, unknown> = {
              panelIds,
              videoModel: projectVideoModel,
              aspectRatio: projectVideoRatio,
              resolution: projectVideoResolution,
              sound: true,
              async: true,
              meta: { locale: 'zh-TW' },
            }
            if (overrides.characterOverrides.length > 0) {
              body.characterOverrides = overrides.characterOverrides
            }
            if (overrides.locationOverrides.length > 0) {
              body.locationOverrides = overrides.locationOverrides
            }
            // Phase 2 segment-level overrides — flow through to the
            // multi-shot API contract Session A defined.
            if (overrides.rawPrompt && overrides.rawPrompt.length > 0) {
              body.rawPrompt = overrides.rawPrompt
            }
            if (
              Array.isArray(overrides.panelDurations)
              && overrides.panelDurations.length === panelIds.length
            ) {
              body.panelDurations = overrides.panelDurations
            }
            // Phase P (2026-05-21) — totalDurationSeconds atomic field.
            // Forwarded EVEN WHEN panelDurations is omitted (sendRaw path).
            // Workers use as tier-1.5 fallback so user's 15s pick survives
            // the narrative-edit gate.
            if (
              typeof overrides.totalDurationSeconds === 'number'
              && Number.isFinite(overrides.totalDurationSeconds)
              && overrides.totalDurationSeconds > 0
            ) {
              body.totalDurationSeconds = overrides.totalDurationSeconds
            }
            // 2026-05-13 — Option B 首幀鎖定. When set, worker switches
            // to Kling 3.0 i2v single-shot path and drops multi_shot.
            if (overrides.firstFrameImageUrl) {
              body.firstFrameImageUrl = overrides.firstFrameImageUrl
            }
            if (overrides.lastFrameImageUrl) {
              body.lastFrameImageUrl = overrides.lastFrameImageUrl
            }
            const res = await fetch(
              `/api/novel-promotion/${projectId}/generate-multi-shot-video`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              },
            )
            if (!res.ok) {
              let errMessage = `送出失敗 (${res.status})`
              try {
                const errBody = await res.json()
                if (errBody && typeof errBody.message === 'string') errMessage = errBody.message
                else if (errBody?.error?.code) errMessage = `送出失敗:${errBody.error.code}`
              } catch {
                // body not JSON — keep status fallback
              }
              return { taskId: null, error: errMessage }
            }
            const respBody = (await res.json()) as { taskId?: unknown }
            const taskId = typeof respBody?.taskId === 'string' && respBody.taskId.length > 0
              ? respBody.taskId
              : null
            if (taskId) {
              setTaskByGroup((prev) => ({ ...prev, [groupId]: taskId }))
            }
            return { taskId }
          } catch (err) {
            return {
              taskId: null,
              error: err instanceof Error ? err.message : '送出失敗',
            }
          }
        }}
      />
      </>
    )
  }

  // ─── Gallery layout (default) ────────────────────────────────────
  // 60/40 split: left main grid of panel cards at the project's
  // actual videoRatio, right side selected-shot preview + edit form.
  if (layoutMode === 'gallery') {
    const selectedIdxForGallery = allPanels.findIndex((p) => p.id === selected?.id)
    return (
      <>
      {globalOverlaysNode}
      <div className="flex h-full flex-col">
        {/* Top toolbar — analyze + autogroup + layout toggle
            (2026-05-12: split into two rows — view toggle on top,
            title + action cluster below — same as Groups layout) */}
        <div className="border-b border-amber-900/15 px-8 pb-3 pt-5">
          <div className="flex flex-col gap-2">
            <div className="flex justify-end">{layoutToggleNode}</div>
            {/* 2026-05-19 — picker mirrored from groups toolbar so gallery
                users can see/change the current video model without
                switching layouts. Wrap-aware; sits on its own row to
                avoid crowding the existing title+actions row below. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {videoModelPickerNode}
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="font-fraunces text-sm italic text-amber-500/80">分鏡</div>
                {hasGroups ? (
                  <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-emerald-400">
                    {orderedGroupIds.length} GROUPS · {groupedPanelCount}/{allPanels.length} 已切組
                  </span>
                ) : null}
                <div className="font-mono text-[14px] tracking-wider text-stone-500">
                  {allPanels.length} SHOTS · 比例 {projectVideoRatio}
                </div>
              </div>
              <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={analyzeBusy || !currentEpisodeId || !canEdit}
                onClick={handleAnalyzeStoryboard}
                title="重新從劇本生成分鏡(會覆蓋現有分鏡)"
                className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className={`h-3 w-3 ${analyzeBusy ? 'animate-pulse' : ''}`} />
                {analyzeBusy ? analyzeBusyLabel : '↻ 重新分析'}
              </button>
              <button
                type="button"
                disabled={!currentEpisodeId}
                onClick={() => setStaleCleanupOpen(true)}
                title="再分析失敗時舊分鏡會殘留 — 從這裡挑出多餘的分鏡來源刪掉"
                className="flex items-center gap-1.5 rounded-sm border border-stone-600 bg-stone-900/40 px-3 py-1.5 font-mono text-[14px] tracking-wider text-stone-300 transition-all hover:border-stone-500 hover:bg-stone-800/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                整理分鏡來源
              </button>
              <button
                type="button"
                disabled={autoGroup.isPending || allPanels.length < 2 || analyzeBusy || !canEdit}
                onClick={handleAutoGroup}
                title={
                  analyzeBusy
                    ? '劇本分析中,等分鏡全部生成完再切組(不然 LLM 只會看到目前已有的分鏡)'
                    : 'LLM 按對白完整性 / 角色 / 場景連續性切成 2-6 個 panel/群,依目標時長算秒數'
                }
                className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {autoGroup.isPending ? '切組中…' : analyzeBusy ? '切組(分析中)' : hasGroups ? '↻ 重新切組' : '🧠 智能切組'}
              </button>
              <button
                type="button"
                onClick={() => handleSubmitMultiShot()}
                disabled={multiShotState.status === 'submitting' || !canMultiShot}
                title={
                  !canMultiShot
                    ? '當前模型不支援多鏡頭 — 請從上方視頻模型 picker 切到 Kling 或 Seedance 2.0 720p (BobAPI)'
                    : videoFamily === 'seedance'
                      ? '每個 group 合成為一支 4-15s 影片(Seedance BobAPI 9-ref @N 合成)'
                      : '把分鏡送 Kling multi-shot 一次出多鏡頭視頻'
                }
                className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {multiShotState.status === 'submitting'
                  ? `送出中 ${multiShotState.sent}/${multiShotState.total}`
                  : videoFamily === 'seedance'
                    ? '多鏡頭合成'
                    : '智能多鏡頭'}
              </button>
              </div>
            </div>
          </div>
          {analyzeBusy ? (
            <div className="mt-2 flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
              <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-amber-400" />
              <span>{analyzeBannerLabel}</span>
              {analyzePhase === 'processing' ? (
                <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-stone-900/60">
                  <div
                    className="h-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${Math.max(2, Math.min(100, analyzeProgress))}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {multiShotState.status === 'done' ? (
            <div className="mt-2 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
              ✓ 已送出 {multiShotState.sent} 個 multi-shot 任務
              {multiShotState.failures > 0 ? `(${multiShotState.failures} 組失敗)` : ''}
            </div>
          ) : null}
          {multiShotState.status === 'error' ? (
            <div className="mt-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
              {multiShotState.message}
            </div>
          ) : null}
        </div>

        {/* Main 60/40 split */}
        <div className="grid flex-1 grid-cols-[1.5fr_1fr] gap-0 overflow-hidden">
          {/* Left: gallery grid */}
          <div className="overflow-y-auto px-8 py-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {allPanels.map((p, i) => {
                const active = p.id === selected?.id
                const accent = accentForGroupId(p.multiShotGroupId, orderedGroupIds)
                const localImg = imageInFlight.has(p.id)
                const localVid = videoInFlight.has(p.id)
                const remoteImg = serverInflightPanelImageIds.has(p.id)
                const remoteVid = serverInflightPanelVideoIds.has(p.id)
                const isImg = localImg || remoteImg
                const isVid = localVid || remoteVid
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`group flex flex-col overflow-hidden rounded-sm border-l-4 border-y border-r text-left transition-all ${accent} ${
                      active
                        ? 'border-amber-500/60 ring-2 ring-amber-500/20'
                        : 'border-stone-800/60 hover:border-amber-500/40'
                    }`}
                  >
                    <div className={`relative ${aspectClass} bg-gradient-to-br from-stone-800 to-stone-900`}>
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={`#${i + 1}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <AppIcon name="image" className="h-7 w-7 text-stone-600" />
                        </div>
                      )}
                      <div className="absolute left-2 top-2 rounded bg-stone-950/60 px-2 py-0.5 font-mono text-[14px] text-stone-200 backdrop-blur-sm">
                        #{String(i + 1).padStart(2, '0')}
                      </div>
                      {p.videoUrl ? (
                        <div className="absolute bottom-2 right-2 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[12px] text-stone-950 backdrop-blur-sm">
                          ▶ 視頻
                        </div>
                      ) : null}
                      {isImg || isVid ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-stone-950/75 backdrop-blur-sm">
                          <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-amber-400" />
                          <div className="font-mono text-[12px] tracking-wider text-amber-300">
                            {isVid ? '視頻生成中' : '圖生成中'}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="bg-stone-900/40 px-3 py-2">
                      <div className="line-clamp-2 font-serif-cn text-xs leading-snug text-stone-200">
                        {p.description?.slice(0, 60) ?? `分鏡 ${i + 1}`}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right: selected shot detail */}
          <aside className="overflow-y-auto border-l border-amber-900/15 bg-stone-950/40 px-6 py-6">
            {selected ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-fraunces text-base italic text-amber-500/80">
                    鏡頭 {String(selectedIdxForGallery + 1).padStart(2, '0')}
                  </div>
                  <div className="font-mono text-[14px] tracking-wider text-stone-500">
                    {selected.videoUrl ? '✓ 視頻已生成' : selected.imageUrl ? '圖已生成' : '尚未生成'}
                  </div>
                </div>
                <div className={`relative mx-auto max-h-[480px] max-w-[280px] overflow-hidden rounded-sm border border-stone-800 ${aspectClass} bg-gradient-to-br from-stone-800 to-stone-900`}>
                  {selected.videoUrl ? (
                    <video
                      key={selected.id + ':' + selected.videoUrl}
                      src={selected.videoUrl}
                      poster={selected.imageUrl ?? undefined}
                      controls
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : selected.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.imageUrl} alt="selected" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <AppIcon name="image" className="h-8 w-8 text-stone-600" />
                    </div>
                  )}
                  {isCurrentPanelVideoInFlight || isCurrentPanelImageInFlight ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/75 backdrop-blur-sm">
                      <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-amber-400" />
                      <div className="font-fraunces text-sm italic text-amber-300">
                        {isCurrentPanelVideoInFlight ? '視頻生成中' : '圖片生成中'}
                      </div>
                      <div className="px-3 text-center font-serif-cn text-[14px] text-stone-300">
                        30-60 秒,完成後自動更新
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!selected || regenPanel.isPending || !canEdit}
                    onClick={() => {
                      if (!selected) return
                      const panelIdAtSubmit = selected.id
                      regenPanel.mutate(
                        { panelId: panelIdAtSubmit },
                        {
                          onSuccess: () => {
                            setImageInFlight((prev) => {
                              const next = new Set(prev)
                              next.add(panelIdAtSubmit)
                              return next
                            })
                            void activePanelImageTasks.refetch()
                          },
                        },
                      )
                    }}
                    className="rounded-sm border border-stone-800 bg-stone-900/50 py-2 font-serif-cn text-xs text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50"
                  >
                    {regenPanel.isPending
                      ? '提交中…'
                      : selected?.imageUrl
                        ? '↻ 重新生成圖'
                        : '生成圖片'}
                  </button>
                  <button
                    type="button"
                    disabled={!selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
                    onClick={() => handleGenerateVideo()}
                    className="rounded-sm border border-amber-500/40 bg-amber-500/10 py-2 font-serif-cn text-xs text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {generateVideo.isPending
                      ? '提交中…'
                      : isCurrentPanelVideoInFlight
                        ? '生成中…'
                        : selected.videoUrl
                          ? '↻ 重生視頻'
                          : '生成視頻'}
                  </button>
                </div>

                {/* 2026-05-17 — fal Seedance per-shot override row (mini).
                    Mirrors the Selected Shot card's secondary row below
                    the main 生成視頻 CTA. Compact labels (Seedance / Fast)
                    because the panel-card mini area is narrow. */}
                <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-stone-500">
                  <span className="shrink-0">fal Seedance →</span>
                  <button
                    type="button"
                    disabled={!selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
                    onClick={() => handleGenerateVideo('fal::bytedance/seedance-2.0/image-to-video')}
                    title="fal Seedance 2.0 (1080p + native audio, ~$0.3-0.5/支)"
                    className="flex flex-1 items-center justify-center rounded-sm border border-stone-700 bg-stone-900/40 py-1 font-serif-cn text-[11px] text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50"
                  >
                    Seedance
                  </button>
                  <button
                    type="button"
                    disabled={!selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
                    onClick={() => handleGenerateVideo('fal::bytedance/seedance-2.0/fast/image-to-video')}
                    title="fal Seedance 2.0 Fast (cheap variant, ~$0.1-0.2/支,稍弱)"
                    className="flex flex-1 items-center justify-center rounded-sm border border-stone-700 bg-stone-900/40 py-1 font-serif-cn text-[11px] text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50"
                  >
                    Fast
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="font-mono text-[14px] tracking-wider text-amber-600">描述詞</div>
                      <button
                        type="button"
                        onClick={handleSaveDescription}
                        disabled={!descChanged || updatePanelText.isPending || !selected || !canEdit}
                        className="rounded-sm border border-amber-500/40 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                      >
                        {updatePanelText.isPending ? '儲存中…' : '儲存'}
                      </button>
                    </div>
                    <textarea
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      rows={4}
                      className="w-full rounded-sm border border-stone-800 bg-stone-900/50 p-2 font-body text-xs text-stone-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="font-mono text-[14px] tracking-wider text-amber-600">對話</div>
                      <button
                        type="button"
                        onClick={handleSaveDialogue}
                        disabled={!dialogueChanged || updatePanelText.isPending || !selected || !canEdit}
                        className="rounded-sm border border-amber-500/40 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                      >
                        {updatePanelText.isPending ? '儲存中…' : '儲存'}
                      </button>
                    </div>
                    <textarea
                      value={dialogueDraft}
                      onChange={(e) => setDialogueDraft(e.target.value)}
                      rows={3}
                      placeholder="這個鏡頭的台詞 / 旁白 / 字幕"
                      className="w-full rounded-sm border border-stone-800 bg-stone-900/50 p-2 font-body text-xs text-stone-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                </div>

                {selectedGroupTaskId ? (
                  <div className="mt-3">
                    <MultiShotBindingsRail
                      taskId={selectedGroupTaskId}
                      groupLabel={selectedGroupLabel}
                      projectId={projectId}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  <a
                    href={selected.imageUrl ?? '#'}
                    download={selected.imageUrl ? `panel-${(selectedIdxForGallery + 1).toString().padStart(2, '0')}.jpg` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!selected.imageUrl}
                    onClick={(e) => { if (!selected.imageUrl) e.preventDefault() }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-stone-800 py-1.5 font-mono text-[14px] tracking-wider transition-all ${selected.imageUrl ? 'text-stone-400 hover:border-amber-500/40 hover:text-amber-400' : 'cursor-not-allowed text-stone-600 opacity-50'}`}
                  >
                    <AppIcon name="download" className="h-3 w-3" />
                    下載圖
                  </a>
                  <a
                    href={selected.videoUrl ?? '#'}
                    download={selected.videoUrl ? `panel-${(selectedIdxForGallery + 1).toString().padStart(2, '0')}.mp4` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!selected.videoUrl}
                    onClick={(e) => { if (!selected.videoUrl) e.preventDefault() }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-stone-800 py-1.5 font-mono text-[14px] tracking-wider transition-all ${selected.videoUrl ? 'text-stone-400 hover:border-amber-500/40 hover:text-amber-400' : 'cursor-not-allowed text-stone-600 opacity-50'}`}
                  >
                    <AppIcon name="download" className="h-3 w-3" />
                    下載影片
                  </a>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <p className="font-fraunces text-sm italic text-stone-500">點左邊任一分鏡進行編輯</p>
              </div>
            )}
          </aside>
        </div>
      </div>
      </>
    )
  }

  // ─── Timeline layout (existing) ──────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Top: panel strip
          (2026-05-12: split toolbar into two rows — view toggle on top,
          title + action cluster below — same as Gallery / Groups) */}
      <div className="border-b border-amber-900/15 px-12 pb-4 pt-6">
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex justify-end">{layoutToggleNode}</div>
          {/* 2026-05-19 — picker mirrored from groups toolbar so timeline
              users can see/change the current video model without
              switching layouts (matches gallery treatment). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {videoModelPickerNode}
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="font-fraunces text-sm italic text-amber-500/80">Storyboard Strip</div>
              {hasGroups ? (
                <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-emerald-400">
                  {orderedGroupIds.length} GROUPS · {groupedPanelCount}/{allPanels.length} 已切組
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={analyzeBusy || !currentEpisodeId || !canEdit}
              onClick={handleAnalyzeStoryboard}
              title="重新從劇本生成分鏡(會覆蓋現有分鏡)"
              className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className={`h-3 w-3 ${analyzeBusy ? 'animate-pulse' : ''}`} />
              {analyzeBusy ? analyzeBusyLabel : '↻ 重新分析'}
            </button>
            <button
              type="button"
              disabled={!currentEpisodeId}
              onClick={() => setStaleCleanupOpen(true)}
              title="再分析失敗時舊分鏡會殘留 — 從這裡挑出多餘的分鏡來源刪掉"
              className="flex items-center gap-1.5 rounded-sm border border-stone-600 bg-stone-900/40 px-3 py-1.5 font-mono text-[14px] tracking-wider text-stone-300 transition-all hover:border-stone-500 hover:bg-stone-800/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              整理分鏡來源
            </button>
            <button
              type="button"
              disabled={autoGroup.isPending || allPanels.length < 2 || !canEdit}
              onClick={handleAutoGroup}
              title="LLM 把分鏡按場景/角色連續性切成 2-6 個 panel/群,提升 Kling 多鏡頭品質"
              className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              {autoGroup.isPending ? '切組中…' : hasGroups ? '↻ 重新切組' : '🧠 智能切組'}
            </button>
            {/*
              Batch generate buttons — surface a one-click path to fill
              every panel without an image / video. Each button only
              shows up when there's actually work to do (avoids "0 個"
              dead-button noise). Disabled while either is in flight so
              the user can't accidentally submit overlapping batches.
            */}
            {(() => {
              const missingImages = allPanels.filter((p) => !p.imageUrl).length
              if (missingImages === 0) return null
              return (
                <button
                  type="button"
                  disabled={batchImageState !== null || regenPanel.isPending || !canEdit}
                  onClick={handleBatchGenerateImages}
                  title={`一鍵把還沒有圖的 ${missingImages} 個分鏡都送去生圖(每張 30-60s,後台跑)`}
                  className="flex items-center gap-1.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-emerald-300 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AppIcon name="image" className="h-3 w-3" />
                  {batchImageState
                    ? `送出中 ${batchImageState.submitted}/${batchImageState.total}`
                    : `一鍵生圖 (${missingImages} 個)`}
                </button>
              )
            })()}
            {(() => {
              const eligibleForVideo = allPanels.filter(
                (p) => Boolean(p.imageUrl) && !p.videoUrl,
              ).length
              if (eligibleForVideo === 0) return null
              return (
                <button
                  type="button"
                  disabled={batchVideoState !== null || generateVideo.isPending || !canEdit}
                  onClick={handleBatchGenerateVideos}
                  title={`一鍵把已有圖、還沒有影片的 ${eligibleForVideo} 個分鏡都送去生 5 秒影片`}
                  className="flex items-center gap-1.5 rounded-sm border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-sky-300 transition-all hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AppIcon name="play" className="h-3 w-3" />
                  {batchVideoState
                    ? `送出中 ${batchVideoState.submitted}/${batchVideoState.total}`
                    : `一鍵生影片 (${eligibleForVideo} 個)`}
                </button>
              )
            })()}
            <div className="font-mono text-[14px] tracking-wider text-stone-500">
              {allPanels.length} SHOTS · DRAFT 03
            </div>
            </div>
          </div>
        </div>
        {analyzeBusy ? (
          <div className="mb-2 flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
            <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-amber-400" />
            <span>{analyzeBannerLabel}</span>
            {analyzePhase === 'processing' ? (
              <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-stone-900/60">
                <div
                  className="h-full bg-amber-400 transition-all duration-500"
                  style={{ width: `${Math.max(2, Math.min(100, analyzeProgress))}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {analyzeState.status === 'error' ? (
          <div className="mb-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
            提交失敗:{analyzeState.message}
          </div>
        ) : null}
        {autoGroup.isError ? (() => {
          // 2026-05-21 — route mutation error through resolveErrorDisplay
          // so CONFLICT / TASK_STILL_PROCESSING / EPISODE_NO_CLIPS all
          // surface their targeted friendly text instead of the raw
          // payload message (which was already partly friendly via
          // resolveTaskErrorMessage, but didn't pick up our specific
          // sub-codes like TASK_STILL_PROCESSING).
          const err = autoGroup.error as Error & { payload?: { error?: { code?: string; message?: string } } }
          const payload = err?.payload
          const display = resolveErrorDisplay({
            code: payload?.error?.code ?? null,
            message: payload?.error?.message ?? err?.message ?? null,
          })
          return (
            <div className="mb-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
              切組失敗:{display?.message ?? err?.message ?? '未知錯誤'}
            </div>
          )
        })() : null}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {allPanels.map((p, i) => {
            const active = p.id === selectedId
            const hasImage = Boolean(p.imageUrl)
            const accent = accentForGroupId(p.multiShotGroupId, orderedGroupIds)
            const groupBoundary = i > 0
              && p.multiShotGroupId
              && allPanels[i - 1].multiShotGroupId !== p.multiShotGroupId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`flex-shrink-0 overflow-hidden rounded-sm border-l-4 border-y border-r text-left transition-all ${accent} ${
                  active
                    ? 'border-amber-500/60 ring-2 ring-amber-500/20'
                    : 'border-stone-800/60 hover:border-stone-700'
                } ${groupBoundary ? 'ml-2' : ''}`}
              >
                <div
                  className={`relative ${thumbHeightClass} overflow-hidden bg-gradient-to-br from-stone-800 to-stone-900`}
                  // Inline aspectRatio (instead of Tailwind aspect-[9/16])
                  // because user-reported "thumbs render 16:9 even though
                  // project is 9:16" — Tailwind arbitrary aspect classes
                  // can be silently dropped if the JIT scanner doesn't
                  // see the literal at build time, and falling back to
                  // the parent's intrinsic ratio is exactly the
                  // landscape-looking-thumb bug. Inline style is
                  // bulletproof.
                  style={{ aspectRatio: projectVideoRatio.replace(':', '/') }}
                >
                  {hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl ?? ''} alt={`panel ${i + 1}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-stone-950/70">
                      <AppIcon name="image" className="h-5 w-5 text-stone-600" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-transparent to-transparent" />
                  <div className="absolute left-2 top-1.5 rounded bg-stone-950/50 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 backdrop-blur-sm">
                    #{String(i + 1).padStart(2, '0')}
                  </div>
                  {(() => {
                    const localImg = imageInFlight.has(p.id)
                    const localVid = videoInFlight.has(p.id)
                    const remoteImg = serverInflightPanelImageIds.has(p.id)
                    const remoteVid = serverInflightPanelVideoIds.has(p.id)
                    const isImg = localImg || remoteImg
                    const isVid = localVid || remoteVid
                    if (isImg || isVid) {
                      return (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-stone-950/75 backdrop-blur-sm">
                          <AppIcon name="sparklesAlt" className="h-4 w-4 animate-pulse text-amber-400" />
                          <div className="font-mono text-[12px] tracking-wider text-amber-300">
                            {isVid ? '視頻生成中' : '圖生成中'}
                          </div>
                        </div>
                      )
                    }
                    // Failure overlay — only show when there's no
                    // current in-flight retry AND there's no successful
                    // image/video yet. Image failures dominate over
                    // video failures (you regenerate image first).
                    const failedImg = !p.imageUrl && failedPanelImageIds.get(p.id)
                    const failedVid = !!p.imageUrl && !p.videoUrl && failedPanelVideoIds.get(p.id)
                    const failed = failedImg || failedVid
                    if (failed) {
                      const code = failed.errorCode ?? ''
                      // Friendlier 2-line label than the raw error
                      // dump. RATE_LIMIT happens often in the user's
                      // Tencent quota world; ViolationContent is a
                      // content-policy rejection and means "edit the
                      // description, then retry". Anything else falls
                      // through to a generic 失敗 with a tooltip.
                      const label = code === 'RATE_LIMIT'
                        ? '配額限制'
                        : /Violation|Content/i.test(failed.errorMessage ?? '')
                          ? '內容違規'
                          : '失敗'
                      const tooltip = `${code || ''}${code ? ' — ' : ''}${failed.errorMessage ?? '點重試'}`
                      return (
                        <div
                          title={tooltip}
                          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-950/80 backdrop-blur-sm"
                        >
                          <AppIcon name="alert" className="h-5 w-5 text-rose-300" />
                          <div className="font-mono text-[12px] tracking-wider text-rose-200">
                            ✗ {label}
                          </div>
                          <div className="font-mono text-[8px] tracking-wider text-rose-400/80">
                            點 {failedImg ? '生成圖片' : '生成視頻'} 重試
                          </div>
                        </div>
                      )
                    }
                    return null
                  })()}
                </div>
                {/*
                  Description text used to live here as a per-thumb
                  caption row, which made the strip card silhouette
                  read as 16:9 even on 9:16 projects (image is 9:16
                  but the caption + image stack added landscape
                  proportions). User asked 2026-05-02 for a clean
                  thumbs-only strip; the full description still lives
                  in the lower 描述詞 column for the selected shot.
                */}
              </button>
            )
          })}
        </div>
      </div>

      {/*
        3-column body. Originally text-LEFT / image-CENTER / inspector-RIGHT.
        User asked 2026-05-02 to put Selected Shot on the leftmost so the
        9:16 image anchors the eye, and to push every text/chip/binding
        column to the right. We use `order-N` Tailwind classes to swap
        the visual order without cutting/pasting the JSX blocks (each
        block is large and tightly tied to surrounding state). Result:
        Selected Shot first (order-1), text-fields second (order-2),
        bindings/cast/notes third (order-3) — but they remain in the
        DOM in their original order so React keys / refs stay stable.
      */}
      <div className="grid flex-1 grid-cols-12 gap-5 overflow-y-auto px-6 py-6">
        {/* Text column — visually middle, was leftmost.
            Widened to col-span-5 because the 視角 / 景別 / 運鏡 chip
            grids and the 描述詞 / 對話 textareas were getting pinched
            at col-span-3 on a 14" laptop, while the Selected Shot
            column had ~50% empty whitespace around a 260px image. */}
        <div className="col-span-5 space-y-5 order-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-mono text-[14px] tracking-wider text-amber-600">
                SHOT {String(selectedIndex + 1).padStart(2, '0')} · 描述詞
              </div>
              <button
                type="button"
                onClick={handleSaveDescription}
                disabled={!descChanged || updatePanelText.isPending || !selected || !canEdit}
                className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {updatePanelText.isPending ? '儲存中…' : '儲存'}
              </button>
            </div>
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              rows={5}
              placeholder="這個鏡頭的場景/構圖描述,生圖會用到。例:近景 — CATHERINE 穿舊圍裙,目光看向鏡頭,雙手扶在工作台前"
              className="w-full rounded-sm border border-amber-900/20 bg-stone-900/40 p-3 font-serif-cn text-sm leading-relaxed text-stone-300 outline-none focus:border-amber-500/40"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-mono text-[14px] tracking-wider text-amber-600">
                SHOT {String(selectedIndex + 1).padStart(2, '0')} · 對話
              </div>
              <button
                type="button"
                onClick={handleSaveDialogue}
                disabled={!dialogueChanged || updatePanelText.isPending || !selected || !canEdit}
                className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {updatePanelText.isPending ? '儲存中…' : '儲存'}
              </button>
            </div>
            <textarea
              value={dialogueDraft}
              onChange={(e) => setDialogueDraft(e.target.value)}
              rows={3}
              placeholder="這個鏡頭播放時的台詞 / 旁白 / 字幕。空白即為無對白。"
              className="w-full rounded-sm border border-amber-900/20 bg-stone-900/40 p-3 font-serif-cn text-sm leading-relaxed text-stone-300 outline-none focus:border-amber-500/40"
            />
          </div>

          {/*
            Functional chip groups:
              - 景別  → panel.shotType   (DB column shotType)
              - 運鏡  → panel.cameraMove (DB column cameraMove)
            Click to set, click the active one again to clear. Saved
            immediately via useUpdateProjectPanel — no separate save
            button. The previous static `active={N}` props rendered
            decorative-only chips that did nothing on click and
            misled the user into thinking they were saving (reported
            2026-05-02).

            視角 / 質量詞 chip groups intentionally NOT rendered: there's
            no backing schema column for either field, so wiring them
            would require either a migration or appending tag prefixes
            to panel.description (which pollutes the user's text). Will
            ship in a follow-up commit when the schema gains
            viewAngle / qualityTags fields.
          */}
          <PromptChipGroup
            label="景別"
            options={['遠景', '全景', '中景', '近景', '特寫']}
            cols={3}
            active={selected?.shotType ?? null}
            onChange={(value) => {
              if (!selected || selected.storyboardId == null || selected.panelIndex == null) return
              updatePanel.mutate({
                storyboardId: selected.storyboardId,
                panelIndex: selected.panelIndex,
                shotType: value,
              })
            }}
          />
          <PromptChipGroup
            label="運鏡"
            options={['中度推進', '搖降', '手持', '快速變焦', '升格']}
            cols={1}
            active={selected?.cameraMove ?? null}
            onChange={(value) => {
              if (!selected || selected.storyboardId == null || selected.panelIndex == null) return
              updatePanel.mutate({
                storyboardId: selected.storyboardId,
                panelIndex: selected.panelIndex,
                cameraMove: value,
              })
            }}
          />
          {updatePanel.isPending ? (
            <div className="font-mono text-[12px] tracking-wider text-stone-500">儲存中…</div>
          ) : updatePanel.isError ? (
            <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-2 py-1 font-mono text-[12px] tracking-wider text-rose-300">
              儲存失敗:{(updatePanel.error as Error)?.message ?? '未知'}
            </div>
          ) : null}
        </div>

        {/* Selected Shot — visually leftmost (order-1).
            Shrunk to col-span-3 so the 9:16 still doesn't sit inside
            a wide empty container that read as "16:9 frame around
            a 9:16 image" — the user-reported visual confusion when
            the shot was col-span-6. The image's own max-w-[260px]
            already prevents it from blowing up at this width. */}
        <div className="col-span-3 order-1">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-fraunces text-sm italic text-amber-500/80">Selected Shot</div>
            <button
              type="button"
              onClick={() => handleSubmitMultiShot()}
              disabled={multiShotState.status === 'submitting' || !canMultiShot}
              className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[14px] tracking-wider text-amber-500 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              title={(() => {
                const m = project?.novelPromotionData?.videoModel ?? ''
                if (!canMultiShot) {
                  return '當前模型不支援多鏡頭 — 請從上方視頻模型 picker 切到 Kling 或 Seedance 2.0 720p (BobAPI)'
                }
                if (videoFamily === 'seedance') {
                  return `Seedance 合成(BobAPI):一支 4-15s 影片含最多 9 個 reference,模型自決鏡頭運動與過渡`
                }
                if (/^tencent-vod::Kling-(3|O1)/i.test(m)) {
                  return `B 路徑(Tencent VOD ${m.split('::')[1]}):t2v + SubjectInfos.N + multi_shot=intelligence,免生圖直接出多鏡頭視頻`
                }
                return '把所有有圖的分鏡 5 個一組送 Kling multi-shot=intelligence(C 路徑 i2v)'
              })()}
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              {multiShotState.status === 'submitting'
                ? `送出中 ${multiShotState.sent}/${multiShotState.total}`
                : (() => {
                    const m = project?.novelPromotionData?.videoModel ?? ''
                    if (videoFamily === 'seedance') {
                      return '多鏡頭合成 (Seedance)'
                    }
                    return /^tencent-vod::Kling-(3|O1)/i.test(m)
                      ? '智能多鏡頭 (B 路徑)'
                      : 'Kling 多鏡頭(批次)'
                  })()}
            </button>
          </div>
          {/* 2026-05-13 — 圖/視頻顯示切換 + B 路徑「生成原圖」CTA。
              三種狀態：
              (a) image + video 都有 → 顯示 toggle，user 切著看
              (b) 只有 video（B 路徑 t2v 直接出視頻，跳過生圖）→ 顯示
                  「🖼 生成原圖」按鈕，補上 imageUrl 之後 toggle 自動出現
              (c) 只有 image 或都沒有 → 不顯示，下方既有的「生成圖片 /
                  ↻ 重新生成圖」按鈕負責 */}
          {selected?.imageUrl && selected?.videoUrl ? (
            <div className="mb-3 inline-flex rounded-sm border border-stone-800/60 bg-stone-900/40 font-mono text-[12px]">
              <button
                type="button"
                onClick={() =>
                  setMediaDisplayOverride((prev) => ({ ...prev, [selected.id]: 'image' }))
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-all ${
                  selectedMediaDisplayMode === 'image'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-stone-500 hover:text-stone-300'
                }`}
                title="顯示原圖"
              >
                <AppIcon name="image" className="h-3 w-3" />
                圖
              </button>
              <button
                type="button"
                onClick={() =>
                  setMediaDisplayOverride((prev) => ({ ...prev, [selected.id]: 'video' }))
                }
                className={`flex items-center gap-1.5 border-l border-stone-800/60 px-3 py-1.5 transition-all ${
                  selectedMediaDisplayMode === 'video'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-stone-500 hover:text-stone-300'
                }`}
                title="顯示生成視頻"
              >
                <span aria-hidden>▶</span>
                視頻
              </button>
            </div>
          ) : selected?.videoUrl && !selected?.imageUrl ? (
            <button
              type="button"
              disabled={!selected || regenPanel.isPending || isCurrentPanelImageInFlight || !canEdit}
              onClick={() => {
                if (!selected) return
                const panelIdAtSubmit = selected.id
                regenPanel.mutate(
                  { panelId: panelIdAtSubmit },
                  {
                    onSuccess: () => {
                      setImageInFlight((prev) => {
                        const next = new Set(prev)
                        next.add(panelIdAtSubmit)
                        return next
                      })
                      void activePanelImageTasks.refetch()
                    },
                  },
                )
              }}
              className="mb-3 inline-flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[12px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              title="B 路徑只生了視頻沒生圖。點這裡補生一張原圖，之後就能在圖/視頻之間切換。"
            >
              <AppIcon name="image" className="h-3 w-3" />
              {isCurrentPanelImageInFlight
                ? '生成原圖中…'
                : regenPanel.isPending
                  ? '提交中…'
                  : '🖼 生成原圖（B 路徑補圖）'}
            </button>
          ) : null}
          {multiShotState.status === 'done' ? (
            <div className="mb-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              ✓ 已送出 {multiShotState.sent} 個 multi-shot 任務
              {multiShotState.failures > 0 ? `(${multiShotState.failures} 組失敗)` : ''}
            </div>
          ) : null}
          {multiShotState.status === 'error' ? (
            <div className="mb-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {multiShotState.message}
            </div>
          ) : null}

          {/*
            Selected Shot — sized as a thumbnail-with-controls (≈ same
            footprint as the right-column multi-shot 9:16 player at
            180×320). User pointed out 2026-05-02 the previous full-
            col-span-6 width was overwhelming and out of proportion
            with the rest of the timeline page. Click on the
            image/video to open a fullscreen lightbox with the
            original-resolution asset for detailed inspection.
          */}
          <div
            className={`overflow-hidden rounded-sm border border-stone-800/60 bg-stone-900/30 mx-auto ${
              isPortraitRatio ? 'max-w-[260px]' : 'max-w-[480px]'
            }`}
          >
            <div
              className="relative bg-gradient-to-br from-stone-800 to-stone-900"
              style={{ aspectRatio: projectVideoRatio.replace(':', '/') }}
            >
              {selectedMediaDisplayMode === 'video' && selected?.videoUrl ? (
                // Video player. Use the still imageUrl as poster so first
                // paint is the same frame the user is used to seeing while
                // idle, then switch to playing video on user click. The
                // image/video toggle above lets the user explicitly switch
                // back to viewing the still image even after a video exists.
                <video
                  key={selected.id + ':' + selected.videoUrl}
                  src={selected.videoUrl}
                  poster={selected.imageUrl ?? undefined}
                  controls
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : selectedMediaDisplayMode === 'image' && selected?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.imageUrl}
                  alt="selected"
                  className="h-full w-full cursor-zoom-in object-cover"
                  onClick={() => selected.imageUrl && setZoomImageUrl(selected.imageUrl)}
                  title="點擊放大"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <AppIcon name="image" className="h-8 w-8 text-stone-600" />
                </div>
              )}
              {isCurrentPanelVideoInFlight || isCurrentPanelImageInFlight ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stone-950/75 backdrop-blur-sm">
                  <AppIcon name="sparklesAlt" className="h-8 w-8 animate-pulse text-amber-400" />
                  <div className="font-fraunces text-base italic text-amber-300">
                    {isCurrentPanelVideoInFlight ? '視頻生成中' : '圖片生成中'}
                  </div>
                  <div className="px-6 text-center font-serif-cn text-xs text-stone-300">
                    {isCurrentPanelVideoInFlight
                      ? 'Kling 模型 30-60 秒,完成後自動更新'
                      : 'Tencent VOD 30-60 秒,完成後自動更新'}
                  </div>
                  <div className="mt-1 h-0.5 w-48 overflow-hidden rounded-full bg-stone-800/60">
                    <div className="h-full w-1/3 animate-[progressSlide_2s_linear_infinite] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                  </div>
                </div>
              ) : (() => {
                // Failure overlay for the Selected Shot — same logic as
                // the strip thumbnail. Renders only when the panel has
                // a recent failed task AND no live retry in flight.
                if (!selected) return null
                const failedImg = !selected.imageUrl && failedPanelImageIds.get(selected.id)
                const failedVid = !!selected.imageUrl && !selected.videoUrl && failedPanelVideoIds.get(selected.id)
                const failed = failedImg || failedVid
                if (!failed) return null
                const code = failed.errorCode ?? ''
                const isRateLimit = code === 'RATE_LIMIT'
                const isViolation = /Violation|Content/i.test(failed.errorMessage ?? '')
                const headline = isRateLimit
                  ? 'Tencent VOD 配額限制'
                  : isViolation
                    ? '內容審核被擋'
                    : '生成失敗'
                const detail = isRateLimit
                  ? '同時跑太多任務,Tencent 拒絕了。等 1-2 分鐘後點下方按鈕重試。'
                  : isViolation
                    ? '描述詞被內容過濾擋下。請編輯左側「描述詞」,移除可能違規的字眼後重試。'
                    : (failed.errorMessage ?? '點下方按鈕重試')
                return (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-rose-950/85 backdrop-blur-sm">
                    <AppIcon name="alert" className="h-8 w-8 text-rose-300" />
                    <div className="font-fraunces text-base italic text-rose-200">
                      ✗ {headline}
                    </div>
                    <div className="px-6 text-center font-serif-cn text-xs text-rose-300/90">
                      {detail}
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className="bg-stone-900/60 px-4 py-3">
              <div className="font-serif-cn text-stone-100">
                鏡頭 {String(selectedIndex + 1).padStart(2, '0')}
              </div>
              {selected?.videoUrl ? (
                <div className="mt-1 font-mono text-[14px] tracking-wider text-amber-500">
                  ✓ 視頻已生成
                </div>
              ) : isCurrentPanelVideoInFlight ? (
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[14px] tracking-wider text-amber-400">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  視頻生成中… 30-60 秒,完成後自動更新
                </div>
              ) : selected?.imageUrl ? (
                <div className="mt-1 font-mono text-[14px] tracking-wider text-stone-500">
                  圖已生成,視頻待跑
                </div>
              ) : (
                <div className="mt-1 font-mono text-[14px] tracking-wider text-stone-500">尚未生成</div>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              disabled={!selected || regenPanel.isPending || !canEdit}
              onClick={() => {
                if (!selected) return
                const panelIdAtSubmit = selected.id
                regenPanel.mutate(
                  { panelId: panelIdAtSubmit },
                  {
                    onSuccess: () => {
                      setImageInFlight((prev) => {
                        const next = new Set(prev)
                        next.add(panelIdAtSubmit)
                        return next
                      })
                      // Trigger an immediate activeImageTasks refetch so the
                      // server-side set catches up faster than its 3s tick.
                      void activePanelImageTasks.refetch()
                    },
                  },
                )
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-stone-800 bg-stone-900/50 py-2.5 font-serif-cn text-sm text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="image" className="h-3.5 w-3.5" />
              {regenPanel.isPending
                ? '提交中…'
                : selected?.imageUrl
                  ? '↻ 重新生成圖'
                  : '生成圖片'}
            </button>
            <button
              type="button"
              disabled={!selected || !selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
              onClick={() => handleGenerateVideo()}
              title={
                !selected?.imageUrl
                  ? '需要先有靜態圖才能生影片 — 請先點「生成圖片」'
                  : isCurrentPanelVideoInFlight
                    ? '視頻生成中,請等 worker 完成(~60s)'
                    : '把這個鏡頭的圖送 video model(專案預設 Kling)生成 5 秒影片'
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 py-2.5 font-serif-cn text-sm text-amber-400 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="play" className="h-3.5 w-3.5" />
              {generateVideo.isPending
                ? '提交中…'
                : isCurrentPanelVideoInFlight
                  ? '生成中…'
                  : selected?.videoUrl
                    ? '↻ 重生視頻'
                    : '生成視頻'}
            </button>
          </div>
          {/* 2026-05-17 — Seedance 2.0 (fal) alternate row. Lets the user
              force-use fal Seedance for this one shot without changing
              the project's default videoModel. Two variants: standard
              (1080p + native audio, slower / pricier) and Fast (cheap).
              Smaller, secondary visual weight so it doesn't compete with
              the project-default "生成視頻" CTA above. Disabled state
              tracks the same prerequisites (need image, no inflight). */}
          <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-stone-500">
            <span className="shrink-0">或用 fal Seedance →</span>
            <button
              type="button"
              disabled={!selected || !selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
              onClick={() => handleGenerateVideo('fal::bytedance/seedance-2.0/image-to-video')}
              title={
                !selected?.imageUrl
                  ? '需要先有靜態圖才能生影片'
                  : 'fal Seedance 2.0 (1080p + native audio, ~$0.3-0.5/支)'
              }
              className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-stone-700 bg-stone-900/40 px-2 py-1.5 font-serif-cn text-[12px] text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="play" className="h-3 w-3" />
              Seedance (1080p+audio)
            </button>
            <button
              type="button"
              disabled={!selected || !selected.imageUrl || generateVideo.isPending || isCurrentPanelVideoInFlight || !canEdit}
              onClick={() => handleGenerateVideo('fal::bytedance/seedance-2.0/fast/image-to-video')}
              title={
                !selected?.imageUrl
                  ? '需要先有靜態圖才能生影片'
                  : 'fal Seedance 2.0 Fast (cheap variant, ~$0.1-0.2/支,稍弱)'
              }
              className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-stone-700 bg-stone-900/40 px-2 py-1.5 font-serif-cn text-[12px] text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="play" className="h-3 w-3" />
              Seedance Fast
            </button>
          </div>
          {/* Download row — surface the underlying COS URL as a direct
              download for users who want the raw asset for editing
              elsewhere (CapCut / 剪映 / PR). Disabled until the asset
              actually exists. <a download> uses the filename hint so
              the saved file gets a meaningful name instead of the
              cosKey hash. */}
          {selected ? (
            <div className="mt-3 flex items-center gap-3">
              <a
                href={selected.imageUrl ?? '#'}
                download={selected.imageUrl ? `panel-${String(selectedIndex + 1).padStart(2, '0')}.jpg` : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!selected.imageUrl}
                onClick={(e) => { if (!selected.imageUrl) e.preventDefault() }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-sm border border-stone-800 py-2 font-mono text-[14px] tracking-wider text-stone-400 transition-all ${
                  selected.imageUrl
                    ? 'hover:border-amber-500/40 hover:text-amber-400'
                    : 'cursor-not-allowed opacity-40'
                }`}
              >
                <AppIcon name="download" className="h-3 w-3" />
                下載靜態圖
              </a>
              <a
                href={selected.videoUrl ?? '#'}
                download={selected.videoUrl ? `panel-${String(selectedIndex + 1).padStart(2, '0')}.mp4` : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!selected.videoUrl}
                onClick={(e) => { if (!selected.videoUrl) e.preventDefault() }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-sm border border-stone-800 py-2 font-mono text-[14px] tracking-wider text-stone-400 transition-all ${
                  selected.videoUrl
                    ? 'hover:border-amber-500/40 hover:text-amber-400'
                    : 'cursor-not-allowed opacity-40'
                }`}
              >
                <AppIcon name="download" className="h-3 w-3" />
                下載影片
              </a>
            </div>
          ) : null}
          {regenPanel.isError ? (
            <p className="mt-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {(regenPanel.error as Error)?.message ?? '重生失敗'}
            </p>
          ) : null}
          {regenPanel.isSuccess ? (
            <p className="mt-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              已送出重生任務,稍候 worker 處理(每張約 30-60s)
            </p>
          ) : null}
        </div>

        {/* Inspector (cast / notes / multi-shot bindings) — rightmost (order-3).
            Widened to col-span-4 so the 9:16 multi-shot bindings player
            (180×320) plus its CAST / SCENES chip rows fit without
            horizontal scrolling. Plus user-reported clipping at the
            right edge — this gives the column real estate the rail
            actually needs. 3 + 5 + 4 = 12. */}
        <div className="col-span-4 space-y-5 order-3">
          {selectedGroupTaskId ? (
            <MultiShotBindingsRail
              taskId={selectedGroupTaskId}
              groupLabel={selectedGroupLabel}
              projectId={projectId}
            />
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-mono text-[14px] tracking-wider text-amber-600">卡司 · CAST</div>
              {currentEpisode?.episodeNumber ? (
                <div className="font-mono text-[11px] tracking-wider text-stone-500">
                  ep {currentEpisode.episodeNumber} 綁定
                </div>
              ) : null}
            </div>
            {/*
              Each panel character is rendered with the appearance the
              worker WOULD use right now — looks up
              EpisodeCharacter(currentEpisodeId, characterId) and falls
              back to characterRoster[0].appearances[0] when no
              binding exists. Match exactly the resolution priority in
              multi-shot-video-b-path.ts:820-855 so the chip reflects
              the actual generation outcome (no surprises).
            */}
            {Array.isArray(selected?.characters) && selected.characters.length > 0 ? (
              <div className="space-y-1.5">
                {selected.characters.map((ref, i) => {
                  // Post-2026-05-04 panels store characters as
                  // {name, appearance?}[]. The storyboards API decodes
                  // legacy bare-string entries into the same shape.
                  const name = typeof ref === 'string'
                    ? ref
                    : (ref as PanelCharacterRef)?.name ?? ''
                  const appearanceHint = typeof ref === 'string'
                    ? null
                    : (ref as PanelCharacterRef)?.appearance ?? null
                  const character = characterRoster.find(
                    (c) => (c.name ?? '').trim().toLowerCase() === name.trim().toLowerCase(),
                  )
                  const appearances = character?.appearances ?? []
                  const binding = episodeBindings.find(
                    (b) => b.characterId === character?.id,
                  )
                  // Resolution priority (mirrors worker
                  // collectPanelReferenceImages) — 2026-05-13 reordered:
                  //   1. panel.characters[i].appearance hint matched against
                  //      changeReason (per-shot LLM intent wins)
                  //   2. EpisodeCharacter binding (this episode, fallback
                  //      when LLM did not pick)
                  //   3. appearances[0]
                  let resolved = null as
                    | { id: string | null; label: string; imageUrl: string | null; isDefault: boolean }
                    | null
                  if (appearanceHint) {
                    const ap = appearances.find(
                      (a) => (a.changeReason ?? '').toLowerCase() === appearanceHint.toLowerCase(),
                    )
                    if (ap) {
                      resolved = {
                        id: ap.id ?? null,
                        label: ap.changeReason || appearanceHint,
                        imageUrl: ap.imageUrl ?? null,
                        isDefault: false,
                      }
                    }
                  }
                  if (!resolved && binding?.appearanceId) {
                    const ap = appearances.find((a) => a.id === binding.appearanceId)
                    if (ap) {
                      resolved = {
                        id: ap.id ?? null,
                        label: ap.changeReason || `造型 ${(ap.appearanceIndex ?? 0) + 1}`,
                        imageUrl: ap.imageUrl ?? null,
                        isDefault: false,
                      }
                    }
                  }
                  if (!resolved && appearances.length > 0) {
                    const ap = appearances[0]
                    resolved = {
                      id: ap.id ?? null,
                      label: ap.changeReason || '初始形象',
                      imageUrl: ap.imageUrl ?? null,
                      isDefault: true,
                    }
                  }
                  return (
                    <div
                      key={`${name}-${i}`}
                      className="flex items-center gap-2.5 rounded-sm border border-stone-800/60 bg-stone-900/40 px-2.5 py-1.5"
                      title={
                        resolved?.isDefault
                          ? `這集沒綁造型 — 用第一個造型(${resolved.label})。要改去劇本拆解頁設定。`
                          : `這集綁定造型: ${resolved?.label ?? '(無)'}`
                      }
                    >
                      <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-gradient-to-br from-amber-500 to-rose-700">
                        {resolved?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolved.imageUrl}
                            alt={name}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-serif-cn text-xs text-stone-200">{name}</div>
                        <div className="truncate font-mono text-[11px] tracking-wider text-amber-500/70">
                          {resolved
                            ? resolved.isDefault
                              ? `${resolved.label} (預設)`
                              : resolved.label
                            : '尚無造型'}
                        </div>
                      </div>
                      {resolved?.isDefault && appearances.length > 1 ? (
                        <span
                          className="flex-shrink-0 rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-300"
                          title="這個角色有多個造型,但這集還沒綁定"
                        >
                          未綁
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="font-serif-cn text-xs text-stone-500">(無關聯角色)</p>
            )}
          </div>

          <div>
            <div className="mb-2 font-mono text-[14px] tracking-wider text-amber-600">註記 · NOTES</div>
            <div className="rounded-sm border border-stone-800/60 bg-stone-900/40 px-3 py-2 font-serif-cn text-xs leading-relaxed text-stone-400">
              {selected?.videoPrompt ?? '(無註記)'}
            </div>
          </div>
        </div>
      </div>
      {/*
        Click-to-zoom lightbox for the Selected Shot. Renders only when
        the user has tapped the thumbnail-sized preview. Click anywhere
        (or hit Esc) to dismiss. Image is fit-contain so a 9:16 still
        stays inside the viewport without cropping.
      */}
      {zoomImageUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomImageUrl(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setZoomImageUrl(null)
          }}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-stone-950/95 p-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomImageUrl}
            alt="Zoomed"
            className="max-h-full max-w-full object-contain"
          />
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[14px] uppercase tracking-wider text-stone-400">
            click anywhere or press esc to close
          </div>
        </div>
      ) : null}

      {globalOverlaysNode}
    </div>
  )
}

function PromptChipGroup({
  label,
  options,
  cols,
  active,
  onChange,
  disabled,
}: {
  label: string
  options: string[]
  cols: number
  active: string | null
  onChange?: (value: string | null) => void
  disabled?: boolean
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[14px] tracking-wider text-stone-500">{label}</div>
      <div className={`grid gap-1.5 ${cols === 1 ? '' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {options.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled || !onChange}
            onClick={() => {
              if (!onChange) return
              // Toggle off if user re-clicks the active chip — lets
              // them clear a setting rather than being locked into
              // one of the options forever.
              onChange(active === v ? null : v)
            }}
            className={`rounded-sm border px-2 py-1.5 text-left font-serif-cn text-xs transition-all ${
              active === v
                ? 'border-amber-500/50 bg-amber-500/5 text-amber-400'
                : disabled || !onChange
                  ? 'border-stone-800 text-stone-500'
                  : 'border-stone-800 text-stone-300 hover:border-amber-500/40 hover:text-amber-300'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

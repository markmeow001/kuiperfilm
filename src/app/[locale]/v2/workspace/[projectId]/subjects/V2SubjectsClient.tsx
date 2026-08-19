'use client'

/**
 * Phase 12.4 — v2 SubjectsPage (劇本拆解 / Script Breakdown) client implementation.
 *
 * Tabs across 角色 / 世界與場景 / 道具. All three surfaces use
 * the existing first-class asset and episode-binding contracts.
 *
 * Each character / location card shows the primary appearance
 * image (from EpisodeCharacter junction or DB), the role / desc,
 * and on hover surfaces "重新生成" + "定稿" actions. Finalizing is a
 * synchronous metadata update; it does not submit an AI task.
 */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { DarkMediaLightbox } from '@/components/v2/DarkMediaLightbox'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { useProjectCharacters, useProjectLocations, useProjectProps } from '@/lib/query/hooks/useProjectAssets'
import {
  useRegenerateSingleCharacterImage,
  useRegenerateCharacterGroup,
} from '@/lib/query/mutations/character-image-ops-mutations'
import {
  useRegenerateSingleLocationImage,
  useRegenerateLocationGroup,
  useUploadProjectLocationImage,
} from '@/lib/query/mutations/location-image-mutations'
import {
  useGenerateProjectPropImage,
  useRegenerateSinglePropImage,
  useUploadProjectPropImage,
  useUpdateProjectPropName,
  useUpdateProjectPropSummary,
  useDeleteProjectProp,
} from '@/lib/query/mutations/prop-image-mutations'
import { V2PropEditModal } from './V2PropEditModal'
import {
  useUploadProjectCharacterImage,
  useDeleteProjectCharacter,
  useUpdateProjectCharacterName,
} from '@/lib/query/mutations/character-base-mutations'
import {
  useFinalizeProjectCharacterVisual,
  useUpdateProjectCharacterIntroduction,
} from '@/lib/query/mutations/character-profile-mutations'
import {
  useUpdateProjectAppearanceDescription,
  useUploadAndExpandCharacterToMultiView,
} from '@/lib/query/mutations/character-image-ops-mutations'
import { useAnalyzeProjectAssets, useAnalyzeAllEpisodes } from '@/lib/query/mutations/useProjectConfigMutations'
import { V2CharacterEditModal } from './V2CharacterEditModal'
import { V2CharacterAppearanceRecoveryModal } from './V2CharacterAppearanceRecoveryModal'
import { V2LocationEditModal } from './V2LocationEditModal'
import { useRegisterArkAsset } from '@/lib/query/mutations/useRegisterArkAsset'
import { V2ManualAddSubjectModal, type ManualAddSubjectType } from './V2ManualAddSubjectModal'
import { V2LocationCreationModal } from './V2LocationCreationModal'
import { V2CharacterCreationModal } from './V2CharacterCreationModal'
import {
  useUpdateProjectLocationBasics,
  useUpdateProjectLocationDescription,
  useCreateLocationView,
  useDeleteLocationView,
} from '@/lib/query/mutations/location-management-mutations'
import { useTaskSnapshot, useActiveTasks } from '@/lib/query/hooks/useTaskStatus'
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'
import {
  useEpisodeCharacterBindings,
  useEpisodeLocationBindings,
  useEpisodePropBindings,
} from '@/lib/query/mutations/episode-character-binding-mutations'
import { queryKeys } from '@/lib/query/keys'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'
import {
  type Tab,
  type V2SubjectsClientProps,
  type CharacterLike,
  type CharacterAppearanceLike,
  type LocationLike,
  type SubjectItem,
  pickCharacterAppearanceImage,
  pickLocationImage,
} from './subjects-client-helpers'
import {
  resolveActiveCharacterAppearance,
  type ActiveCharacterAppearanceBindingState,
  type ActiveCharacterAppearanceResolution,
} from './active-character-appearance'
import { SubjectGrid } from './SubjectGrid'
import { EntityWorkstation, type EntityWorkstationCopy } from './EntityWorkstation'
import {
  getManualSubjectCreateInvalidationKeys,
  runManualLocationCreateWithUpload,
  runManualPropCreateWithUpload,
  type ManualLocationCreateParams,
  type ManualPropCreateParams,
} from './manual-subject-create-flow'
import {
  createSubjectUploadRequestId,
  type SubjectUploadTarget,
} from './subject-create-upload-flow'

type ManualUploadRecovery = SubjectUploadTarget & { kind: 'scene' | 'prop' }
type ManualCreateRequest = { kind: 'scene' | 'prop'; id: string }

export function V2SubjectsClient({ projectId, locale }: V2SubjectsClientProps) {
  const t = useTranslations('v2Subjects')
  const queryClient = useQueryClient()
  // Phase 12.5 — viewer-role users see disabled mutation buttons.
  const {
    allowed,
    canEdit,
    isLoading: accessLoading,
    refetch: refetchAccess,
  } = useProjectAccess(projectId)
  const viewerTip = canEdit ? undefined : t('viewerHint')
  // Tab persisted in URL ?tab= so F5 + bookmarks + cross-project
  // navigation 都能落到對的 tab。Earlier we kept it in React state and
  // the user reported "F5 後跑到首頁" — actual behaviour was that F5
  // reset the local state to 'character', which felt like the page
  // lost their place.
  const router = useRouter()
  const rawPathname = usePathname()
  const searchParams = useSearchParams()
  const pathname = rawPathname ?? ''
  const tabParam = searchParams?.get('tab') ?? null
  const tab: Tab = tabParam === 'scene' || tabParam === 'prop' ? tabParam : 'character'
  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? '')
    if (next === 'character') {
      sp.delete('tab')
    } else {
      sp.set('tab', next)
    }
    const queryString = sp.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }
  const charactersQuery = useProjectCharacters(projectId)
  const locationsQuery = useProjectLocations(projectId)
  const propsQuery = useProjectProps(projectId)
  const regenChar = useRegenerateSingleCharacterImage(projectId)
  const regenLoc = useRegenerateSingleLocationImage(projectId)
  const generateProp = useGenerateProjectPropImage(projectId)
  const regenProp = useRegenerateSinglePropImage(projectId)
  const uploadPropImage = useUploadProjectPropImage(projectId)
  const updatePropName = useUpdateProjectPropName(projectId)
  const updatePropSummary = useUpdateProjectPropSummary(projectId)
  const deleteProp = useDeleteProjectProp(projectId)
  const regenCharGroup = useRegenerateCharacterGroup(projectId)
  const regenLocGroup = useRegenerateLocationGroup(projectId)
  const uploadCharImage = useUploadProjectCharacterImage(projectId)
  const uploadLocImage = useUploadProjectLocationImage(projectId)
  const finalizeProfile = useFinalizeProjectCharacterVisual(projectId)
  const updateAppearanceDesc = useUpdateProjectAppearanceDescription(projectId)
  const updateLocBasics = useUpdateProjectLocationBasics(projectId)
  const updateLocDescription = useUpdateProjectLocationDescription(projectId)
  const createLocationView = useCreateLocationView(projectId)
  const deleteLocationView = useDeleteLocationView(projectId)
  const updateCharIntro = useUpdateProjectCharacterIntroduction(projectId)
  const updateCharName = useUpdateProjectCharacterName(projectId)
  const deleteCharacter = useDeleteProjectCharacter(projectId)
  const uploadExpand = useUploadAndExpandCharacterToMultiView(projectId)
  const analyze = useAnalyzeProjectAssets(projectId)
  const analyzeAll = useAnalyzeAllEpisodes(projectId)
  const registerArkAsset = useRegisterArkAsset(projectId)
  // 2026-05-23 Phase 3 — single shared callback the SubjectGrid card
  // chips invoke. Mirrors useRegisterArkAsset semantics; alert on error.
  const handleArkRegister = canEdit
    ? async (args: {
        targetType: 'CharacterAppearance' | 'LocationImage' | 'NovelPromotionProp'
        targetId: string
      }) => {
        try {
          await registerArkAsset.mutateAsync(args)
        } catch (err) {
          alert(t('alerts.registerArkFailed', { reason: (err as Error)?.message ?? t('alerts.unknownReason') }))
        }
      }
    : undefined
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)
  const buildHref = useEpisodePreservingHref()

  // After the analyze cascade lands clips + storyboard panels, surface
  // a clear "→ 進入分鏡頁" CTA so the user knows the next step is one
  // click away. Polled with the assets so it shows up the moment
  // panels appear without a manual refresh.
  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const storyboardData = storyboardsQuery.data as
    | { storyboards?: Array<{ panels?: Array<{ id: string }> }> }
    | undefined
  const storyboardPanelCount = (storyboardData?.storyboards ?? [])
    .reduce((sum, sb) => sum + (sb.panels?.length ?? 0), 0)
  const hasStoryboardPanels = storyboardPanelCount > 0
  const [batchGenInFlight, setBatchGenInFlight] = useState<'characters' | 'locations' | 'props' | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)

  // Per-target in-flight tracking. The shared mutation `isPending` flag
  // is only true for the ~1s submission phase; the actual worker takes
  // 30-90s. We keep a Set of target ids (appearanceId for characters,
  // locationId for scenes) and show "生成中…" overlay until the asset
  // refetch surfaces a new image, or a 120s safety timeout clears it.
  const [regenInFlight, setRegenInFlight] = useState<Set<string>>(new Set())
  const [uploadInFlight, setUploadInFlight] = useState<Set<string>>(new Set())
  // Keyed by appearanceId — same scope the redescribe button targets.
  const [redescribeInFlight, setRedescribeInFlight] = useState<Set<string>>(new Set())
  const [finalizingCharacterIds, setFinalizingCharacterIds] = useState<Set<string>>(new Set())
  const [finalizeErrors, setFinalizeErrors] = useState<Map<string, string>>(new Map())
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [editingDescId, setEditingDescId] = useState<string | null>(null) // appearanceId
  const [editingDescDraft, setEditingDescDraft] = useState<string>('')
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [editingPropId, setEditingPropId] = useState<string | null>(null)
  const [manualAddOpen, setManualAddOpen] = useState<ManualAddSubjectType | null>(null)
  const [manualAddSubmitting, setManualAddSubmitting] = useState(false)
  const [manualUploadRecovery, setManualUploadRecovery] = useState<ManualUploadRecovery | null>(null)
  const [manualUploadError, setManualUploadError] = useState<string | null>(null)
  const manualCreateRequestRef = useRef<ManualCreateRequest | null>(null)

  // Access can change while the page is open. Close every mutation surface
  // immediately when edit access is absent so stale modal state cannot become
  // actionable if a viewer's permissions are revoked mid-session.
  useEffect(() => {
    if (canEdit) return
    setEditingDescId(null)
    setEditingDescDraft('')
    setEditingCharacterId(null)
    setEditingLocationId(null)
    setEditingPropId(null)
    setManualAddOpen(null)
    setManualUploadRecovery(null)
    setManualUploadError(null)
    setFinalizingCharacterIds(new Set())
    setFinalizeErrors(new Map())
    manualCreateRequestRef.current = null
  }, [canEdit])

  function markRegenStart(targetId: string) {
    setRegenInFlight((prev) => {
      const next = new Set(prev)
      next.add(targetId)
      return next
    })
    // Safety cleanup — most regens finish in 30-90s, but Tencent retry
    // can extend to ~3-5min. Clear after 5min regardless so the overlay
    // doesn't sit forever if asset refetch never sees a new url.
    window.setTimeout(() => {
      setRegenInFlight((prev) => {
        if (!prev.has(targetId)) return prev
        const next = new Set(prev)
        next.delete(targetId)
        return next
      })
    }, 300_000)
  }

  function markUploadDone(targetId: string) {
    setUploadInFlight((prev) => {
      if (!prev.has(targetId)) return prev
      const next = new Set(prev)
      next.delete(targetId)
      return next
    })
  }

  // Per-target overlay polling. Runs whenever EITHER the local
  // regenInFlight Set has entries (user clicked regen / upload-and-
  // expand) OR the server-side useActiveTasks query found running
  // image tasks (backfill auto-regen after analyze, or any task that
  // surfaces from another tab / session). Without the server-side
  // trigger, cards waited the full 5min safety timeout for new
  // images to land — looked like "auto-refresh broken".
  // 1.5s tick — Tencent VOD finishes in 28-37s but the post-
  // completion COS upload + DB update window is what users see; a
  // shorter poll closes the visible "spinner still on after image
  // is actually done" gap further.
  // We declare serverInflightIds before this effect (see below).

  // Server-side task snapshot — survives page navigation, polled while
  // the worker is in flight, and used as the source of truth for the
  // analyze status banner (instead of the component-local mutation state
  // that resets on unmount).
  // Query the analyze task scoped to the CURRENT episode so different
  // episodes can be analyzed in parallel without blocking each other's
  // banner / button. Falls back to project-level only when there's no
  // current episode (no episodes yet — analyze is disabled anyway).
  const taskSnapshot = useTaskSnapshot({
    projectId,
    targetType: currentEpisodeId ? 'NovelPromotionEpisode' : 'NovelPromotionProject',
    targetId: currentEpisodeId || projectId,
    type: ['analyze_novel'],
  })
  const taskStatus = taskSnapshot.data?.status ?? null
  const taskProgress = taskSnapshot.data?.progress ?? 0
  const isAnalyzing = taskStatus === 'queued' || taskStatus === 'processing'
  const taskError = taskSnapshot.data?.errorMessage ?? null
  // Map the raw worker error to a user-facing string. Prevents
  // leaking Prisma stack / DB column names when the worker fails
  // on an internal exception.
  const taskErrorDisplay = resolveErrorDisplay({
    code: taskSnapshot.data?.errorCode ?? null,
    message: taskSnapshot.data?.errorMessage ?? null,
  })
  const taskUpdatedAt = taskSnapshot.data?.updatedAt ?? null

  // Poll the snapshot every 3s while worker is running, so the
  // queued → processing → completed transition is observable.
  useEffect(() => {
    if (!isAnalyzing) return
    const interval = setInterval(() => { void taskSnapshot.refetch() }, 3000)
    return () => clearInterval(interval)
  }, [isAnalyzing, taskSnapshot])

  // Server-side image_character tasks (from analyze rescue path or any
  // backend trigger). Merged with local regenInFlight so the per-card
  // overlay shows whether the user clicked regen OR the backend
  // auto-submitted a backfill regen — without this the user sees
  // "✓ 分析完成" then waits in confusion as cards silently regenerate.
  const activeImageTasks = useActiveTasks({
    projectId,
    type: ['image_character', 'image_location', 'image_prop', 'regenerate_group', 'reference_to_character'],
  })
  const serverInflightIds = useMemo(() => {
    // Single Set for CharacterAppearance.id, Location.id, and
    // NovelPromotionProp.id — they're all disjoint UUID spaces, safe
    // to merge so the render path can ask one Set "is this id
    // in-flight?" regardless of asset class.
    const set = new Set<string>()
    for (const t of activeImageTasks.data ?? []) {
      if (typeof t.targetId !== 'string') continue
      if (
        t.targetType === 'CharacterAppearance'
        || t.targetType === 'LocationImage'
        || t.targetType === 'NovelPromotionProp'
      ) {
        set.add(t.targetId)
      }
    }
    return set
  }, [activeImageTasks.data])
  // 2026-05-02 — break the inflight count down per asset class so the
  // status banner can say `4 張道具圖` instead of the previous
  // `4 張角色圖` even when the user is on the 道具 tab. User-reported
  // confusion: the banner mismatched the visible cards (props) with
  // the wrong noun (characters).
  const serverInflightCounts = useMemo(() => {
    let character = 0
    let location = 0
    let prop = 0
    for (const t of activeImageTasks.data ?? []) {
      if (t.targetType === 'CharacterAppearance') character += 1
      else if (t.targetType === 'LocationImage') location += 1
      else if (t.targetType === 'NovelPromotionProp') prop += 1
    }
    return { character, location, prop, total: character + location + prop }
  }, [activeImageTasks.data])
  // Poll active tasks every 2s while EITHER set has entries. The earlier
  // version gated only on serverInflightIds.size, but that's derived
  // FROM activeImageTasks.data — chicken-and-egg: when the user just
  // clicked 重新生成, regenInFlight goes to {locId} but activeImageTasks
  // hasn't been refetched yet so serverInflightIds stays empty. Without
  // a refetch trigger, the new task row in DB never surfaces, the
  // drop-detection effect never fires, and the local overlay hangs on
  // the full 5-min safety timeout. Including regenInFlight.size in the
  // trigger means the user's click immediately starts the polling, after
  // ~2s activeImageTasks sees the new task, serverInflightIds picks
  // it up, and the loop self-sustains until completion drops it.
  useEffect(() => {
    if (regenInFlight.size === 0 && serverInflightIds.size === 0) return
    const interval = setInterval(() => { void activeImageTasks.refetch() }, 2000)
    return () => clearInterval(interval)
  }, [regenInFlight.size, serverInflightIds.size, activeImageTasks])
  // When server in-flight set drops to 0, also refresh assets so the
  // freshly-generated images surface immediately.
  const previousServerInflight = useRef(serverInflightIds.size)
  useEffect(() => {
    if (previousServerInflight.current > 0 && serverInflightIds.size === 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
    }
    previousServerInflight.current = serverInflightIds.size
  }, [serverInflightIds.size, projectId, queryClient])

  // Sync local regenInFlight against the server-side truth. Without this
  // the local Set is only cleared by a 5-min safety timeout, so when a
  // task actually completes in 50s the per-card "生圖中…" overlay
  // hangs around for the remaining ~4min. We watch the server set: any
  // appearanceId that WAS in the previous serverInflightIds snapshot but
  // ISN'T anymore had its task finish (or fail past max attempts), so
  // it's safe to drop from regenInFlight too.
  const previousServerIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    const dropped = Array.from(previousServerIds.current).filter((id) => !serverInflightIds.has(id))
    if (dropped.length > 0) {
      setRegenInFlight((prev) => {
        if (prev.size === 0) return prev
        const next = new Set(prev)
        let changed = false
        for (const id of dropped) {
          if (next.delete(id)) changed = true
        }
        return changed ? next : prev
      })
    }
    previousServerIds.current = serverInflightIds
  }, [serverInflightIds])

  // Continuous projectAssets polling whenever EITHER set has entries.
  // The earlier client-only-Set version missed analyze-cascade backfill
  // (server submitted tasks without going through any local mutation),
  // leaving cards stuck on the old image until the user manually
  // refreshed. 2s tick — Tencent finishes in 28-37s and the
  // post-completion COS upload + DB update window is what makes the
  // overlay-while-image-already-ready feel slow.
  useEffect(() => {
    if (regenInFlight.size === 0 && serverInflightIds.size === 0) return
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
    }, 2000)
    return () => clearInterval(interval)
  }, [regenInFlight.size, serverInflightIds.size, projectId, queryClient])

  // Detect transition into 'completed' and invalidate both projectAssets
  // (so cards see the LLM-written introduction / visual_description) AND
  // tasks (so useActiveTasks picks up the IMAGE_CHARACTER backfill tasks
  // that the analyze worker just submitted — without a second invalidate
  // here the active-tasks query stays stuck on whatever it saw at submit
  // time and the per-card overlay never lights up).
  const previousTaskStatus = useRef(taskStatus)
  useEffect(() => {
    if (previousTaskStatus.current !== 'completed' && taskStatus === 'completed') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
    }
    previousTaskStatus.current = taskStatus
  }, [taskStatus, projectId, queryClient])

  // While analyze is running OR has just completed, keep polling the
  // active-tasks query every 3s. The backfill tasks are submitted in a
  // single tick at the END of analyze, so the moment the snapshot flips
  // to 'completed' we want a fresh fetch within seconds, not 5s+.
  useEffect(() => {
    if (!isAnalyzing && taskStatus !== 'completed') return
    const interval = setInterval(() => {
      void activeImageTasks.refetch()
    }, 3000)
    // Stop polling 30s after completion — by then any backfill tasks
    // are visible in the snapshot and the existing 4s in-flight loop
    // takes over.
    const stopAt = setTimeout(() => clearInterval(interval), 30_000)
    return () => {
      clearInterval(interval)
      clearTimeout(stopAt)
    }
  }, [isAnalyzing, taskStatus, activeImageTasks])

  const allCharacters = (charactersQuery.data ?? []) as unknown as CharacterLike[]
  const allLocations = (locationsQuery.data ?? []) as unknown as LocationLike[]

  // Subjects filters BOTH the character and 場景 grid to only those
  // linked to the current episode via EpisodeCharacter / EpisodeLocation.
  // Each new episode starts empty until 一鍵分析 runs against it — that's
  // the analyze handler's job (it writes both junction tables for any
  // character/location it extracted or matched against the existing
  // library). Without strict filtering, ep1's cast + scenes leaked into
  // ep2 the moment ep2 was created and made the per-episode UX broken
  // (user complaint: "第二集的人物場景應該是空的").
  //
  // Note: legacy data created before EpisodeCharacter / EpisodeLocation
  // backfill will show as empty here. The fix is to re-run 一鍵分析 on
  // that episode — the empty-hint banner from SubjectGrid points users
  // there.
  const episodeBindingsQuery = useEpisodeCharacterBindings(projectId, currentEpisodeId)
  const episodeAppearanceBindingMap = useMemo<ReadonlyMap<string, string | null>>(() => {
    const map = new Map<string, string | null>()
    for (const binding of episodeBindingsQuery.data ?? []) {
      map.set(binding.characterId, binding.appearanceId)
    }
    return map
  }, [episodeBindingsQuery.data])
  const episodeAppearanceBindingState: ActiveCharacterAppearanceBindingState = !currentEpisodeId
    ? { status: 'ready', bindingMap: episodeAppearanceBindingMap }
    : episodeBindingsQuery.error
      ? { status: 'error' }
      : episodeBindingsQuery.isPending || episodeBindingsQuery.isFetching
        ? { status: 'loading' }
        : { status: 'ready', bindingMap: episodeAppearanceBindingMap }
  const episodeLocationBindingsQuery = useEpisodeLocationBindings(projectId, currentEpisodeId)
  const episodeLocationBindingIds = useMemo(() => {
    const set = new Set<string>()
    for (const b of episodeLocationBindingsQuery.data ?? []) set.add(b.locationId)
    return set
  }, [episodeLocationBindingsQuery.data])
  const episodePropBindingsQuery = useEpisodePropBindings(projectId, currentEpisodeId)
  const episodePropBindingIds = useMemo(() => {
    const set = new Set<string>()
    for (const binding of episodePropBindingsQuery.data ?? []) set.add(binding.propId)
    return set
  }, [episodePropBindingsQuery.data])
  const characters: CharacterLike[] = currentEpisodeId
    ? allCharacters.filter((c) => episodeAppearanceBindingMap.has(c.id))
    : allCharacters
  const locations: LocationLike[] = currentEpisodeId
    ? allLocations.filter((l) => episodeLocationBindingIds.has(l.id))
    : allLocations
  const isFilteringByEpisode = !!currentEpisodeId
  const hiddenInThisEpisodeCount = isFilteringByEpisode
    ? allCharacters.length - characters.length
    : 0
  const activeAppearanceResolutionByCharacterId = new Map<
    string,
    ActiveCharacterAppearanceResolution
  >(
    characters.map((character) => [
      character.id,
      resolveActiveCharacterAppearance({
        characterId: character.id,
        appearances: character.appearances,
        episodeId: currentEpisodeId,
        bindingState: episodeAppearanceBindingState,
      }),
    ]),
  )

  function getActiveAppearanceResolution(character: CharacterLike) {
    return activeAppearanceResolutionByCharacterId.get(character.id)
      ?? resolveActiveCharacterAppearance({
        characterId: character.id,
        appearances: character.appearances,
        episodeId: currentEpisodeId,
        bindingState: episodeAppearanceBindingState,
      })
  }

  function handleAnalyze() {
    if (!currentEpisodeId) {
      alert(t('alerts.needEpisode'))
      return
    }
    analyze.mutate(
      // V2 path opts in to the full analyze → CLIPS_BUILD → SCRIPT_TO_STORYBOARD_RUN
      // cascade. Without this, the storyboard worker would later fail with
      // "No clips found" because Session B made the cascade opt-in for
      // legacy /workspace flows.
      //
      // 2026-05-13 — opt OUT of the script_to_storyboard → IMAGE_PANEL
      // mass cascade. Reanalyzing a script that already has 22 panels
      // would otherwise re-submit 22 image gen tasks behind the user's
      // back. V2 desktop wants explicit control via per-panel "生成圖片"
      // or the toolbar 「一鍵生圖」 button.
      { episodeId: currentEpisodeId, cascadeToStoryboard: true, cascadeImageGen: false },
      {
        onSuccess: () => {
          // Pull the new task into the snapshot immediately so the banner
          // flips from idle → queued without waiting for the 5s staleTime.
          void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
        },
      },
    )
  }

  // 批次「分析全部集」(2026-06-25) — fans out the same analyze→storyboard cascade
  // across every episode without a storyboard. Video stays a manual per-group
  // action. The per-episode banners flip to queued via the tasks invalidation.
  async function handleAnalyzeAllEpisodes() {
    if (!canEdit || analyzeAll.isPending) return
    if (!window.confirm(t('analyzeAll.confirm'))) return
    try {
      const res = await analyzeAll.mutateAsync()
      if (res.submitted === 0 && res.deferred === 0) {
        window.alert(t('analyzeAll.noWork', { total: res.total }))
      } else {
        const failedTail = res.failed > 0
          ? t('analyzeAll.resultFailedTail', { failed: res.failed })
          : ''
        const deferredTail = res.deferred > 0
          ? t('analyzeAll.resultDeferredTail', { deferred: res.deferred })
          : ''
        window.alert(
          t('analyzeAll.result', {
            submitted: res.submitted,
            skipped: res.skipped,
            failedTail,
            deferredTail,
          }),
        )
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
    } catch (err) {
      window.alert(
        t('analyzeAll.error', {
          reason: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  function handleRegenChar(c: CharacterLike, appearance: CharacterAppearanceLike) {
    if (!canEdit) return
    markRegenStart(appearance.id)
    regenChar.mutate({ characterId: c.id, appearanceId: appearance.id, imageIndex: 0 })
  }

  function handleRegenLoc(l: LocationLike) {
    if (!canEdit) return
    markRegenStart(l.id)
    regenLoc.mutate({ locationId: l.id, imageIndex: 0 })
  }

  function handleOpenCharacterModal(c: CharacterLike) {
    if (!canEdit) return
    setEditingCharacterId(c.id)
  }

  function handleCloseCharacterModal() {
    setEditingCharacterId(null)
  }

  function handleSaveIntroduction(characterId: string, introduction: string) {
    if (!canEdit) return
    updateCharIntro.mutate(
      { characterId, introduction },
      {
        onError: (err) => {
          alert(t('alerts.saveCharDescFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  // Phase R-3 (2026-05-22) — submit character rename. Backend
  // (PATCH /api/novel-promotion/[projectId]/character) atomically
  // updates the catalog row AND propagates the new name across every
  // panel.characters JSON in the project via Phase R-2's
  // propagateCharacterRename helper. So a successful save here means
  // all downstream multi-shot ref lookups will already see the new
  // name on next regenerate.
  function handleSaveCharacterName(characterId: string, name: string) {
    if (!canEdit) return
    const trimmed = name.trim()
    if (!trimmed) return
    updateCharName.mutate(
      { characterId, name: trimmed },
      {
        onError: (err) => {
          alert(t('alerts.renameCharFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  // Phase R-3 — prop edit handlers. PATCH route runs
  // propagatePropRename atomically (same shape as character rename).
  function handleSavePropName(propId: string, name: string) {
    if (!canEdit) return
    const trimmed = name.trim()
    if (!trimmed) return
    updatePropName.mutate(
      { propId, name: trimmed },
      {
        onError: (err) => alert(t('alerts.renamePropFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') })),
      },
    )
  }
  function handleSavePropSummary(propId: string, summary: string) {
    if (!canEdit) return
    updatePropSummary.mutate(
      { propId, summary },
      {
        onError: (err) => alert(t('alerts.savePropDescFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') })),
      },
    )
  }
  function handleDeletePropFromModal(propId: string) {
    if (!canEdit) return
    deleteProp.mutate(
      { propId },
      {
        onSuccess: () => setEditingPropId(null),
        onError: (err) => alert(t('alerts.deletePropFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') })),
      },
    )
  }

  function handleSaveVisualPromptFromModal(characterId: string, appearanceId: string, visualPrompt: string) {
    if (!canEdit) return
    updateAppearanceDesc.mutate(
      { characterId, appearanceId, description: visualPrompt, descriptionIndex: 0 },
      {
        onError: (err) => {
          alert(t('alerts.saveAppearanceFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  function handleUploadAndExpandToMultiView(
    c: CharacterLike,
    appearance: CharacterAppearanceLike,
    file: File,
  ) {
    if (!canEdit) return
    // Track via the same regen overlay since the worker generates 3
    // images (~ 60-180s on Tencent VOD). The poll loop on /assets will
    // pick up the new imageUrls and the overlay clears via the 5min
    // safety timeout or sooner once images surface.
    markRegenStart(appearance.id)
    uploadExpand.mutate(
      { file, characterId: c.id, appearanceId: appearance.id },
      {
        onError: (err) => {
          alert(t('alerts.multiViewFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  function handleDeleteCharacterFromModal(characterId: string) {
    if (!canEdit) return
    deleteCharacter.mutate(characterId, {
      onSuccess: () => setEditingCharacterId(null),
      onError: (err) => {
        alert(t('alerts.deleteFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
      },
    })
  }

  function handleEditDescStart(c: CharacterLike, appearance: CharacterAppearanceLike) {
    if (!canEdit) return
    setEditingDescId(appearance.id)
    setEditingDescDraft(appearance.description ?? c.description ?? '')
  }

  function handleEditDescCancel() {
    setEditingDescId(null)
    setEditingDescDraft('')
  }

  function handleEditDescSave(c: CharacterLike, appearance: CharacterAppearanceLike) {
    if (!canEdit) return
    const description = editingDescDraft.trim()
    if (!description) {
      alert(t('alerts.descCannotEmpty'))
      return
    }
    updateAppearanceDesc.mutate(
      { characterId: c.id, appearanceId: appearance.id, description, descriptionIndex: 0 },
      {
        onSuccess: () => {
          setEditingDescId(null)
          setEditingDescDraft('')
        },
      },
    )
  }

  async function handleFinalizeProfile(
    character: CharacterLike,
    appearance: CharacterAppearanceLike,
  ) {
    if (!canEdit || character.profileConfirmed || finalizingCharacterIds.has(character.id)) return

    setFinalizingCharacterIds((previous) => {
      const next = new Set(previous)
      next.add(character.id)
      return next
    })
    setFinalizeErrors((previous) => {
      if (!previous.has(character.id)) return previous
      const next = new Map(previous)
      next.delete(character.id)
      return next
    })

    try {
      await finalizeProfile.mutateAsync({
        characterId: character.id,
        appearanceId: appearance.id,
      })
    } catch {
      setFinalizeErrors((previous) => {
        const next = new Map(previous)
        next.set(character.id, t('alerts.finalizeFailed'))
        return next
      })
    } finally {
      setFinalizingCharacterIds((previous) => {
        if (!previous.has(character.id)) return previous
        const next = new Set(previous)
        next.delete(character.id)
        return next
      })
    }
  }

  // Explicitly re-describe an asset from its current image. Shared by
  // character / location / prop cards. Plain uploads only persist the
  // image; this user action is the sole path that invokes vision analysis
  // and may replace the description.
  async function callRedescribe(
    endpoint: string,
    body: Record<string, string>,
    inFlightKey: string,
  ): Promise<boolean> {
    if (!canEdit) return false
    if (redescribeInFlight.has(inFlightKey)) return false
    setRedescribeInFlight((prev) => {
      const next = new Set(prev)
      next.add(inFlightKey)
      return next
    })
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        const code = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`
        alert(t('alerts.redescribeFailedCode', { code }))
        return false
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
      return true
    } catch (err) {
      alert(t('alerts.redescribeFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
      return false
    } finally {
      setRedescribeInFlight((prev) => {
        const next = new Set(prev)
        next.delete(inFlightKey)
        return next
      })
    }
  }

  async function handleRedescribe(appearance: CharacterAppearanceLike) {
    await callRedescribe(
      `/api/novel-promotion/${projectId}/character/appearance/redescribe`,
      { appearanceId: appearance.id },
      appearance.id,
    )
  }

  async function handleRedescribeLoc(l: LocationLike) {
    // Pick the LocationImage panel gen would actually use:
    //   1. l.selectedImageId   (explicit user pick)
    //   2. first image with imageUrl
    type ImageWithDescription = { id: string; imageUrl?: string | null }
    const images = (l.images as ImageWithDescription[] | undefined) ?? []
    const selectedId = (l as { selectedImageId?: string | null }).selectedImageId ?? null
    const target =
      (selectedId ? images.find((img) => img.id === selectedId) : null)
      ?? images.find((img) => Boolean(img.imageUrl))
    if (!target?.id) {
      alert(t('alerts.sceneNoImage'))
      return
    }
    await callRedescribe(
      `/api/novel-promotion/${projectId}/location/image/redescribe`,
      { locationImageId: target.id },
      target.id,
    )
  }

  async function handleRedescribeProp(p: { id: string; imageUrl?: string | null }) {
    if (!p.imageUrl) {
      alert(t('alerts.propNoImage'))
      return
    }
    await callRedescribe(
      `/api/novel-promotion/${projectId}/prop/redescribe`,
      { propId: p.id },
      p.id,
    )
  }

  async function handleBatchRegenCharacters() {
    if (!canEdit) return
    if (batchGenInFlight) return
    if (characters.length === 0) {
      alert(t('alerts.noCharsAnalyze'))
      return
    }
    const targets = characters.map((character) => ({
      character,
      resolution: getActiveAppearanceResolution(character),
    }))
    if (targets.some(({ resolution }) => resolution.status !== 'resolved')) {
      alert(t('activeAppearance.batchUnavailable'))
      return
    }
    setBatchGenInFlight('characters')
    setBatchProgress({ done: 0, total: characters.length })
    try {
      let done = 0
      // Sequential to avoid hammering the image provider; switch to
      // Promise.all if user wants pure parallel later.
      for (const { character, resolution } of targets) {
        if (resolution.status !== 'resolved') continue
        try {
          await regenCharGroup.mutateAsync({
            characterId: character.id,
            appearanceId: resolution.appearance.id,
          })
        } catch (err) {
          console.warn('[batch-regen] character', character.id, err)
        }
        done++
        setBatchProgress({ done, total: characters.length })
      }
    } finally {
      setBatchGenInFlight(null)
      setTimeout(() => setBatchProgress(null), 3000)
    }
  }

  async function handleBatchRegenLocations() {
    if (!canEdit) return
    if (batchGenInFlight) return
    if (locations.length === 0) {
      alert(t('alerts.noScenesAnalyze'))
      return
    }
    setBatchGenInFlight('locations')
    setBatchProgress({ done: 0, total: locations.length })
    try {
      let done = 0
      for (const l of locations) {
        try {
          await regenLocGroup.mutateAsync({ locationId: l.id })
        } catch (err) {
           
          console.warn('[batch-regen] location', l.id, err)
        }
        done++
        setBatchProgress({ done, total: locations.length })
      }
    } finally {
      setBatchGenInFlight(null)
      setTimeout(() => setBatchProgress(null), 3000)
    }
  }

  async function handleBatchGenProps() {
    if (!canEdit) return
    if (batchGenInFlight) return
    if (props.length === 0) {
      alert(t('alerts.noPropsAnalyze'))
      return
    }
    setBatchGenInFlight('props')
    setBatchProgress({ done: 0, total: props.length })
    try {
      let done = 0
      // For props, pick the right mutation per item: brand-new props
      // (no imageUrl yet) go through generateProp; existing ones go
      // through regenProp. Same logic the per-card button uses.
      for (const p of props) {
        try {
          markRegenStart(p.id)
          if (p.imageUrl) {
            await regenProp.mutateAsync({ propId: p.id })
          } else {
            await generateProp.mutateAsync({ propId: p.id })
          }
        } catch (err) {
           
          console.warn('[batch-gen] prop', p.id, err)
        }
        done++
        setBatchProgress({ done, total: props.length })
      }
    } finally {
      setBatchGenInFlight(null)
      setTimeout(() => setBatchProgress(null), 3000)
    }
  }

  async function handleUploadChar(
    c: CharacterLike,
    appearance: CharacterAppearanceLike,
    file: File,
  ) {
    if (!canEdit) return
    setUploadInFlight((prev) => new Set(prev).add(appearance.id))
    // labelText is required by /upload-asset-image. Use a deterministic
    // human-readable label so it appears the same way generated images do.
    const labelText = `${c.name ?? t('entityNames.character')} - ${appearance.changeReason ?? t('appearanceLabel.default')}`
    uploadCharImage.mutate(
      { file, characterId: c.id, appearanceId: appearance.id, imageIndex: 0, labelText },
      {
        onSettled: () => markUploadDone(appearance.id),
        onError: (err) => {
          alert(t('alerts.uploadFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  function handleUploadLoc(l: LocationLike, file: File) {
    if (!canEdit) return
    setUploadInFlight((prev) => new Set(prev).add(l.id))
    const labelText = `${l.name ?? t('entityNames.scene')}`
    uploadLocImage.mutate(
      { file, locationId: l.id, imageIndex: 0, labelText },
      {
        onSettled: () => markUploadDone(l.id),
        onError: (err) => {
          alert(t('alerts.uploadFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  function handleUploadProp(p: { id: string; name: string }, file: File) {
    if (!canEdit) return
    setUploadInFlight((prev) => new Set(prev).add(p.id))
    const labelText = `${p.name ?? t('entityNames.prop')}`
    uploadPropImage.mutate(
      { file, propId: p.id, labelText },
      {
        onSettled: () => markUploadDone(p.id),
        onError: (err) => {
          alert(t('alerts.uploadFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  // ===== Manual-add (角色 / 場景 / 道具) =====
  // Pattern: POST → entity exists → upload image (if any) → invalidate.
  // 上傳走既有的 useUpload* mutation,複用 invalidation,卡片自動刷新。
  // No description = no auto AI gen (見 character/route.ts:202 +
  // location/route.ts:90 跳過邏輯)。

  async function handleManualAddLocation(params: ManualLocationCreateParams) {
    if (!canEdit) return
    setManualAddSubmitting(true)
    try {
      const existingTarget = manualUploadRecovery?.kind === 'scene'
        ? {
            createdId: manualUploadRecovery.createdId,
            targetId: manualUploadRecovery.targetId,
          }
        : null
      const createRequestId = manualCreateRequestRef.current?.kind === 'scene'
        ? manualCreateRequestRef.current.id
        : createSubjectUploadRequestId()
      if (manualCreateRequestRef.current?.kind !== 'scene') {
        manualCreateRequestRef.current = { kind: 'scene', id: createRequestId }
      }
      const result = await runManualLocationCreateWithUpload({
        projectId,
        episodeId: currentEpisodeId,
        createRequestId,
        params,
        existingTarget,
        onCreated: async () => {
          await Promise.all(
            getManualSubjectCreateInvalidationKeys('location', projectId, currentEpisodeId)
              .map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
          )
        },
        upload: async (uploadParams) => await uploadLocImage.mutateAsync(uploadParams),
      })

      if (result.status === 'upload-failed') {
        setManualUploadRecovery({ kind: 'scene', ...result.target })
        setManualUploadError(t('uploadRecovery.message'))
        return
      }

      setManualUploadRecovery(null)
      setManualUploadError(null)
      manualCreateRequestRef.current = null
      setManualAddOpen(null)
    } catch (err) {
      alert(t('alerts.createFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
    } finally {
      setManualAddSubmitting(false)
    }
  }

  async function handleManualAddProp(params: ManualPropCreateParams) {
    if (!canEdit) return
    setManualAddSubmitting(true)
    try {
      const existingTarget = manualUploadRecovery?.kind === 'prop'
        ? {
            createdId: manualUploadRecovery.createdId,
            targetId: manualUploadRecovery.targetId,
          }
        : null
      const createRequestId = manualCreateRequestRef.current?.kind === 'prop'
        ? manualCreateRequestRef.current.id
        : createSubjectUploadRequestId()
      if (manualCreateRequestRef.current?.kind !== 'prop') {
        manualCreateRequestRef.current = { kind: 'prop', id: createRequestId }
      }
      const result = await runManualPropCreateWithUpload({
        projectId,
        episodeId: currentEpisodeId,
        createRequestId,
        params,
        existingTarget,
        onCreated: async () => {
          await Promise.all(
            getManualSubjectCreateInvalidationKeys('prop', projectId, currentEpisodeId)
              .map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
          )
        },
        upload: async (uploadParams) => await uploadPropImage.mutateAsync(uploadParams),
      })

      if (result.status === 'upload-failed') {
        setManualUploadRecovery({ kind: 'prop', ...result.target })
        setManualUploadError(t('uploadRecovery.message'))
        return
      }

      setManualUploadRecovery(null)
      setManualUploadError(null)
      manualCreateRequestRef.current = null
      setManualAddOpen(null)
    } catch (err) {
      alert(t('alerts.createFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
    } finally {
      setManualAddSubmitting(false)
    }
  }

  const allProps = (propsQuery.data ?? []) as Array<{
    id: string
    name: string
    summary?: string | null
    description?: string | null
    imageUrl?: string | null
  }>
  const props = currentEpisodeId
    ? allProps.filter((prop) => episodePropBindingIds.has(prop.id))
    : allProps
  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'character', label: t('tabs.character'), count: characters.length },
    { id: 'scene', label: t('tabs.scene'), count: locations.length },
    { id: 'prop', label: t('tabs.prop'), count: props.length },
  ]

  // Include binding queries — without them, the strict per-episode filter
  // briefly returns [] during the binding-query inflight window and the
  // grid flashes "empty" before the real cast/scenes arrive.
  const isLoading =
    (tab === 'character' ? charactersQuery.isLoading : tab === 'scene' ? locationsQuery.isLoading : propsQuery.isLoading)
    || (!!currentEpisodeId && (
      tab === 'character'
        ? episodeBindingsQuery.isLoading
        : tab === 'scene'
          ? episodeLocationBindingsQuery.isLoading
          : episodePropBindingsQuery.isLoading
    ))

  // 2026-05-21 — replaced the always-on amber CTA strip with two
  // surfaces that share the same handleAnalyze action:
  //   1. compactAnalyzeButton (top of content area) — ambient access
  //      to 「重新分析」 when the grid already has items, so the user
  //      never has to hunt for the entry point
  //   2. emptyStateCta (passed into SubjectGrid as `emptyAction`) —
  //      big centered card with the same button + 素材庫 link, so a
  //      brand-new EP doesn't make the user read a sentence to find
  //      the next action
  // Page title 「劇本拆解」 (sidebar) now carries the page-level
  // orientation the deleted banner used to provide; the description
  // sentence is dropped as redundant.
  const analyzeLabel = analyze.isPending
    ? t('analyze.submitting')
    : isAnalyzing
      ? t('analyze.analyzing', { progress: taskProgress })
      : taskStatus === 'completed'
        ? t('analyze.reAnalyze')
        : t('analyze.first')
  const analyzeDisabled = analyze.isPending || isAnalyzing || !currentEpisodeId || !canEdit

  const compactAnalyzeButton = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={handleAnalyze}
        disabled={analyzeDisabled}
        className="kuiper-dashboard-primary flex min-h-11 items-center gap-1.5 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        <AppIcon name="sparklesAlt" className="h-3 w-3" />
        {analyzeLabel} {currentEpisode ? `· ${currentEpisode.name}` : ''}
      </button>
      <button
        type="button"
        onClick={handleAnalyzeAllEpisodes}
        disabled={!canEdit || analyzeAll.isPending}
        title={t('analyzeAll.confirm')}
        className="kuiper-dashboard-secondary flex min-h-11 items-center gap-1.5 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        <AppIcon name="sparklesAlt" className="h-3 w-3" />
        {analyzeAll.isPending ? t('analyzeAll.submitting') : t('analyzeAll.button')}
      </button>
      <Link
        href={`/${locale}/workspace/asset-hub`}
        className="kuiper-dashboard-secondary inline-flex min-h-11 items-center px-4 text-sm"
      >
        {t('header.importFromLibrary')}
      </Link>
    </div>
  )

  const emptyStateCta = (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={handleAnalyze}
        disabled={analyzeDisabled}
        className="kuiper-dashboard-primary flex min-h-11 items-center gap-2 px-6 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AppIcon name="sparklesAlt" className="h-5 w-5" />
        {currentEpisode
          ? t('analyze.ctaWithEpisode', { label: analyzeLabel, episode: currentEpisode.name })
          : t('analyze.ctaWithoutEpisode', { label: analyzeLabel })}
      </button>
      <div className="text-sm text-[var(--production-ink-muted)]">
        {t('header.aiAnalyzeHelp')}
      </div>
      <Link
        href={`/${locale}/workspace/asset-hub`}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--production-tool)] hover:underline"
      >
        {t('header.orFromLibrary')}
      </Link>
    </div>
  )

  function getAppearanceStatus(
    resolution: ActiveCharacterAppearanceResolution,
  ): NonNullable<SubjectItem['appearanceStatus']> {
    if (resolution.status === 'resolved') {
      const name = resolution.appearance.changeReason
        ?? t('appearanceLabel.default')
      return {
        label: resolution.source === 'episode'
          ? t('activeAppearance.episode', { name })
          : t('activeAppearance.default', { name }),
        tone: 'info',
      }
    }
    if (resolution.status === 'loading') {
      return { label: t('activeAppearance.loading'), tone: 'warning' }
    }
    if (resolution.status === 'error') {
      return { label: t('activeAppearance.error'), tone: 'error' }
    }
    if (resolution.status === 'no-appearance') {
      return { label: t('activeAppearance.noAppearance'), tone: 'warning' }
    }
    return {
      label: resolution.reason === 'stale-binding'
        ? t('activeAppearance.staleBinding')
        : t('activeAppearance.bindingMissing'),
      tone: 'error',
    }
  }

  const characterItems: SubjectItem[] = characters.map((character) => {
    const resolution = getActiveAppearanceResolution(character)
    const appearance = resolution.status === 'resolved' ? resolution.appearance : null
    const appearanceId = appearance?.id ?? ''
    const roleSummary = character.introduction ?? character.description ?? null
    return {
      id: character.id,
      targetId: appearanceId,
      name: character.name ?? t('entityNames.untitledCharacter'),
      caption: character.role ?? t('entityNames.character'),
      description: roleSummary,
      visualPrompt: appearance?.description ?? null,
      imageUrl: pickCharacterAppearanceImage(appearance),
      appearanceStatus: getAppearanceStatus(resolution),
      onRegenerate: canEdit && resolution.status === 'resolved'
        ? () => handleRegenChar(character, resolution.appearance)
        : undefined,
      isRegenerating: regenInFlight.has(appearanceId) || serverInflightIds.has(appearanceId),
      isLocked: Boolean(character.profileConfirmed),
      onLock: canEdit && resolution.status === 'resolved'
        ? () => { void handleFinalizeProfile(character, resolution.appearance) }
        : undefined,
      isLocking: finalizingCharacterIds.has(character.id),
      lockError: finalizeErrors.get(character.id) ?? null,
      onUpload: canEdit && resolution.status === 'resolved'
        ? (file) => handleUploadChar(character, resolution.appearance, file)
        : undefined,
      isUploading: uploadInFlight.has(appearanceId),
      onZoom: (url) => setZoomImage(url),
      onOpenEditor: canEdit && (
        resolution.status === 'resolved' || resolution.status === 'no-appearance'
      )
        ? () => handleOpenCharacterModal(character)
        : undefined,
      onEditDescription: canEdit && resolution.status === 'resolved'
        ? () => handleEditDescStart(character, resolution.appearance)
        : undefined,
      isEditingDescription: editingDescId === appearanceId && appearanceId.length > 0,
      descriptionDraft: editingDescId === appearanceId ? editingDescDraft : '',
      onDescriptionDraftChange: setEditingDescDraft,
      onDescriptionSave: canEdit && resolution.status === 'resolved'
        ? () => handleEditDescSave(character, resolution.appearance)
        : undefined,
      onDescriptionCancel: handleEditDescCancel,
      isSavingDescription: updateAppearanceDesc.isPending,
      onRedescribe: canEdit
        && resolution.status === 'resolved'
        && (resolution.appearance.imageUrl || resolution.appearance.imageUrls)
        ? () => { void handleRedescribe(resolution.appearance) }
        : undefined,
      isRedescribing: redescribeInFlight.has(appearanceId),
      arkTargetType: 'CharacterAppearance' as const,
      arkTargetId: appearanceId || null,
      arkAssetId: appearance?.arkAssetId ?? null,
      arkAssetStatus: appearance?.arkAssetStatus ?? null,
      arkAssetSourceUrl: appearance?.arkAssetSourceUrl ?? null,
      arkAssetError: appearance?.arkAssetError ?? null,
      ...(canEdit && resolution.status === 'resolved' && handleArkRegister
        ? { onArkRegister: handleArkRegister }
        : {}),
    }
  })

  const locationItems: SubjectItem[] = locations.map((location) => {
    const images = (location.images as Array<{ id: string; imageUrl?: string | null }> | undefined) ?? []
    const selectedId = (location as { selectedImageId?: string | null }).selectedImageId ?? null
    const targetImage =
      (selectedId ? images.find((image) => image.id === selectedId) : null)
      ?? images.find((image) => Boolean(image.imageUrl))
    return {
      id: location.id,
      targetId: location.id,
      name: location.name ?? t('entityNames.untitledLocation'),
      caption: t('entityNames.scene'),
      description: location.description ?? null,
      imageUrl: pickLocationImage(location),
      onRegenerate: canEdit ? () => handleRegenLoc(location) : undefined,
      isRegenerating: regenInFlight.has(location.id) || serverInflightIds.has(location.id),
      onUpload: canEdit ? (file) => handleUploadLoc(location, file) : undefined,
      isUploading: uploadInFlight.has(location.id),
      onZoom: (url) => setZoomImage(url),
      onOpenEditor: canEdit ? () => setEditingLocationId(location.id) : undefined,
      onRedescribe: canEdit && targetImage?.imageUrl
        ? () => { void handleRedescribeLoc(location) }
        : undefined,
      isRedescribing: targetImage ? redescribeInFlight.has(targetImage.id) : false,
    }
  })

  const propItems: SubjectItem[] = props.map((prop) => ({
    id: prop.id,
    targetId: prop.id,
    name: prop.name ?? t('entityNames.untitledProp'),
    caption: t('entityNames.prop'),
    description: prop.summary ?? null,
    imageUrl: prop.imageUrl ?? null,
    onRegenerate: canEdit ? () => {
      markRegenStart(prop.id)
      const mutation = prop.imageUrl ? regenProp : generateProp
      mutation.mutate({ propId: prop.id })
    } : undefined,
    isRegenerating: regenInFlight.has(prop.id) || serverInflightIds.has(prop.id),
    onUpload: canEdit ? (file) => handleUploadProp(prop, file) : undefined,
    isUploading: uploadInFlight.has(prop.id),
    onZoom: (url) => setZoomImage(url),
    onRedescribe: canEdit && prop.imageUrl
      ? () => { void handleRedescribeProp(prop) }
      : undefined,
    isRedescribing: redescribeInFlight.has(prop.id),
    onOpenEditor: canEdit ? () => setEditingPropId(prop.id) : undefined,
  }))

  const activeItems = tab === 'character' ? characterItems : tab === 'scene' ? locationItems : propItems
  const characterMutationsBlocked = characters.some(
    (character) => getActiveAppearanceResolution(character).status !== 'resolved',
  )
  const activeTabRow = tabs.find((row) => row.id === tab) ?? tabs[0]
  const activeAssetError = tab === 'character'
    ? charactersQuery.error
    : tab === 'scene'
      ? locationsQuery.error
      : propsQuery.error
  const activeBindingError = !currentEpisodeId
    ? null
    : tab === 'character'
      ? episodeBindingsQuery.error
      : tab === 'scene'
        ? episodeLocationBindingsQuery.error
        : episodePropBindingsQuery.error
  const hasActiveError = Boolean(activeAssetError || activeBindingError)
  const hasStaleData = hasActiveError && activeItems.length > 0
  const missingImageCount = activeItems.filter((item) => !item.imageUrl).length
  const activeEntity = tab === 'character'
    ? t('entityNames.character')
    : tab === 'scene'
      ? t('entityNames.scene')
      : t('entityNames.prop')

  function refetchActiveEntity() {
    if (tab === 'character') void charactersQuery.refetch()
    else if (tab === 'scene') void locationsQuery.refetch()
    else void propsQuery.refetch()
    if (!currentEpisodeId) return
    if (tab === 'character') void episodeBindingsQuery.refetch()
    else if (tab === 'scene') void episodeLocationBindingsQuery.refetch()
    else void episodePropBindingsQuery.refetch()
  }

  const retryAction = (
    <button
      type="button"
      onClick={() => {
        void refetchAccess()
        refetchActiveEntity()
      }}
      className="kuiper-dashboard-primary min-h-11 px-4 text-sm"
    >
      {t('workstation.retry')}
    </button>
  )

  const workstationCopy: EntityWorkstationCopy = {
    listTitle: t('workstation.listTitle', { entity: activeTabRow?.label ?? activeEntity }),
    searchLabel: t('workstation.searchLabel', { entity: activeEntity }),
    searchPlaceholder: t('workstation.searchPlaceholder', { entity: activeEntity }),
    countLabel: t('workstation.count', { count: activeItems.length, entity: activeEntity }),
    backToList: t('workstation.backToList', { entity: activeEntity }),
    detailRegionLabel: t('workstation.detailRegion', { entity: activeEntity }),
    ready: t('workstation.status.ready'),
    needsImage: t('workstation.status.needsImage'),
    generating: t('workstation.status.generating'),
    approved: t('workstation.status.approved'),
    readOnly: t('workstation.status.readOnly'),
    loadingTitle: t('workstation.states.loadingTitle', { entity: activeEntity }),
    loadingDescription: t('workstation.states.loadingDescription'),
    emptyTitle: t('workstation.states.emptyTitle', { entity: activeEntity }),
    emptyDescription: t('workstation.states.emptyDescription'),
    errorTitle: t('workstation.states.errorTitle', { entity: activeEntity }),
    errorDescription: t('workstation.states.errorDescription'),
    staleTitle: t('workstation.states.staleTitle', { entity: activeEntity }),
    staleDescription: t('workstation.states.staleDescription'),
    permissionTitle: t('workstation.states.permissionTitle'),
    permissionDescription: t('workstation.states.permissionDescription'),
    partialTitle: t('workstation.states.partialTitle', { count: missingImageCount, entity: activeEntity }),
    partialDescription: t('workstation.states.partialDescription'),
  }

  const workstationToolbarActions = (
    <>
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => {
          if (canEdit) setManualAddOpen(tab)
        }}
        className="kuiper-dashboard-secondary flex min-h-11 items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        title={!canEdit ? viewerTip : t('manualAdd.titleByTab', { entity: activeEntity })}
      >
        <AppIcon name="plus" className="h-4 w-4" />
        {t('manualAdd.button')}
      </button>
      {tab === 'character' && characters.length > 0 ? (
        <button
          type="button"
          onClick={handleBatchRegenCharacters}
          disabled={!!batchGenInFlight || !canEdit || characterMutationsBlocked}
          title={characterMutationsBlocked ? t('activeAppearance.batchUnavailable') : viewerTip}
          className="kuiper-dashboard-secondary flex min-h-11 items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="sparklesAlt" className="h-4 w-4" />
          {batchGenInFlight === 'characters' && batchProgress
            ? t('batch.generating', { done: batchProgress.done, total: batchProgress.total })
            : t('batch.allChars')}
        </button>
      ) : null}
      {tab === 'scene' && locations.length > 0 ? (
        <button
          type="button"
          onClick={handleBatchRegenLocations}
          disabled={!!batchGenInFlight || !canEdit}
          title={viewerTip}
          className="kuiper-dashboard-secondary flex min-h-11 items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="sparklesAlt" className="h-4 w-4" />
          {batchGenInFlight === 'locations' && batchProgress
            ? t('batch.generating', { done: batchProgress.done, total: batchProgress.total })
            : t('batch.allScenes')}
        </button>
      ) : null}
      {tab === 'prop' && props.length > 0 ? (
        <button
          type="button"
          onClick={handleBatchGenProps}
          disabled={!!batchGenInFlight || !canEdit}
          title={viewerTip}
          className="kuiper-dashboard-secondary flex min-h-11 items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon name="sparklesAlt" className="h-4 w-4" />
          {batchGenInFlight === 'props' && batchProgress
            ? t('batch.generating', { done: batchProgress.done, total: batchProgress.total })
            : t('batch.allProps')}
        </button>
      ) : null}
      <Link
        href={buildHref(`/${locale}/v2/workspace/${projectId}/storyboard`)}
        className="kuiper-dashboard-secondary inline-flex min-h-11 items-center gap-2 px-4 text-sm"
      >
        {t('nextStep')} <AppIcon name="chevronRight" className="h-4 w-4" />
      </Link>
    </>
  )

  const analysisNotice = analyze.isError ? (
    <div className="rounded-[12px] border border-[var(--production-danger)]/30 bg-[var(--production-surface)] px-4 py-3 text-sm text-[var(--production-danger)]" role="alert">
      {t('analyze.submitFailed', { reason: (analyze.error as Error)?.message ?? t('analyze.submitFailedUnknown') })}
    </div>
  ) : taskStatus === 'failed' ? (
    <div className="rounded-[12px] border border-[var(--production-danger)]/30 bg-[var(--production-surface)] px-4 py-3 text-sm text-[var(--production-danger)]" role="alert" title={taskError ?? undefined}>
      {t('analyze.taskFailed', { message: taskErrorDisplay?.message ?? t('analyze.taskFailedNoMsg') })}
    </div>
  ) : isAnalyzing ? (
    <div className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-tool-soft)] px-4 py-3 text-sm text-[var(--production-tool)]" role="status">
      {t('analyze.inProgress', { progress: taskProgress })}
    </div>
  ) : taskStatus === 'completed' && serverInflightIds.size > 0 ? (
    <div className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-tool-soft)] px-4 py-3 text-sm text-[var(--production-tool)]" role="status">
      {t('analyze.completeBackground')}{' '}
      <strong>
        {t('analyze.inflightCounts.generic', { count: serverInflightCounts.total })}
      </strong>
      {t('analyze.inflightCounts.tail')}
    </div>
  ) : taskStatus === 'completed' && hasStoryboardPanels ? (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--production-border)] bg-[var(--production-surface)] px-4 py-3 text-sm text-[var(--production-ink)] sm:flex-row sm:items-center sm:justify-between" role="status">
      <div>
        {t.rich('analyze.doneFullPipeline', {
          when: taskUpdatedAt ? t('analyze.whenAt', { time: new Date(taskUpdatedAt).toLocaleTimeString() }) : '',
          panelCount: storyboardPanelCount,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </div>
      <Link href={buildHref(`/${locale}/v2/workspace/${projectId}/storyboard`)} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-[var(--production-tool)] hover:underline">
        {t('analyze.doneFullPipelineLink')} <AppIcon name="chevronRight" className="h-4 w-4" />
      </Link>
    </div>
  ) : taskStatus === 'completed' ? (
    <div className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-surface)] px-4 py-3 text-sm text-[var(--production-ink)]" role="status">
      {t('analyze.doneAssetsOnly', {
        when: taskUpdatedAt ? t('analyze.whenAt', { time: new Date(taskUpdatedAt).toLocaleTimeString() }) : '',
      })}
    </div>
  ) : null

  return (
    <div>
      <EntityWorkstation
        locale={locale}
        eyebrow={t('pageTitle')}
        title={activeTabRow?.label ?? activeEntity}
        description={t(`workstation.descriptions.${tab}`)}
        context={currentEpisode ? t('workstation.episodeScope', { episode: currentEpisode.name }) : t('workstation.projectScope')}
        headerActions={compactAnalyzeButton}
        tabs={tabs}
        activeTab={tab}
        onTabChange={setTab}
        items={activeItems}
        copy={workstationCopy}
        scopeStatus={currentEpisode?.name}
        toolbarActions={workstationToolbarActions}
        notice={(
          <>
            {analysisNotice}
            {tab === 'character' && currentEpisode && isFilteringByEpisode && hiddenInThisEpisodeCount > 0 ? (
              <div className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-surface)] px-4 py-3 text-sm text-[var(--production-ink-muted)]">
                {t('filteredHint', {
                  episode: currentEpisode.name,
                  visibleCount: characters.length,
                  hiddenCount: hiddenInThisEpisodeCount,
                })}
              </div>
            ) : null}
          </>
        )}
        loading={isLoading}
        error={hasActiveError}
        stale={hasStaleData}
        accessLoading={accessLoading}
        accessDenied={!accessLoading && !allowed}
        readOnly={allowed && !canEdit}
        missingImageCount={missingImageCount}
        retryAction={retryAction}
        emptyAction={emptyStateCta}
        renderDetail={(item) => (
          <SubjectGrid
            items={[item]}
            aspect={tab === 'scene' ? 'wide' : 'portrait'}
            layout="detail"
            emptyHint={workstationCopy.emptyDescription}
          />
        )}
      />

      {canEdit && editingCharacterId ? (() => {
        const c = characters.find((ch) => ch.id === editingCharacterId)
        if (!c) return null
        const resolution = getActiveAppearanceResolution(c)
        if (resolution.status === 'no-appearance') {
          return (
            <V2CharacterAppearanceRecoveryModal
              projectId={projectId}
              currentEpisodeId={currentEpisodeId}
              characterId={c.id}
              onClose={handleCloseCharacterModal}
            />
          )
        }
        if (resolution.status !== 'resolved') return null
        const ap = resolution.appearance
        const apId = ap.id
        return (
          <V2CharacterEditModal
            projectId={projectId}
            currentEpisodeId={currentEpisodeId}
            character={c}
            activeAppearance={ap}
            activeAppearanceSource={resolution.source}
            imageUrl={pickCharacterAppearanceImage(ap)}
            onClose={handleCloseCharacterModal}
            onZoomImage={(url) => setZoomImage(url)}
            onRegenerate={() => handleRegenChar(c, ap)}
            onUploadFile={(file) => handleUploadChar(c, ap, file)}
            onUploadAndExpandToMultiView={(file) => handleUploadAndExpandToMultiView(c, ap, file)}
            isRegenerating={regenInFlight.has(apId)}
            isUploading={uploadInFlight.has(apId)}
            isExpanding={uploadExpand.isPending}
            onSaveName={(name) => handleSaveCharacterName(c.id, name)}
            onSaveIntroduction={(intro) => handleSaveIntroduction(c.id, intro)}
            onSaveVisualPrompt={(prompt) => {
              if (!apId) {
                alert(t('alerts.needAppearanceRegen'))
                return
              }
              handleSaveVisualPromptFromModal(c.id, apId, prompt)
            }}
            isSavingName={updateCharName.isPending}
            isSavingIntroduction={updateCharIntro.isPending}
            isSavingVisualPrompt={updateAppearanceDesc.isPending}
            onRedescribe={() => handleRedescribe(ap)}
            isRedescribing={redescribeInFlight.has(apId)}
            onToggleLock={() => { void handleFinalizeProfile(c, ap) }}
            isLocking={finalizingCharacterIds.has(c.id)}
            lockError={finalizeErrors.get(c.id) ?? null}
            onDelete={() => handleDeleteCharacterFromModal(c.id)}
            isDeleting={deleteCharacter.isPending}
          />
        )
      })() : null}

      {canEdit && editingLocationId ? (() => {
        const l = locations.find((loc) => loc.id === editingLocationId)
        if (!l) return null
        return (
          <V2LocationEditModal
            location={l as unknown as {
              id: string
              name?: string | null
              summary?: string | null
              description?: string | null
              images?: Array<{ id: string; imageIndex?: number | null; description?: string | null }> | null
            }}
            imageUrl={pickLocationImage(l)}
            onClose={() => setEditingLocationId(null)}
            onZoomImage={(url) => setZoomImage(url)}
            onRegenerate={() => handleRegenLoc(l)}
            onUploadFile={(file) => handleUploadLoc(l, file)}
            isRegenerating={regenInFlight.has(l.id) || serverInflightIds.has(l.id)}
            isUploading={uploadInFlight.has(l.id)}
            onSaveBasics={(params) => {
              if (!canEdit) return
              updateLocBasics.mutate(
                {
                  locationId: l.id,
                  name: params.name,
                  note: params.note,
                  metadata: (params.metadata as unknown as Record<string, unknown> | null),
                },
                {
                  onError: (err) => {
                    alert(err instanceof Error ? err.message : t('alerts.saveFailed'))
                  },
                },
              )
            }}
            isSavingBasics={updateLocBasics.isPending}
            onSaveDescription={(description) => {
              if (!canEdit) return
              updateLocDescription.mutate(
                { locationId: l.id, description, imageIndex: 0 },
                {
                  onError: (err) => {
                    alert(err instanceof Error ? err.message : t('alerts.saveFailed'))
                  },
                },
              )
            }}
            isSavingDescription={updateLocDescription.isPending}
            views={(l.images ?? [])
              .filter((img): img is { id: string; imageIndex: number; viewName?: string | null; description?: string | null; imageUrl?: string | null } =>
                typeof img.id === 'string' && typeof img.imageIndex === 'number',
              )
              .sort((a, b) => a.imageIndex - b.imageIndex)}
            onCreateView={async (params) => {
              if (!canEdit) return
              try {
                const res = await createLocationView.mutateAsync({
                  locationId: l.id,
                  viewName: params.viewName,
                  description: params.description || undefined,
                })
                // After create, immediately trigger image generation against
                // the newly-created LocationImage row. The create API only
                // returns the metadata row; worker has to actually generate
                // the image. We grab the new imageIndex from the response.
                const newImage = (res as { image?: { imageIndex?: number } } | null)?.image
                if (newImage && typeof newImage.imageIndex === 'number') {
                  markRegenStart(l.id)
                  regenLoc.mutate({ locationId: l.id, imageIndex: newImage.imageIndex })
                }
              } catch (err) {
                alert(err instanceof Error ? err.message : t('alerts.createViewFailed'))
              }
            }}
            isCreatingView={createLocationView.isPending}
            onRegenerateView={(imageIndex) => {
              if (!canEdit) return
              markRegenStart(l.id)
              regenLoc.mutate({ locationId: l.id, imageIndex })
            }}
            onDeleteView={async (imageIndex) => {
              if (!canEdit) return
              try {
                await deleteLocationView.mutateAsync({ locationId: l.id, imageIndex })
              } catch (err) {
                alert(err instanceof Error ? err.message : t('alerts.deleteViewFailed'))
              }
            }}
            isViewRegenerating={(_imageIndex) => regenInFlight.has(l.id) || serverInflightIds.has(l.id)}
            isDeletingView={deleteLocationView.isPending}
          />
        )
      })() : null}

      {canEdit && editingPropId ? (() => {
        const p = props.find((pp) => pp.id === editingPropId)
        if (!p) return null
        return (
          <V2PropEditModal
            prop={{
              id: p.id,
              name: p.name ?? null,
              summary: p.summary ?? null,
              imageUrl: p.imageUrl ?? null,
            }}
            imageUrl={p.imageUrl ?? null}
            onClose={() => setEditingPropId(null)}
            onZoomImage={(url) => setZoomImage(url)}
            onSaveName={(name) => handleSavePropName(p.id, name)}
            onSaveSummary={(summary) => handleSavePropSummary(p.id, summary)}
            isSavingName={updatePropName.isPending}
            isSavingSummary={updatePropSummary.isPending}
            onRegenerate={() => {
              if (!canEdit) return
              markRegenStart(p.id)
              const mut = p.imageUrl ? regenProp : generateProp
              mut.mutate({ propId: p.id })
            }}
            onUploadFile={(file) => handleUploadProp(p, file)}
            isRegenerating={regenInFlight.has(p.id) || serverInflightIds.has(p.id)}
            isUploading={uploadInFlight.has(p.id)}
            onDelete={() => handleDeletePropFromModal(p.id)}
            isDeleting={deleteProp.isPending}
          />
        )
      })() : null}

      <DarkMediaLightbox
        src={zoomImage}
        alt={t('lightbox.alt')}
        closeLabel={t('lightbox.closeAria')}
        dismissHint={t('lightbox.escHint')}
        onClose={() => setZoomImage(null)}
      />

      {/* 角色 — V2 stone/amber 風格,3 模式: 提示詞/參考圖/上傳四視圖。
          後端邏輯複用 useCharacterCreationSubmit hook(跟舊玻璃版同一份),
          只是 UI 重刻。 */}
      {canEdit && manualAddOpen === 'character' ? (
        <V2CharacterCreationModal
          projectId={projectId}
          episodeId={currentEpisodeId}
          onClose={() => setManualAddOpen(null)}
          onSuccess={() => setManualAddOpen(null)}
        />
      ) : null}

      {/* 場景 — 自定的 V2LocationCreationModal,鏡像 V2LocationEditModal 的 metadata + 上傳/AI 生成入口 */}
      {canEdit && manualAddOpen === 'scene' ? (
        <V2LocationCreationModal
          isSubmitting={manualAddSubmitting}
          onClose={() => {
            if (manualAddSubmitting) return
            setManualAddOpen(null)
            setManualUploadRecovery(null)
            setManualUploadError(null)
            manualCreateRequestRef.current = null
          }}
          onSubmit={(params) => handleManualAddLocation(params)}
          uploadRecovery={manualUploadRecovery?.kind === 'scene' ? manualUploadRecovery : null}
          uploadError={manualUploadError}
        />
      ) : null}

      {/* 道具 — 暫用簡版 V2ManualAddSubjectModal(name + 描述 + 圖片足以) */}
      {canEdit && manualAddOpen === 'prop' ? (
        <V2ManualAddSubjectModal
          subjectType="prop"
          onClose={() => {
            if (manualAddSubmitting) return
            setManualAddOpen(null)
            setManualUploadRecovery(null)
            setManualUploadError(null)
            manualCreateRequestRef.current = null
          }}
          isSubmitting={manualAddSubmitting}
          onSubmit={(params) => handleManualAddProp(params)}
          uploadRecovery={manualUploadRecovery?.kind === 'prop' ? manualUploadRecovery : null}
          uploadError={manualUploadError}
        />
      ) : null}
    </div>
  )
}

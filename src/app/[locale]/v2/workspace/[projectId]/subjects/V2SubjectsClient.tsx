'use client'

/**
 * Phase 12.4 — v2 SubjectsPage (劇本拆解 / Script Breakdown) client implementation.
 *
 * Tabs across 角色 / 場景 / 道具.  For now 道具 is a stub
 * because Phase 11.3 (props as first-class assets) is still ⏸ —
 * the tab is shown but the grid says "coming Phase 11.3".
 *
 * Each character / location card shows the primary appearance
 * image (from EpisodeCharacter junction or DB), the role / desc,
 * and on hover surfaces "重新生成" + "鎖定" actions. Both routes
 * to existing endpoints.
 */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
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
  useConfirmProjectCharacterProfile,
  useUpdateProjectCharacterIntroduction,
} from '@/lib/query/mutations/character-profile-mutations'
import {
  useUpdateProjectAppearanceDescription,
  useUploadAndExpandCharacterToMultiView,
} from '@/lib/query/mutations/character-image-ops-mutations'
import { useAnalyzeProjectAssets } from '@/lib/query/mutations/useProjectConfigMutations'
import { V2CharacterEditModal } from './V2CharacterEditModal'
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
  useCreateCharacterAppearance,
  useEpisodeCharacterBindings,
  useEpisodeLocationBindings,
} from '@/lib/query/mutations/episode-character-binding-mutations'
import { queryKeys } from '@/lib/query/keys'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'
import {
  type Tab,
  type V2SubjectsClientProps,
  type CharacterLike,
  type LocationLike,
  pickCharacterImage,
  pickLocationImage,
} from './subjects-client-helpers'
import { SubjectGrid } from './SubjectGrid'

export function V2SubjectsClient({ projectId, locale }: V2SubjectsClientProps) {
  const t = useTranslations('v2Subjects')
  const queryClient = useQueryClient()
  // Phase 12.5 — viewer-role users see disabled mutation buttons.
  const { canEdit } = useProjectAccess(projectId)
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
  const confirmProfile = useConfirmProjectCharacterProfile(projectId)
  const updateAppearanceDesc = useUpdateProjectAppearanceDescription(projectId)
  const updateLocBasics = useUpdateProjectLocationBasics(projectId)
  const updateLocDescription = useUpdateProjectLocationDescription(projectId)
  const createLocationView = useCreateLocationView(projectId)
  const deleteLocationView = useDeleteLocationView(projectId)
  const createCharAppearance = useCreateCharacterAppearance(projectId)
  const updateCharIntro = useUpdateProjectCharacterIntroduction(projectId)
  const updateCharName = useUpdateProjectCharacterName(projectId)
  const deleteCharacter = useDeleteProjectCharacter(projectId)
  const uploadExpand = useUploadAndExpandCharacterToMultiView(projectId)
  const analyze = useAnalyzeProjectAssets(projectId)
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
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [editingDescId, setEditingDescId] = useState<string | null>(null) // appearanceId
  const [editingDescDraft, setEditingDescDraft] = useState<string>('')
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [editingPropId, setEditingPropId] = useState<string | null>(null)
  const [manualAddOpen, setManualAddOpen] = useState<ManualAddSubjectType | null>(null)
  const [manualAddSubmitting, setManualAddSubmitting] = useState(false)

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
  const episodeBindingIds = useMemo(() => {
    const set = new Set<string>()
    for (const b of episodeBindingsQuery.data ?? []) set.add(b.characterId)
    return set
  }, [episodeBindingsQuery.data])
  const episodeLocationBindingsQuery = useEpisodeLocationBindings(projectId, currentEpisodeId)
  const episodeLocationBindingIds = useMemo(() => {
    const set = new Set<string>()
    for (const b of episodeLocationBindingsQuery.data ?? []) set.add(b.locationId)
    return set
  }, [episodeLocationBindingsQuery.data])
  const characters: CharacterLike[] = currentEpisodeId
    ? allCharacters.filter((c) => episodeBindingIds.has(c.id))
    : allCharacters
  const locations: LocationLike[] = currentEpisodeId
    ? allLocations.filter((l) => episodeLocationBindingIds.has(l.id))
    : allLocations
  const isFilteringByEpisode = !!currentEpisodeId
  const hiddenInThisEpisodeCount = isFilteringByEpisode
    ? allCharacters.length - characters.length
    : 0

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

  function handleRegenChar(c: CharacterLike) {
    const appearanceId = c.appearances?.[0]?.id
    if (!appearanceId) {
      alert(t('alerts.needAppearanceFirst'))
      return
    }
    markRegenStart(appearanceId)
    regenChar.mutate({ characterId: c.id, appearanceId, imageIndex: 0 })
  }

  function handleRegenLoc(l: LocationLike) {
    markRegenStart(l.id)
    regenLoc.mutate({ locationId: l.id, imageIndex: 0 })
  }

  function handleOpenCharacterModal(c: CharacterLike) {
    setEditingCharacterId(c.id)
  }

  function handleCloseCharacterModal() {
    setEditingCharacterId(null)
  }

  function handleSaveIntroduction(characterId: string, introduction: string) {
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
    updatePropSummary.mutate(
      { propId, summary },
      {
        onError: (err) => alert(t('alerts.savePropDescFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') })),
      },
    )
  }
  function handleDeletePropFromModal(propId: string) {
    deleteProp.mutate(
      { propId },
      {
        onSuccess: () => setEditingPropId(null),
        onError: (err) => alert(t('alerts.deletePropFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') })),
      },
    )
  }

  function handleSaveVisualPromptFromModal(characterId: string, appearanceId: string, visualPrompt: string) {
    updateAppearanceDesc.mutate(
      { characterId, appearanceId, description: visualPrompt, descriptionIndex: 0 },
      {
        onError: (err) => {
          alert(t('alerts.saveAppearanceFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  function handleUploadAndExpandToMultiView(c: CharacterLike, file: File) {
    const ap = c.appearances?.[0]
    if (!ap?.id) {
      alert(t('alerts.needAppearanceRegen'))
      return
    }
    // Track via the same regen overlay since the worker generates 3
    // images (~ 60-180s on Tencent VOD). The poll loop on /assets will
    // pick up the new imageUrls and the overlay clears via the 5min
    // safety timeout or sooner once images surface.
    markRegenStart(ap.id)
    uploadExpand.mutate(
      { file, characterId: c.id, appearanceId: ap.id },
      {
        onError: (err) => {
          alert(t('alerts.multiViewFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  function handleDeleteCharacterFromModal(characterId: string) {
    deleteCharacter.mutate(characterId, {
      onSuccess: () => setEditingCharacterId(null),
      onError: (err) => {
        alert(t('alerts.deleteFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
      },
    })
  }

  function handleEditDescStart(c: CharacterLike) {
    const ap = c.appearances?.[0]
    if (!ap) {
      alert(t('alerts.needAppearanceMultiView'))
      return
    }
    setEditingDescId(ap.id)
    setEditingDescDraft(ap.description ?? c.description ?? '')
  }

  function handleEditDescCancel() {
    setEditingDescId(null)
    setEditingDescDraft('')
  }

  function handleEditDescSave(c: CharacterLike) {
    const ap = c.appearances?.[0]
    if (!ap) return
    const description = editingDescDraft.trim()
    if (!description) {
      alert(t('alerts.descCannotEmpty'))
      return
    }
    updateAppearanceDesc.mutate(
      { characterId: c.id, appearanceId: ap.id, description, descriptionIndex: 0 },
      {
        onSuccess: () => {
          setEditingDescId(null)
          setEditingDescDraft('')
        },
      },
    )
  }

  function handleConfirmProfile(c: CharacterLike) {
    if (c.profileConfirmed) return // already locked — no-op (un-lock not exposed yet)
    confirmProfile.mutate({ characterId: c.id, generateImage: false })
  }

  // Manually re-describe an asset from its current image. Shared by
  // character / location / prop cards. Same intent everywhere: the
  // upload-time auto-rewrite is the happy path; this is the escape
  // hatch for legacy uploads (data that predates auto-rewrite) and
  // for refreshing description when the selected image changes.
  async function callRedescribe(
    endpoint: string,
    body: Record<string, string>,
    inFlightKey: string,
  ): Promise<boolean> {
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

  async function handleRedescribe(c: CharacterLike) {
    const ap = c.appearances?.[0]
    if (!ap) return
    await callRedescribe(
      `/api/novel-promotion/${projectId}/character/appearance/redescribe`,
      { appearanceId: ap.id },
      ap.id,
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
    if (batchGenInFlight) return
    if (characters.length === 0) {
      alert(t('alerts.noCharsAnalyze'))
      return
    }
    setBatchGenInFlight('characters')
    setBatchProgress({ done: 0, total: characters.length })
    try {
      let done = 0
      // Sequential to avoid hammering the image provider; switch to
      // Promise.all if user wants pure parallel later.
      for (const c of characters) {
        const appearanceId = c.appearances?.[0]?.id
        if (!appearanceId) {
          done++
          setBatchProgress({ done, total: characters.length })
          continue
        }
        try {
          await regenCharGroup.mutateAsync({ characterId: c.id, appearanceId })
        } catch (err) {
           
          console.warn('[batch-regen] character', c.id, err)
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

  async function handleUploadChar(c: CharacterLike, file: File) {
    // Multi-appearance schema stores images on CharacterAppearance rows,
    // not directly on the character. When the script-extraction pipeline
    // creates a character it doesn't pre-seed an appearance — that gets
    // built on first generate / regenerate. So if the user hits "上傳替換"
    // before ever generating, we need to materialize a default appearance
    // ourselves before the upload-asset-image call has a row to attach to.
    let appearanceId = c.appearances?.[0]?.id
    let appearanceChangeReason = c.appearances?.[0]?.changeReason ?? t('appearanceLabel.default')
    if (!appearanceId) {
      try {
        const created = (await createCharAppearance.mutateAsync({
          characterId: c.id,
          changeReason: t('appearanceLabel.original'),
          description: c.description ?? '',
        })) as { appearance?: { id?: string } } | undefined
        const newId = created?.appearance?.id
        if (!newId) {
          alert(t('alerts.uploadAppearanceNoId'))
          return
        }
        appearanceId = newId
        appearanceChangeReason = t('appearanceLabel.original')
      } catch (err) {
        alert(t('alerts.uploadAppearanceFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        return
      }
    }
    setUploadInFlight((prev) => new Set(prev).add(appearanceId!))
    // labelText is required by /upload-asset-image. Use a deterministic
    // human-readable label so it appears the same way generated images do.
    const labelText = `${c.name ?? t('entityNames.character')} - ${appearanceChangeReason}`
    uploadCharImage.mutate(
      { file, characterId: c.id, appearanceId: appearanceId!, imageIndex: 0, labelText },
      {
        onSettled: () => markUploadDone(appearanceId!),
        onError: (err) => {
          alert(t('alerts.uploadFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
        },
      },
    )
  }

  function handleUploadLoc(l: LocationLike, file: File) {
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

  async function handleManualAddLocation(params: {
    name: string
    description: string
    summary?: string | null
    file: File | null
  }) {
    setManualAddSubmitting(true)
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: params.name,
          description: params.description || undefined,
          summary: params.summary || undefined,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${text}`)
      }
      const data = (await res.json()) as { location?: { id: string } }
      const locId = data.location?.id
      if (params.file && locId) {
        await uploadLocImage.mutateAsync({
          file: params.file,
          locationId: locId,
          imageIndex: 0,
          labelText: params.name,
        })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.locations(projectId) })
      setManualAddOpen(null)
    } catch (err) {
      alert(t('alerts.createFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
    } finally {
      setManualAddSubmitting(false)
    }
  }

  async function handleManualAddProp(params: {
    name: string
    description: string
    file: File | null
  }) {
    setManualAddSubmitting(true)
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/prop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: params.name,
          summary: params.description || undefined,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${text}`)
      }
      const data = (await res.json()) as { prop?: { id: string } }
      const propId = data.prop?.id
      if (params.file && propId) {
        await uploadPropImage.mutateAsync({
          file: params.file,
          propId,
          labelText: params.name,
        })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.props(projectId) })
      setManualAddOpen(null)
    } catch (err) {
      alert(t('alerts.createFailed', { reason: (err as Error)?.message ?? t('alerts.unknown') }))
    } finally {
      setManualAddSubmitting(false)
    }
  }

  const props = (propsQuery.data ?? []) as Array<{
    id: string
    name: string
    summary?: string | null
    description?: string | null
    imageUrl?: string | null
  }>
  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'character', label: t('tabs.character'), count: characters.length },
    { id: 'scene', label: t('tabs.scene'), count: locations.length },
    { id: 'prop', label: t('tabs.prop'), count: props.length },
  ]

  // Include binding queries — without them, the strict per-episode filter
  // briefly returns [] during the binding-query inflight window and the
  // grid flashes "empty" before the real cast/scenes arrive.
  const isLoading =
    charactersQuery.isLoading
    || locationsQuery.isLoading
    || (!!currentEpisodeId && (episodeBindingsQuery.isLoading || episodeLocationBindingsQuery.isLoading))

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
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleAnalyze}
        disabled={analyzeDisabled}
        className="flex items-center gap-1.5 rounded-sm border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 font-mono text-[12px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <AppIcon name="sparklesAlt" className="h-3 w-3" />
        {analyzeLabel} {currentEpisode ? `· ${currentEpisode.name}` : ''}
      </button>
      <Link
        href={`/${locale}/workspace/asset-hub`}
        className="font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-amber-300"
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
        className="flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-3 font-serif-cn text-base font-medium text-stone-950 shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AppIcon name="sparklesAlt" className="h-5 w-5" />
        {currentEpisode
          ? t('analyze.ctaWithEpisode', { label: analyzeLabel, episode: currentEpisode.name })
          : t('analyze.ctaWithoutEpisode', { label: analyzeLabel })}
      </button>
      <div className="font-mono text-[12px] tracking-wider text-stone-500">
        {t('header.aiAnalyzeHelp')}
      </div>
      <Link
        href={`/${locale}/workspace/asset-hub`}
        className="font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-amber-300"
      >
        {t('header.orFromLibrary')}
      </Link>
    </div>
  )

  return (
    <div className="px-12 py-10">
      {/* Compact analyze toolbar — replaces the deleted amber CTA strip.
          Ambient access to 重新分析 when the grid already has items.
          When grid is empty, SubjectGrid renders the bigger emptyStateCta
          inside its empty card so the user has a clearer next action. */}
      <div className="mb-4 flex items-center justify-end">
        {compactAnalyzeButton}
      </div>

      {/* Status banner — reads from server task snapshot, persists across navigation */}
      {analyze.isError ? (
        <div className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
          {t('analyze.submitFailed', { reason: (analyze.error as Error)?.message ?? t('analyze.submitFailedUnknown') })}
        </div>
      ) : taskStatus === 'failed' ? (
        <div
          className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300"
          title={taskError ?? undefined}
        >
          {t('analyze.taskFailed', { message: taskErrorDisplay?.message ?? t('analyze.taskFailedNoMsg') })}
        </div>
      ) : isAnalyzing ? (
        <div className="mb-6 rounded-sm border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-serif-cn text-sm text-amber-300">
          {t('analyze.inProgress', { progress: taskProgress })}
        </div>
      ) : taskStatus === 'completed' && serverInflightIds.size > 0 ? (
        <div className="mb-6 rounded-sm border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-serif-cn text-sm text-amber-300">
          {t('analyze.completeBackground')}
          {(() => {
            // Localised comma-joined breakdown — "3 character images,
            // 1 scene image" in en, "3 張角色圖、1 張場景圖" in zh.
            const parts: string[] = []
            if (serverInflightCounts.character > 0) {
              parts.push(t('analyze.inflightCounts.character', { count: serverInflightCounts.character }))
            }
            if (serverInflightCounts.location > 0) {
              parts.push(t('analyze.inflightCounts.location', { count: serverInflightCounts.location }))
            }
            if (serverInflightCounts.prop > 0) {
              parts.push(t('analyze.inflightCounts.prop', { count: serverInflightCounts.prop }))
            }
            const text = parts.length > 0 ? parts.join('、') : t('analyze.inflightCounts.generic', { count: serverInflightIds.size })
            return <strong> {text}</strong>
          })()}
          {t('analyze.inflightCounts.tail')}
        </div>
      ) : taskStatus === 'completed' && hasStoryboardPanels ? (
        <div className="mb-6 flex flex-col gap-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-serif-cn text-sm text-emerald-300">
            {t.rich('analyze.doneFullPipeline', {
              when: taskUpdatedAt ? t('analyze.whenAt', { time: new Date(taskUpdatedAt).toLocaleTimeString() }) : '',
              panelCount: storyboardPanelCount,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
          <Link
            href={buildHref(`/${locale}/v2/workspace/${projectId}/storyboard`)}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-sm border border-emerald-500/40 bg-emerald-500/20 px-4 py-1.5 font-mono text-[14px] tracking-wider text-emerald-200 transition-all hover:bg-emerald-500/30"
          >
            {t('analyze.doneFullPipelineLink')} <AppIcon name="chevronRight" className="h-3 w-3" />
          </Link>
        </div>
      ) : taskStatus === 'completed' ? (
        <div className="mb-6 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 font-serif-cn text-sm text-emerald-300">
          {t('analyze.doneAssetsOnly', {
            when: taskUpdatedAt ? t('analyze.whenAt', { time: new Date(taskUpdatedAt).toLocaleTimeString() }) : '',
          })}
        </div>
      ) : null}

      <div className="mb-8 flex items-center justify-between">
        <div className="flex gap-1 rounded-sm border border-stone-800/50 bg-stone-900/50 p-1">
          {tabs.map((tabRow) => (
            <button
              key={tabRow.id}
              type="button"
              onClick={() => setTab(tabRow.id)}
              className={`rounded-sm px-5 py-2 font-serif-cn text-sm transition-all ${
                tab === tabRow.id
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {tabRow.label}
              <span className="ml-2 font-mono text-[14px] opacity-60">{tabRow.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* 手動新增 — 三個 tab 都顯示,用「+」icon 區分。
              點開 V2ManualAddSubjectModal,filled in 後 POST + 上傳,
              既不依賴劇本分析,也不阻擋自動分析流程。 */}
          <button
            type="button"
            disabled={!canEdit}
            onClick={() =>
              setManualAddOpen(
                tab === 'character' ? 'character' : tab === 'scene' ? 'scene' : 'prop',
              )
            }
            className="flex items-center gap-2 rounded-sm border border-stone-700 bg-stone-900/50 px-4 py-2 font-serif-cn text-sm text-stone-200 transition-all hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            title={!canEdit ? viewerTip : t('manualAdd.titleByTab', { entity: tab === 'character' ? t('entityNames.character') : tab === 'scene' ? t('entityNames.scene') : t('entityNames.prop') })}
          >
            <AppIcon name="plus" className="h-4 w-4" />
            {t('manualAdd.button')}
          </button>
          {tab === 'character' && characters.length > 0 ? (
            <button
              type="button"
              onClick={handleBatchRegenCharacters}
              disabled={!!batchGenInFlight || !canEdit}
              title={viewerTip}
              className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-serif-cn text-sm text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-serif-cn text-sm text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-serif-cn text-sm text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {batchGenInFlight === 'props' && batchProgress
                ? t('batch.generating', { done: batchProgress.done, total: batchProgress.total })
                : t('batch.allProps')}
            </button>
          ) : null}
          <Link
            href={buildHref(`/${locale}/v2/workspace/${projectId}/storyboard`)}
            className="flex items-center gap-2 rounded-sm border border-stone-700 bg-stone-900/50 px-4 py-2 font-serif-cn text-sm text-stone-300 transition-all hover:border-amber-500/50 hover:text-amber-300"
          >
            {t('nextStep')} <AppIcon name="chevronRight" className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {tab === 'character' && currentEpisode && isFilteringByEpisode && hiddenInThisEpisodeCount > 0 ? (
        <div className="mb-4 rounded-sm border border-stone-800/50 bg-stone-900/40 px-3 py-2 font-mono text-[14px] tracking-wider text-stone-400">
          {t('filteredHint', {
            episode: currentEpisode.name,
            visibleCount: characters.length,
            hiddenCount: hiddenInThisEpisodeCount,
          })}
        </div>
      ) : null}

      {isLoading ? (
        <p className="font-mono text-xs tracking-wider text-stone-500">{t('loading')}</p>
      ) : tab === 'character' ? (
        <SubjectGrid
          items={characters.map((c) => {
            const ap = c.appearances?.[0]
            const apId = ap?.id ?? ''
            // Role description (身份/關係) prefers Character.introduction
            // — that's the human-readable LLM tagline. Visual prompt
            // (used by image regen) lives on appearance.description and
            // is what the inline editor mutates.
            const roleSummary = c.introduction ?? c.description ?? null
            const visualPrompt = ap?.description ?? null
            // Phase 3 — 火山 asset state on the primary appearance.
            // useProjectCharacters already pulls all appearance columns
            // via prisma `include: { appearances: true }`; cast to widen
            // the type to include the new ARK fields.
            const apWithArk = ap as typeof ap & {
              arkAssetId?: string | null
              arkAssetStatus?: string | null
              arkAssetSourceUrl?: string | null
              arkAssetError?: string | null
            } | undefined
            return {
              id: c.id,
              targetId: apId,
              name: c.name ?? t('entityNames.untitledCharacter'),
              caption: c.role ?? t('entityNames.character'),
              description: roleSummary,
              visualPrompt,
              imageUrl: pickCharacterImage(c),
              // Phase 12.5 — mutation handlers undefined for viewers
              // so SubjectGrid card buttons render disabled / hidden.
              onRegenerate: canEdit ? () => handleRegenChar(c) : undefined,
              isRegenerating: regenInFlight.has(apId) || serverInflightIds.has(apId),
              isLocked: Boolean(c.profileConfirmed),
              onLock: canEdit ? () => handleConfirmProfile(c) : undefined,
              isLocking: confirmProfile.isPending,
              onUpload: canEdit ? (file) => handleUploadChar(c, file) : undefined,
              isUploading: uploadInFlight.has(apId),
              onZoom: (url) => setZoomImage(url),
              // Open editor stays available — opens read-only modal for viewers
              onOpenEditor: () => handleOpenCharacterModal(c),
              // Inline description editing is local-only UI state until save fires
              onEditDescription: canEdit ? () => handleEditDescStart(c) : undefined,
              isEditingDescription: editingDescId === apId && apId.length > 0,
              descriptionDraft: editingDescId === apId ? editingDescDraft : '',
              onDescriptionDraftChange: setEditingDescDraft,
              onDescriptionSave: canEdit ? () => handleEditDescSave(c) : undefined,
              onDescriptionCancel: handleEditDescCancel,
              isSavingDescription: updateAppearanceDesc.isPending,
              // "從圖抽描述" — only meaningful when the appearance has
              // an image to look at. Skip otherwise so the button
              // doesn't render dead.
              onRedescribe: canEdit && (ap?.imageUrl || ap?.imageUrls)
                ? () => { void handleRedescribe(c) }
                : undefined,
              isRedescribing: redescribeInFlight.has(apId),
              // 2026-05-23 Phase 3 — ARK asset chip for the primary
              // appearance. apId guards: no appearance → chip doesn't
              // render (caller checks arkTargetId truthy). Multi-
              // appearance characters surface the [0] chip here;
              // the per-appearance chips inside V2CharacterEditModal
              // handle the rest.
              arkTargetType: 'CharacterAppearance' as const,
              arkTargetId: apId || null,
              arkAssetId: apWithArk?.arkAssetId ?? null,
              arkAssetStatus: apWithArk?.arkAssetStatus ?? null,
              arkAssetSourceUrl: apWithArk?.arkAssetSourceUrl ?? null,
              arkAssetError: apWithArk?.arkAssetError ?? null,
              ...(handleArkRegister ? { onArkRegister: handleArkRegister } : {}),
            }
          })}
          emptyHint={currentEpisode ? t('card.emptyDefault', { episode: currentEpisode.name }) : t('card.emptyDefaultNoEpisode')}
          emptyAction={emptyStateCta}
        />
      ) : tab === 'scene' ? (
        <SubjectGrid
          aspect="wide"
          items={locations.map((l) => {
            const images = (l.images as Array<{ id: string; imageUrl?: string | null }> | undefined) ?? []
            const selectedId = (l as { selectedImageId?: string | null }).selectedImageId ?? null
            const targetImage =
              (selectedId ? images.find((img) => img.id === selectedId) : null)
              ?? images.find((img) => Boolean(img.imageUrl))
            return {
              id: l.id,
              targetId: l.id,
              name: l.name ?? t('entityNames.untitledLocation'),
              caption: t('entityNames.scene'),
              description: l.description ?? null,
              imageUrl: pickLocationImage(l),
              onRegenerate: canEdit ? () => handleRegenLoc(l) : undefined,
              isRegenerating: regenInFlight.has(l.id) || serverInflightIds.has(l.id),
              onUpload: canEdit ? (file) => handleUploadLoc(l, file) : undefined,
              isUploading: uploadInFlight.has(l.id),
              onZoom: (url) => setZoomImage(url),
              onOpenEditor: () => setEditingLocationId(l.id),
              onRedescribe: canEdit && targetImage?.imageUrl
                ? () => { void handleRedescribeLoc(l) }
                : undefined,
              isRedescribing: targetImage ? redescribeInFlight.has(targetImage.id) : false,
            }
          })}
          emptyHint={currentEpisode ? t('card.emptySceneDefault', { episode: currentEpisode.name }) : t('card.emptySceneDefaultNoEpisode')}
          emptyAction={emptyStateCta}
        />
      ) : (
        <SubjectGrid
          aspect="portrait"
          items={props.map((p) => ({
            id: p.id,
            targetId: p.id,
            name: p.name ?? t('entityNames.untitledProp'),
            caption: t('entityNames.prop'),
            description: p.summary ?? null,
            imageUrl: p.imageUrl ?? null,
            onRegenerate: canEdit ? () => {
              markRegenStart(p.id)
              const mut = p.imageUrl ? regenProp : generateProp
              mut.mutate({ propId: p.id })
            } : undefined,
            isRegenerating: regenInFlight.has(p.id) || serverInflightIds.has(p.id),
            onUpload: canEdit ? (file) => handleUploadProp(p, file) : undefined,
            isUploading: uploadInFlight.has(p.id),
            onZoom: (url) => setZoomImage(url),
            onRedescribe: canEdit && p.imageUrl
              ? () => { void handleRedescribeProp(p) }
              : undefined,
            isRedescribing: redescribeInFlight.has(p.id),
            onOpenEditor: () => setEditingPropId(p.id),
          }))}
          emptyHint={
            currentEpisode
              ? t('card.emptyPropDefault', { episode: currentEpisode.name })
              : t('card.emptyPropDefaultNoEpisode')
          }
          emptyAction={emptyStateCta}
        />
      )}

      {editingCharacterId ? (() => {
        const c = characters.find((ch) => ch.id === editingCharacterId)
        if (!c) return null
        const ap = c.appearances?.[0]
        const apId = ap?.id ?? ''
        return (
          <V2CharacterEditModal
            projectId={projectId}
            character={c}
            imageUrl={pickCharacterImage(c)}
            onClose={handleCloseCharacterModal}
            onZoomImage={(url) => setZoomImage(url)}
            onRegenerate={() => handleRegenChar(c)}
            onUploadFile={(file) => handleUploadChar(c, file)}
            onUploadAndExpandToMultiView={(file) => handleUploadAndExpandToMultiView(c, file)}
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
            onRedescribe={apId ? () => handleRedescribe(c) : undefined}
            isRedescribing={apId ? redescribeInFlight.has(apId) : false}
            onToggleLock={() => handleConfirmProfile(c)}
            isLocking={confirmProfile.isPending}
            onDelete={() => handleDeleteCharacterFromModal(c.id)}
            isDeleting={deleteCharacter.isPending}
          />
        )
      })() : null}

      {editingLocationId ? (() => {
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
              markRegenStart(l.id)
              regenLoc.mutate({ locationId: l.id, imageIndex })
            }}
            onDeleteView={async (imageIndex) => {
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

      {editingPropId ? (() => {
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

      {zoomImage ? (
        <button
          type="button"
          aria-label={t('lightbox.closeAria')}
          onClick={() => setZoomImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/90 p-6 backdrop-blur-md"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomImage}
            alt={t('lightbox.alt')}
            className="max-h-full max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="absolute right-6 top-6 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-1.5 font-mono text-[14px] tracking-wider text-stone-300">
            {t('lightbox.escHint')}
          </span>
        </button>
      ) : null}

      {/* 角色 — V2 stone/amber 風格,3 模式: 提示詞/參考圖/上傳四視圖。
          後端邏輯複用 useCharacterCreationSubmit hook(跟舊玻璃版同一份),
          只是 UI 重刻。 */}
      {manualAddOpen === 'character' ? (
        <V2CharacterCreationModal
          projectId={projectId}
          onClose={() => setManualAddOpen(null)}
          onSuccess={() => {
            setManualAddOpen(null)
            void queryClient.invalidateQueries({
              queryKey: queryKeys.projectAssets.characters(projectId),
            })
          }}
        />
      ) : null}

      {/* 場景 — 自定的 V2LocationCreationModal,鏡像 V2LocationEditModal 的 metadata + 上傳/AI 生成入口 */}
      {manualAddOpen === 'scene' ? (
        <V2LocationCreationModal
          isSubmitting={manualAddSubmitting}
          onClose={() => {
            if (manualAddSubmitting) return
            setManualAddOpen(null)
          }}
          onSubmit={(params) => handleManualAddLocation(params)}
        />
      ) : null}

      {/* 道具 — 暫用簡版 V2ManualAddSubjectModal(name + 描述 + 圖片足以) */}
      {manualAddOpen === 'prop' ? (
        <V2ManualAddSubjectModal
          subjectType="prop"
          onClose={() => {
            if (manualAddSubmitting) return
            setManualAddOpen(null)
          }}
          isSubmitting={manualAddSubmitting}
          onSubmit={(params) => handleManualAddProp(params)}
        />
      ) : null}
    </div>
  )
}

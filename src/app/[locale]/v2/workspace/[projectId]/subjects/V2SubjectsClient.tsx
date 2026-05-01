'use client'

/**
 * Phase 12.4 — v2 SubjectsPage (主體) client implementation.
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
import { AppIcon } from '@/components/ui/icons'
import { useProjectCharacters, useProjectLocations } from '@/lib/query/hooks/useProjectAssets'
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
  useUploadProjectCharacterImage,
  useDeleteProjectCharacter,
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
} from '@/lib/query/mutations/episode-character-binding-mutations'
import { queryKeys } from '@/lib/query/keys'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'

type Tab = 'character' | 'scene' | 'prop'

interface V2SubjectsClientProps {
  projectId: string
  locale: string
}

interface CharacterAppearanceLike {
  id: string
  appearanceIndex?: number
  description?: string | null
  changeReason?: string | null
  imageUrl?: string | null
  // After /api/.../assets the server has already signed each entry and
  // converted the field from a JSON-string to an array. The raw DB shape
  // is JSON-string, so accept both forms here defensively.
  imageUrls?: string | string[] | null
}

interface CharacterLike {
  id: string
  name?: string | null
  role?: string | null
  description?: string | null
  // Character.introduction (身份/關係/稱呼映射) is the human-readable
  // role description produced by analyze-novel. Used as the primary
  // source for the card's role text now that it's persisted again.
  introduction?: string | null
  imageUrl?: string | null
  profileConfirmed?: boolean | null
  appearances?: CharacterAppearanceLike[] | null
  // Voice reference + LLM-extracted profile JSON. Surfaced in the
  // V2CharacterEditModal as the audio uploader and the tag chips.
  customVoiceUrl?: string | null
  voiceId?: string | null
  voiceType?: string | null
  profileData?: string | null
}

interface LocationLike {
  id: string
  name?: string | null
  summary?: string | null
  description?: string | null
  imageUrl?: string | null
  images?: Array<{
    id?: string
    imageIndex?: number | null
    viewName?: string | null
    description?: string | null
    imageUrl?: string | null
  }> | null
}

function pickCharacterImage(c: CharacterLike): string | null {
  // Character itself doesn't carry imageUrl in the schema, but the legacy
  // payload sometimes attached one — keep the fallback for safety.
  if (c.imageUrl) return c.imageUrl
  const first = c.appearances?.[0]
  if (!first) return null
  // Prefer the appearance's singular imageUrl (already signed by attach).
  if (first.imageUrl) return first.imageUrl
  // Else read from imageUrls. The API returns an Array<string> after
  // signing; the raw DB shape is a JSON-string. Handle both.
  const raw = first.imageUrls
  if (!raw) return null
  if (Array.isArray(raw)) {
    return raw.find((u) => typeof u === 'string' && u.length > 0) || null
  }
  try {
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null
  } catch {
    return null
  }
}

function pickLocationImage(l: LocationLike): string | null {
  if (l.imageUrl) return l.imageUrl
  const found = l.images?.find((img) => Boolean(img.imageUrl))
  return found?.imageUrl ?? null
}

export function V2SubjectsClient({ projectId, locale }: V2SubjectsClientProps) {
  const queryClient = useQueryClient()
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
  const regenChar = useRegenerateSingleCharacterImage(projectId)
  const regenLoc = useRegenerateSingleLocationImage(projectId)
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
  const updateCharIntro = useUpdateProjectCharacterIntroduction(projectId)
  const deleteCharacter = useDeleteProjectCharacter(projectId)
  const uploadExpand = useUploadAndExpandCharacterToMultiView(projectId)
  const analyze = useAnalyzeProjectAssets(projectId)
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)

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
  const [batchGenInFlight, setBatchGenInFlight] = useState<'characters' | 'locations' | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)

  // Per-target in-flight tracking. The shared mutation `isPending` flag
  // is only true for the ~1s submission phase; the actual worker takes
  // 30-90s. We keep a Set of target ids (appearanceId for characters,
  // locationId for scenes) and show "生成中…" overlay until the asset
  // refetch surfaces a new image, or a 120s safety timeout clears it.
  const [regenInFlight, setRegenInFlight] = useState<Set<string>>(new Set())
  const [uploadInFlight, setUploadInFlight] = useState<Set<string>>(new Set())
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [editingDescId, setEditingDescId] = useState<string | null>(null) // appearanceId
  const [editingDescDraft, setEditingDescDraft] = useState<string>('')
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)

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
    type: ['image_character', 'image_location', 'regenerate_group', 'reference_to_character'],
  })
  const serverInflightIds = useMemo(() => {
    // Single Set for both CharacterAppearance.id and Location.id —
    // they're disjoint UUID spaces, so collision-free, and lets the
    // location render path read the same gating signal that the
    // character path uses without having to thread two state shapes.
    const set = new Set<string>()
    for (const t of activeImageTasks.data ?? []) {
      if (typeof t.targetId !== 'string') continue
      if (t.targetType === 'CharacterAppearance' || t.targetType === 'LocationImage') {
        set.add(t.targetId)
      }
    }
    return set
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
      alert('還沒有任何集數 — 請先到「劇本」step 貼劇本並儲存')
      return
    }
    analyze.mutate(
      // V2 path opts in to the full analyze → CLIPS_BUILD → SCRIPT_TO_STORYBOARD_RUN
      // cascade. Without this, the storyboard worker would later fail with
      // "No clips found" because Session B made the cascade opt-in for
      // legacy /workspace flows.
      { episodeId: currentEpisodeId, cascadeToStoryboard: true },
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
      alert('此角色還沒有 appearance,請先回劇本 step 跑分析')
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
          alert(`儲存角色描述失敗:${(err as Error)?.message ?? '未知錯誤'}`)
        },
      },
    )
  }

  function handleSaveVisualPromptFromModal(characterId: string, appearanceId: string, visualPrompt: string) {
    updateAppearanceDesc.mutate(
      { characterId, appearanceId, description: visualPrompt, descriptionIndex: 0 },
      {
        onError: (err) => {
          alert(`儲存外觀提示詞失敗:${(err as Error)?.message ?? '未知錯誤'}`)
        },
      },
    )
  }

  function handleUploadAndExpandToMultiView(c: CharacterLike, file: File) {
    const ap = c.appearances?.[0]
    if (!ap?.id) {
      alert('此角色還沒有 appearance,請先點重新生成建立首張')
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
          alert(`提交多視角生成失敗:${(err as Error)?.message ?? '未知錯誤'}`)
        },
      },
    )
  }

  function handleDeleteCharacterFromModal(characterId: string) {
    deleteCharacter.mutate(characterId, {
      onSuccess: () => setEditingCharacterId(null),
      onError: (err) => {
        alert(`刪除失敗:${(err as Error)?.message ?? '未知錯誤'}`)
      },
    })
  }

  function handleEditDescStart(c: CharacterLike) {
    const ap = c.appearances?.[0]
    if (!ap) {
      alert('此角色還沒有 appearance,請先點重新生成建立首張 appearance')
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
      alert('描述不能為空')
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

  async function handleBatchRegenCharacters() {
    if (batchGenInFlight) return
    if (characters.length === 0) {
      alert('沒有角色 — 先到上方點「一鍵分析」')
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
          // eslint-disable-next-line no-console
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
      alert('沒有場景 — 先到上方點「一鍵分析」')
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
          // eslint-disable-next-line no-console
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

  function handleUploadChar(c: CharacterLike, file: File) {
    const ap = c.appearances?.[0]
    if (!ap?.id) {
      alert('此角色還沒有 appearance,請先點「重新生成」建立首張 appearance')
      return
    }
    setUploadInFlight((prev) => new Set(prev).add(ap.id))
    // labelText is required by /upload-asset-image. Use a deterministic
    // human-readable label so it appears the same way generated images do.
    const labelText = `${c.name ?? '角色'} - ${ap.changeReason ?? '形象'}`
    uploadCharImage.mutate(
      { file, characterId: c.id, appearanceId: ap.id, imageIndex: 0, labelText },
      {
        onSettled: () => markUploadDone(ap.id),
        onError: (err) => {
          alert(`上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
        },
      },
    )
  }

  function handleUploadLoc(l: LocationLike, file: File) {
    setUploadInFlight((prev) => new Set(prev).add(l.id))
    const labelText = `${l.name ?? '場景'}`
    uploadLocImage.mutate(
      { file, locationId: l.id, imageIndex: 0, labelText },
      {
        onSettled: () => markUploadDone(l.id),
        onError: (err) => {
          alert(`上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
        },
      },
    )
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'character', label: '角色', count: characters.length },
    { id: 'scene', label: '場景', count: locations.length },
    { id: 'prop', label: '道具', count: 0 },
  ]

  // Include binding queries — without them, the strict per-episode filter
  // briefly returns [] during the binding-query inflight window and the
  // grid flashes "empty" before the real cast/scenes arrive.
  const isLoading =
    charactersQuery.isLoading
    || locationsQuery.isLoading
    || (!!currentEpisodeId && (episodeBindingsQuery.isLoading || episodeLocationBindingsQuery.isLoading))

  return (
    <div className="px-12 py-10">
      {/* Analyze CTA strip — Stage C: independent subjects analysis */}
      <div className="mb-6 flex flex-col gap-4 rounded-sm border border-amber-500/30 bg-amber-500/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-fraunces text-sm italic text-amber-400">
            分析{currentEpisode ? `「${currentEpisode.name}」` : '當前集'}的劇本
          </div>
          <div className="mt-1 font-mono text-[10px] tracking-wider text-stone-500">
            從劇本自動抽出角色 / 場景 — 完成後可在下方卡片點「重新生成」/「鎖定」/上傳替換
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyze.isPending || isAnalyzing || !currentEpisodeId}
            className="flex items-center gap-2 rounded-sm bg-amber-500 px-5 py-2.5 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className="h-4 w-4" />
            {analyze.isPending
              ? '提交中…'
              : isAnalyzing
                ? `分析中… ${taskProgress}%`
                : taskStatus === 'completed'
                  ? '重新分析'
                  : '一鍵分析'}
          </button>
          <Link
            href={`/${locale}/workspace/asset-hub`}
            className="font-mono text-[10px] tracking-wider text-stone-500 transition-colors hover:text-amber-300"
          >
            或從素材庫導入 →
          </Link>
        </div>
      </div>

      {/* Status banner — reads from server task snapshot, persists across navigation */}
      {analyze.isError ? (
        <div className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
          提交失敗:{(analyze.error as Error)?.message ?? '未知錯誤'}
        </div>
      ) : taskStatus === 'failed' ? (
        <div className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
          分析任務失敗:{taskError ?? '未知錯誤'}
        </div>
      ) : isAnalyzing ? (
        <div className="mb-6 rounded-sm border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-serif-cn text-sm text-amber-300">
          ⏳ 分析中… 進度 {taskProgress}% (LLM 跑完約 30-90 秒,完成後角色/場景會自動出現)
        </div>
      ) : taskStatus === 'completed' && serverInflightIds.size > 0 ? (
        <div className="mb-6 rounded-sm border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-serif-cn text-sm text-amber-300">
          ⚙️ 分析完成 — 後台正在自動重新生成 <strong>{serverInflightIds.size}</strong> 張角色圖,
          每張約 30-90 秒,完成後卡片會自動更新(別離開頁面也沒關係,任務在 server 端跑)
        </div>
      ) : taskStatus === 'completed' && hasStoryboardPanels ? (
        <div className="mb-6 flex flex-col gap-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-serif-cn text-sm text-emerald-300">
            ✓ 分析已完成{taskUpdatedAt ? ` · ${new Date(taskUpdatedAt).toLocaleTimeString('zh-TW')}` : ''} —
            角色 / 場景 / <strong>分鏡 {storyboardPanelCount} 個</strong> 都好了
          </div>
          <Link
            href={`/${locale}/v2/workspace/${projectId}/storyboard`}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-sm border border-emerald-500/40 bg-emerald-500/20 px-4 py-1.5 font-mono text-[10px] tracking-wider text-emerald-200 transition-all hover:bg-emerald-500/30"
          >
            → 進入分鏡頁 <AppIcon name="chevronRight" className="h-3 w-3" />
          </Link>
        </div>
      ) : taskStatus === 'completed' ? (
        <div className="mb-6 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 font-serif-cn text-sm text-emerald-300">
          ✓ 上次分析已完成{taskUpdatedAt ? ` · ${new Date(taskUpdatedAt).toLocaleTimeString('zh-TW')}` : ''} — 角色 / 場景已寫入下方卡片(分鏡正在後台繼續處理)
        </div>
      ) : null}

      <div className="mb-8 flex items-center justify-between">
        <div className="flex gap-1 rounded-sm border border-stone-800/50 bg-stone-900/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-sm px-5 py-2 font-serif-cn text-sm transition-all ${
                tab === t.id
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {t.label}
              <span className="ml-2 font-mono text-[10px] opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {tab === 'character' && characters.length > 0 ? (
            <button
              type="button"
              onClick={handleBatchRegenCharacters}
              disabled={!!batchGenInFlight}
              className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-serif-cn text-sm text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {batchGenInFlight === 'characters' && batchProgress
                ? `生成中… ${batchProgress.done}/${batchProgress.total}`
                : '一鍵生圖所有角色'}
            </button>
          ) : null}
          {tab === 'scene' && locations.length > 0 ? (
            <button
              type="button"
              onClick={handleBatchRegenLocations}
              disabled={!!batchGenInFlight}
              className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-serif-cn text-sm text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {batchGenInFlight === 'locations' && batchProgress
                ? `生成中… ${batchProgress.done}/${batchProgress.total}`
                : '一鍵生圖所有場景'}
            </button>
          ) : null}
          <Link
            href={`/${locale}/v2/workspace/${projectId}/storyboard`}
            className="flex items-center gap-2 rounded-sm border border-stone-700 bg-stone-900/50 px-4 py-2 font-serif-cn text-sm text-stone-300 transition-all hover:border-amber-500/50 hover:text-amber-300"
          >
            下一步 → 分鏡 <AppIcon name="chevronRight" className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {tab === 'character' && currentEpisode && isFilteringByEpisode && hiddenInThisEpisodeCount > 0 ? (
        <div className="mb-4 rounded-sm border border-stone-800/50 bg-stone-900/40 px-3 py-2 font-mono text-[10px] tracking-wider text-stone-400">
          只顯示「{currentEpisode.name}」出現的 {characters.length} 個角色 ·
          其他集數有 {hiddenInThisEpisodeCount} 個隱藏 · 切到其他集數 tab 可看到那邊的角色
        </div>
      ) : null}

      {isLoading ? (
        <p className="font-mono text-xs tracking-wider text-stone-500">載入中…</p>
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
            return {
              id: c.id,
              targetId: apId,
              name: c.name ?? '未命名角色',
              caption: c.role ?? '角色',
              description: roleSummary,
              visualPrompt,
              imageUrl: pickCharacterImage(c),
              onRegenerate: () => handleRegenChar(c),
              isRegenerating: regenInFlight.has(apId) || serverInflightIds.has(apId),
              isLocked: Boolean(c.profileConfirmed),
              onLock: () => handleConfirmProfile(c),
              isLocking: confirmProfile.isPending,
              onUpload: (file) => handleUploadChar(c, file),
              isUploading: uploadInFlight.has(apId),
              onZoom: (url) => setZoomImage(url),
              onOpenEditor: () => handleOpenCharacterModal(c),
              onEditDescription: () => handleEditDescStart(c),
              isEditingDescription: editingDescId === apId && apId.length > 0,
              descriptionDraft: editingDescId === apId ? editingDescDraft : '',
              onDescriptionDraftChange: setEditingDescDraft,
              onDescriptionSave: () => handleEditDescSave(c),
              onDescriptionCancel: handleEditDescCancel,
              isSavingDescription: updateAppearanceDesc.isPending,
            }
          })}
          emptyHint="此項目還沒有角色 — 點上方「一鍵分析」抽出此集的角色,或從素材庫導入"
        />
      ) : tab === 'scene' ? (
        <SubjectGrid
          aspect="wide"
          items={locations.map((l) => ({
            id: l.id,
            targetId: l.id,
            name: l.name ?? '未命名場景',
            caption: '場景',
            description: l.description ?? null,
            imageUrl: pickLocationImage(l),
            onRegenerate: () => handleRegenLoc(l),
            isRegenerating: regenInFlight.has(l.id) || serverInflightIds.has(l.id),
            onUpload: (file) => handleUploadLoc(l, file),
            isUploading: uploadInFlight.has(l.id),
            onZoom: (url) => setZoomImage(url),
            onOpenEditor: () => setEditingLocationId(l.id),
          }))}
          emptyHint="此項目還沒有場景 — 點上方「一鍵分析」抽出此集的場景,或從素材庫導入"
        />
      ) : (
        <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
          <AppIcon name="cube" className="mx-auto mb-3 h-8 w-8 text-stone-600" />
          <p className="font-fraunces text-base italic text-stone-400">道具 first-class 待 Phase 11.3 上線</p>
          <p className="mt-2 font-mono text-[10px] tracking-wider text-stone-600">PROP_ASSETS · COMING SOON</p>
        </div>
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
            onSaveIntroduction={(intro) => handleSaveIntroduction(c.id, intro)}
            onSaveVisualPrompt={(prompt) => {
              if (!apId) {
                alert('此角色還沒有 appearance — 請先點重新生成建立首張')
                return
              }
              handleSaveVisualPromptFromModal(c.id, apId, prompt)
            }}
            isSavingIntroduction={updateCharIntro.isPending}
            isSavingVisualPrompt={updateAppearanceDesc.isPending}
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
                    alert(err instanceof Error ? err.message : '儲存失敗')
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
                    alert(err instanceof Error ? err.message : '儲存失敗')
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
                alert(err instanceof Error ? err.message : '建立視角失敗')
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
                alert(err instanceof Error ? err.message : '刪除視角失敗')
              }
            }}
            isViewRegenerating={(_imageIndex) => regenInFlight.has(l.id) || serverInflightIds.has(l.id)}
            isDeletingView={deleteLocationView.isPending}
          />
        )
      })() : null}

      {zoomImage ? (
        <button
          type="button"
          aria-label="關閉預覽"
          onClick={() => setZoomImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/90 p-6 backdrop-blur-md"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomImage}
            alt="預覽"
            className="max-h-full max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="absolute right-6 top-6 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-1.5 font-mono text-[10px] tracking-wider text-stone-300">
            ESC / 點背景關閉
          </span>
        </button>
      ) : null}
    </div>
  )
}

interface SubjectItem {
  id: string
  targetId: string
  name: string
  caption: string
  // Role/identity description (Character.introduction). User-friendly,
  // shown as a subtitle under the name.
  description: string | null
  // Image-generation prompt (Appearance.description). What the inline
  // editor mutates and what the regen worker feeds to the image model.
  visualPrompt?: string | null
  imageUrl: string | null
  onRegenerate?: () => void
  isRegenerating?: boolean
  isLocked?: boolean
  onLock?: () => void
  isLocking?: boolean
  onUpload?: (file: File) => void
  isUploading?: boolean
  onZoom?: (url: string) => void
  // Open the full edit modal (character cards only).
  onOpenEditor?: () => void
  // Visual-prompt editor (character cards only).
  onEditDescription?: () => void
  isEditingDescription?: boolean
  descriptionDraft?: string
  onDescriptionDraftChange?: (next: string) => void
  onDescriptionSave?: () => void
  onDescriptionCancel?: () => void
  isSavingDescription?: boolean
}

function SubjectGrid({
  items,
  emptyHint,
  aspect = 'portrait',
}: {
  items: SubjectItem[]
  emptyHint: string
  // Characters are 3:4 portrait (full-body 三视图). Scenes are 16:9
  // wide (Approach A widescreen). Forcing portrait on a wide source
  // center-crops it into a vertical strip and hides the left/right
  // composition we explicitly told the model to draw.
  aspect?: 'portrait' | 'wide'
}) {
  const aspectClass = aspect === 'wide' ? 'aspect-video' : 'aspect-[3/4]'
  if (items.length === 0) {
    return (
      <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
        <p className="font-fraunces text-base italic text-stone-400">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={item.id}
          className="group overflow-hidden rounded-sm border border-stone-800/50 bg-stone-900/30 transition-all hover:border-amber-500/40"
        >
          <div
            className={`relative ${aspectClass} overflow-hidden bg-gradient-to-br from-stone-800 to-stone-900 ${
              item.imageUrl && item.onZoom ? 'cursor-zoom-in' : ''
            }`}
            onClick={() => {
              if (item.imageUrl && item.onZoom) item.onZoom(item.imageUrl)
            }}
          >
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <AppIcon name="image" className="h-8 w-8 text-stone-600" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-stone-950/95 via-stone-950/30 to-transparent" />
            <div className="absolute left-3 top-3 rounded-sm bg-stone-950/40 px-2 py-1 font-mono text-[9px] tracking-[0.2em] text-stone-300/80 backdrop-blur-sm">
              {String(i + 1).padStart(3, '0')}
            </div>
            <div className="absolute bottom-3 left-3 right-3">
              <div className="font-fraunces text-[11px] italic text-amber-300/90">{item.caption}</div>
            </div>
            {item.isRegenerating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/70 backdrop-blur-sm">
                <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-amber-400" />
                <div className="font-mono text-[10px] tracking-wider text-amber-300">生圖中…</div>
                <div className="px-4 text-center font-serif-cn text-[10px] text-stone-400">
                  Tencent VOD AIGC 30-90 秒,撞並發限制會自動重試
                </div>
              </div>
            ) : item.isUploading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/70 backdrop-blur-sm">
                <AppIcon name="cloudUpload" className="h-6 w-6 animate-pulse text-amber-400" />
                <div className="font-mono text-[10px] tracking-wider text-amber-300">上傳中…</div>
              </div>
            ) : null}
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={item.onOpenEditor}
                disabled={!item.onOpenEditor}
                title={item.onOpenEditor ? '點擊編輯角色完整檔案' : undefined}
                className="truncate text-left font-serif-cn text-base text-stone-100 transition-colors enabled:hover:text-amber-300 disabled:cursor-default"
              >
                {item.name}
              </button>
              <div className="flex items-center gap-2">
                {item.onOpenEditor ? (
                  <button
                    type="button"
                    onClick={item.onOpenEditor}
                    className="flex flex-shrink-0 items-center gap-1 font-mono text-[9px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
                    title="開啟完整編輯器 — 改名/描述/外觀提示詞/刪除"
                  >
                    <AppIcon name="edit" className="h-3 w-3" />
                    編輯
                  </button>
                ) : null}
                {item.onEditDescription && !item.isEditingDescription ? (
                  <button
                    type="button"
                    onClick={item.onEditDescription}
                    className="flex flex-shrink-0 items-center gap-1 font-mono text-[9px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
                    title="只快速改外觀提示詞"
                  >
                    改外觀
                  </button>
                ) : null}
              </div>
            </div>
            {item.description ? (
              <div className="mt-1 line-clamp-2 font-body text-xs leading-relaxed text-stone-400">
                {item.description}
              </div>
            ) : null}
            {item.isEditingDescription ? (
              <div className="mt-3 space-y-2 rounded-sm border border-amber-500/30 bg-stone-950/40 p-2">
                <div className="flex items-center justify-between font-mono text-[9px] tracking-wider text-amber-500/70">
                  <span>外觀提示詞 (image prompt)</span>
                  <span className="text-stone-600">{item.descriptionDraft?.length ?? 0} 字</span>
                </div>
                <textarea
                  value={item.descriptionDraft ?? ''}
                  onChange={(e) => item.onDescriptionDraftChange?.(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-sm border border-amber-500/40 bg-stone-900/80 p-2 font-body text-xs text-stone-200 outline-none focus:border-amber-500"
                  placeholder="例:三十岁中年男性,黑短发,商务衬衫卷袖,深灰西裤,腕表,神情冷峻... (越具體越穩)"
                  disabled={item.isSavingDescription}
                />
                <div className="flex items-center justify-end gap-2 font-mono text-[10px] tracking-wider">
                  <button
                    type="button"
                    onClick={item.onDescriptionCancel}
                    disabled={item.isSavingDescription}
                    className="text-stone-500 transition-colors hover:text-stone-300 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={item.onDescriptionSave}
                    disabled={item.isSavingDescription}
                    className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {item.isSavingDescription ? '儲存中…' : '儲存提示詞'}
                  </button>
                </div>
              </div>
            ) : item.visualPrompt ? (
              <div className="mt-2 rounded-sm border border-stone-800/40 bg-stone-950/30 p-2">
                <div className="mb-1 font-mono text-[9px] tracking-wider text-stone-500">
                  外觀提示詞
                </div>
                <div className="line-clamp-3 font-body text-[11px] leading-relaxed text-stone-400">
                  {item.visualPrompt}
                </div>
              </div>
            ) : item.onEditDescription ? (
              <div className="mt-2 font-body text-[11px] italic text-stone-600">
                (還沒有外觀提示詞 — 點「改外觀」加上,或重跑「一鍵分析」自動生成)
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-stone-800/50 px-4 pb-3 pt-2 font-mono text-[10px] tracking-wider">
            {item.onRegenerate ? (
              <button
                type="button"
                disabled={item.isRegenerating}
                onClick={item.onRegenerate}
                className="flex items-center gap-1 text-stone-300 transition-all hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                title="用 AI 重新生成此圖"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {item.isRegenerating ? '生成中…' : '重新生成'}
              </button>
            ) : null}

            {item.onUpload ? (
              <UploadButton
                disabled={!!item.isUploading}
                onFile={item.onUpload}
                label={item.isUploading ? '上傳中…' : '上傳替換'}
              />
            ) : null}

            {item.imageUrl ? (
              <a
                href={item.imageUrl}
                download={`${item.name}.png`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-stone-300 transition-all hover:text-amber-400"
                title="下載原圖"
              >
                <AppIcon name="cloudUpload" className="h-3 w-3 rotate-180" />
                下載
              </a>
            ) : null}

            <span className="ml-auto" />
            {item.onLock ? (
              <button
                type="button"
                disabled={item.isLocking || item.isLocked}
                onClick={item.onLock}
                title={item.isLocked ? '已標記為「定稿」(純註記,沒有實際 binding 影響)' : '標記為「定稿」(純註記用)— 角色與集數的綁定是自動的,不需要鎖定'}
                className={`transition-all disabled:cursor-not-allowed ${
                  item.isLocked ? 'text-amber-400' : 'text-stone-400 hover:text-amber-400'
                } ${item.isLocking ? 'opacity-50' : ''}`}
              >
                {item.isLocking ? '鎖定中…' : item.isLocked ? '✓ 已鎖定' : '⊙ 鎖定'}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function UploadButton({
  onFile,
  disabled,
  label,
}: {
  onFile: (file: File) => void
  disabled: boolean
  label: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          // Reset so re-uploading the same file fires onChange again.
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1 text-stone-300 transition-all hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        title="上傳自製圖片替換"
      >
        <AppIcon name="cloudUpload" className="h-3 w-3" />
        {label}
      </button>
    </>
  )
}

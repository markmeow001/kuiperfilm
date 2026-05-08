'use client'

/**
 * Phase 12.5.4 commit 2 — group card with editable descriptions +
 * per-group multi-shot regen.
 *
 * Each card owns:
 *   - Local description / dialogue drafts per member panel
 *   - Save state per panel (mutation pending / error)
 *   - One regenerate-multi-shot button that submits this group only
 *
 * The card is intentionally "dumb" about overrides in commit 2 —
 * commit 3 will plumb characterOverrides / locationOverrides
 * through `onRegenerate` so the swap-modal pickers can re-anchor
 * subject identity.
 */

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MultiShotBindingsRail } from './MultiShotBindingsRail'
import { CharacterAppearancePickerModal } from './CharacterAppearancePickerModal'
import { LocationViewPickerModal } from './LocationViewPickerModal'
import {
  useMultiShotTask,
  type MultiShotCharacterBinding,
} from '@/lib/query/hooks/useMultiShotTask'
import type { UseMutationResult } from '@tanstack/react-query'

interface PanelLike {
  id: string
  description?: string | null
  prompt?: string | null
  srtSegment?: string | null
  characters?: string[] | null
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
}

interface CharacterAppearanceRef {
  id: string
  appearanceIndex?: number
  changeReason?: string | null
  description?: string | null
  imageUrl?: string | null
}

interface CharacterRef {
  id: string
  name: string
  appearances?: CharacterAppearanceRef[]
}

interface LocationImageRef {
  id: string
  imageIndex?: number
  description?: string | null
  imageUrl?: string | null
  viewName?: string | null
}

interface LocationRef {
  id: string
  name: string
  images?: LocationImageRef[]
}

type UpdatePanelTextMutation = UseMutationResult<
  unknown,
  Error,
  { panelId: string; description?: string; srtSegment?: string }
>

export interface GroupRegenOverrides {
  characterOverrides: Array<{ characterId: string; appearanceId?: string }>
  locationOverrides: Array<{ locationId: string; viewName?: string }>
  // Phase 2 — segment-level merged narrative + duration override.
  // When `rawPrompt` is non-empty the worker bypasses per-panel
  // prompt assembly and uses this verbatim (intelligence mode).
  rawPrompt?: string
  // Length must equal panelIds.length, sum 5-15. Triggers customize
  // multi-shot mode in the worker so each panel slice gets its own
  // duration anchor in Kling Omni's multi_prompt array.
  panelDurations?: number[]
}

interface GroupCardProps {
  groupId: string
  groupOrdinal: number
  groupLabel: string
  accentClass: string
  panels: PanelLike[]
  taskId: string | null
  projectId: string
  updatePanelText: UpdatePanelTextMutation
  characterRoster?: CharacterRef[]
  locationRoster?: LocationRef[]
  /**
   * Approximate per-group runtime in seconds. Used to compute a
   * cumulative time range badge in the collapsed header so the
   * editor reads like the Seedance 2.0 video plan UI the user
   * referenced. Defaults to 15s when not provided.
   */
  segmentDurationSeconds?: number
  /**
   * Episode number (1-indexed) — folded into the download filename
   * as `ep{N}_group{NN}.mp4` so user keeps a sane archive across
   * multi-episode projects.
   */
  episodeNumber?: number | null
  onRegenerate: (
    panelIds: string[],
    overrides: GroupRegenOverrides,
  ) => Promise<{ taskId: string | null; error?: string }>
}

function formatTimeRange(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }
  return `${fmt(startSec)}-${fmt(endSec)}`
}

export function GroupCard({
  groupId: _groupId,
  groupOrdinal,
  groupLabel,
  accentClass,
  panels,
  taskId,
  projectId,
  updatePanelText,
  characterRoster,
  locationRoster,
  segmentDurationSeconds = 15,
  episodeNumber,
  onRegenerate,
}: GroupCardProps) {
  // Collapsed by default — the user referenced the Seedance 2.0
  // 视频方案编辑器 layout where each segment is a list row that
  // expands on click. Helps a multi-group episode (8+ groups) stay
  // readable instead of scrolling through cards.
  const [expanded, setExpanded] = useState<boolean>(false)

  // Override state: keys are characterId / locationId, values are
  // the user's override choice (undefined = no override).
  // null = explicit "revert to default" via the modal's bottom button.
  const [characterOverrides, setCharacterOverrides] = useState<Record<string, string | null>>({})
  const [locationOverrides, setLocationOverrides] = useState<Record<string, string | null>>({})

  const [pickerCharacter, setPickerCharacter] = useState<{
    character: CharacterRef
    currentAppearanceId: string | null
  } | null>(null)
  const [pickerLocation, setPickerLocation] = useState<{
    location: LocationRef
    currentViewName: string | null
  } | null>(null)

  const characterById = useMemo(() => {
    const map = new Map<string, CharacterRef>()
    for (const c of characterRoster ?? []) map.set(c.id, c)
    return map
  }, [characterRoster])
  const locationById = useMemo(() => {
    const map = new Map<string, LocationRef>()
    for (const l of locationRoster ?? []) map.set(l.id, l)
    return map
  }, [locationRoster])

  const overrideCount =
    Object.keys(characterOverrides).length + Object.keys(locationOverrides).length

  // ── Phase 3 — segment-level cast / scenes chips (inline below
  // the narrative). Source from this group's panels:
  //   - panel.characters JSON → character names → resolve to roster
  //   - panel.location → "<name>" or "<name>#<viewHint>" → roster
  // Same swap modals as the left-column chip rail. Mirrors the
  // Seedance "场景: [Park-Day] [Park-Inside] +" affordance the user
  // referenced.
  type CastChip = {
    character: CharacterRef
    appearanceId: string | null
    appearanceLabel: string | null
    avatarUrl: string | null
  }
  type SceneChip = {
    location: LocationRef
    viewName: string | null
    avatarUrl: string | null
  }
  const groupCast = useMemo<CastChip[]>(() => {
    const seen = new Set<string>()
    const out: CastChip[] = []
    for (const panel of panels) {
      // Storyboards hook decodes panel.characters into string[] | null.
      // Each item may be a bare name or, after analyze v2, a stringified
      // `{name, appearance}` JSON. Handle both shapes loosely.
      const charsRaw: unknown[] = Array.isArray(panel.characters) ? panel.characters : []
      for (const item of charsRaw) {
        let name: string | null = null
        if (typeof item === 'string') {
          const trimmed = item.trim()
          if (trimmed.startsWith('{')) {
            try {
              const parsed = JSON.parse(trimmed) as { name?: unknown }
              if (typeof parsed.name === 'string') name = parsed.name
            } catch {
              name = trimmed
            }
          } else {
            name = trimmed
          }
        } else if (item && typeof item === 'object') {
          const r = item as { name?: unknown }
          if (typeof r.name === 'string') name = r.name
        }
        if (!name) continue
        const lower = name.trim().toLowerCase()
        if (!lower || seen.has(lower)) continue
        const char = (characterRoster ?? []).find(
          (c) => c.name.toLowerCase().trim() === lower,
        )
        if (!char) continue
        seen.add(lower)
        const appearances = char.appearances ?? []
        const overrideId = characterOverrides[char.id]
        const chosen = overrideId
          ? appearances.find((a) => a.id === overrideId) ?? appearances[0]
          : appearances[0]
        if (!chosen) {
          out.push({
            character: char,
            appearanceId: null,
            appearanceLabel: null,
            avatarUrl: null,
          })
          continue
        }
        out.push({
          character: char,
          appearanceId: chosen.id ?? null,
          appearanceLabel: chosen.changeReason ?? null,
          avatarUrl: chosen.imageUrl ?? null,
        })
      }
    }
    return out
  }, [panels, characterRoster, characterOverrides])
  const groupScenes = useMemo<SceneChip[]>(() => {
    const seen = new Set<string>()
    const out: SceneChip[] = []
    for (const panel of panels) {
      const loc = (panel as { location?: string | null }).location ?? null
      if (!loc) continue
      const hashIdx = loc.indexOf('#')
      const name = (hashIdx === -1 ? loc : loc.slice(0, hashIdx)).trim()
      if (!name) continue
      const lower = name.toLowerCase()
      if (seen.has(lower)) continue
      const locEntity = (locationRoster ?? []).find(
        (l) => l.name.toLowerCase().trim() === lower,
      )
      if (!locEntity) continue
      seen.add(lower)
      const overrideView = locationOverrides[locEntity.id]
      const images = locEntity.images ?? []
      const matched = overrideView
        ? images.find((img) => (img.viewName ?? '').toLowerCase() === overrideView.toLowerCase())
        : null
      const primary = images.find((img) => (img.imageIndex ?? 0) === 0) ?? images[0]
      const picked = matched ?? primary
      out.push({
        location: locEntity,
        viewName: overrideView !== undefined ? overrideView : (picked?.viewName ?? null),
        avatarUrl: picked?.imageUrl ?? null,
      })
    }
    return out
  }, [panels, locationRoster, locationOverrides])

  // ── Phase 2 — segment-level merged narrative editor ──
  //
  // The user referenced the Seedance 2.0 视频方案编辑器 layout where
  // each segment is one editable narrative paragraph (time-indexed
  // 0-5/5-10/10-15s) instead of N separate panel boxes. Panels stay
  // in the data model — they drive analyze, group splitting, and
  // bindings — but the EDITING unit at this stage is the merged
  // segment. Anything the user types here goes through the
  // `rawPrompt` field on regen so the worker bypasses per-panel
  // prompt assembly.
  const [totalDurationDraft, setTotalDurationDraft] = useState<number>(15)
  const buildInitialNarrative = (): string => {
    const count = panels.length
    if (count === 0) return ''
    const total = totalDurationDraft
    const base = Math.max(1, Math.floor(total / count))
    const remainder = Math.max(0, total - base * count)
    const lines: string[] = []
    let cursor = 0
    for (let i = 0; i < count; i++) {
      const dur = base + (i < remainder ? 1 : 0)
      const start = cursor
      const end = cursor + dur
      cursor = end
      const p = panels[i]
      const desc = (p.description ?? p.prompt ?? '').trim()
      const dialog = (p.srtSegment ?? '').trim()
      const segments: string[] = [`${start}-${end} seconds:`]
      if (desc) segments.push(desc)
      if (dialog) segments.push(dialog)
      lines.push(segments.join(' '))
    }
    return lines.join('\n\n')
  }
  const [narrativeDraft, setNarrativeDraft] = useState<string>('')
  const [narrativeDirty, setNarrativeDirty] = useState<boolean>(false)
  // Re-seed the narrative when panels or duration change AND the user
  // hasn't edited it locally — avoids clobbering an in-progress edit.
  useEffect(() => {
    if (narrativeDirty) return
    setNarrativeDraft(buildInitialNarrative())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, totalDurationDraft])

  // Local drafts keyed by panel id. Re-seeded whenever the panel's
  // server-side description / dialogue changes (e.g. analyze
  // re-cascades after a description edit somewhere upstream).
  // Still used by the Phase 1 fallback editor (kept behind the
  // 「進階分鏡編輯」 toggle for power users).
  const [descDrafts, setDescDrafts] = useState<Record<string, string>>({})
  const [dialogueDrafts, setDialogueDrafts] = useState<Record<string, string>>({})
  useEffect(() => {
    const nextDesc: Record<string, string> = {}
    const nextDial: Record<string, string> = {}
    for (const p of panels) {
      nextDesc[p.id] = p.description ?? p.prompt ?? ''
      nextDial[p.id] = p.srtSegment ?? ''
    }
    setDescDrafts(nextDesc)
    setDialogueDrafts(nextDial)
  }, [panels])
  const [showAdvancedEditor, setShowAdvancedEditor] = useState<boolean>(false)

  const [savingPanelId, setSavingPanelId] = useState<string | null>(null)
  function handleSaveDescription(panelId: string) {
    const value = descDrafts[panelId] ?? ''
    setSavingPanelId(panelId)
    updatePanelText.mutate(
      { panelId, description: value },
      {
        onSettled: () => setSavingPanelId((prev) => (prev === panelId ? null : prev)),
        onError: (err) => alert(err instanceof Error ? err.message : '儲存描述失敗'),
      },
    )
  }
  function handleSaveDialogue(panelId: string) {
    const value = dialogueDrafts[panelId] ?? ''
    setSavingPanelId(panelId)
    updatePanelText.mutate(
      { panelId, srtSegment: value },
      {
        onSettled: () => setSavingPanelId((prev) => (prev === panelId ? null : prev)),
        onError: (err) => alert(err instanceof Error ? err.message : '儲存對白失敗'),
      },
    )
  }

  const [regenState, setRegenState] = useState<
    | { status: 'idle' }
    | { status: 'submitting' }
    | { status: 'done' }
    | { status: 'error'; message: string }
  >({ status: 'idle' })
  async function handleRegenerate() {
    if (panels.length < 2) {
      setRegenState({ status: 'error', message: '至少需要 2 鏡才能跑多鏡頭' })
      return
    }
    if (panels.length > 6) {
      setRegenState({ status: 'error', message: '一組最多 6 鏡(會送前 6 個)' })
    } else {
      setRegenState({ status: 'submitting' })
    }
    const ids = panels.slice(0, 6).map((p) => p.id)
    // Phase 2: distribute the segment's total duration evenly across
    // its panel slices. Worker enters customize mode when
    // panelDurations is present so each multi_prompt[] entry gets the
    // right per-shot anchor in Kling Omni.
    const panelDurations: number[] = (() => {
      const count = ids.length
      const total = Math.max(count, Math.min(15, totalDurationDraft))
      const base = Math.max(1, Math.floor(total / count))
      const remainder = Math.max(0, total - base * count)
      const out: number[] = []
      for (let i = 0; i < count; i++) {
        out.push(base + (i < remainder ? 1 : 0))
      }
      return out
    })()
    const trimmedNarrative = narrativeDraft.trim()
    const overrides: GroupRegenOverrides = {
      ...(narrativeDirty && trimmedNarrative.length > 0
        ? { rawPrompt: trimmedNarrative }
        : {}),
      panelDurations,
      characterOverrides: Object.entries(characterOverrides)
        .filter(([, app]) => app !== undefined)
        .map(([characterId, appearanceId]) =>
          appearanceId === null ? { characterId } : { characterId, appearanceId },
        ),
      locationOverrides: Object.entries(locationOverrides)
        .filter(([, view]) => view !== undefined)
        .map(([locationId, viewName]) =>
          viewName === null ? { locationId } : { locationId, viewName },
        ),
    }
    const result = await onRegenerate(ids, overrides)
    if (result.error) {
      setRegenState({ status: 'error', message: result.error })
    } else {
      setRegenState({ status: 'done' })
      // Keep overrides visible so the user can see what just got
      // applied; manually reset via the chips if needed.
    }
  }

  function handleResetOverrides() {
    setCharacterOverrides({})
    setLocationOverrides({})
  }

  // Cumulative time range for the segment header. groupOrdinal is
  // 1-indexed and we model each segment as `segmentDurationSeconds`
  // long until the user customises panelDurations (Phase 2).
  const segmentStart = (groupOrdinal - 1) * segmentDurationSeconds
  const segmentEnd = segmentStart + segmentDurationSeconds
  const timeRangeLabel = formatTimeRange(segmentStart, segmentEnd)
  const briefDescription = (() => {
    const head = panels[0]?.description ?? panels[0]?.prompt ?? ''
    const trimmed = head.replace(/\s+/g, ' ').trim()
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
  })()
  // Pull live task status so the header badge reflects the actual
  // server state (failed / processing / completed) instead of just
  // the local "did I click submit recently" flag. Same React Query
  // key as the rail so no extra network hop.
  const taskQuery = useMultiShotTask(taskId)
  const liveTaskStatus = taskQuery.data?.status ?? null
  const taskFailed = liveTaskStatus === 'failed' || liveTaskStatus === 'cancelled'
  const taskProcessing = liveTaskStatus === 'queued' || liveTaskStatus === 'processing'
  const taskCompleted = liveTaskStatus === 'completed'
  // Server-bound cast (what Kling actually anchored against). Lives
  // in the right column below the scene chips per user request —
  // the rail kept it directly below the player which made the left
  // half overcrowded vs the narrative pane on the right.
  const boundCharacters: MultiShotCharacterBinding[] =
    taskQuery.data?.result?.bindings?.characters ?? []

  // If the task ultimately failed but local regenState still says
  // "done" (we marked done on submit success, before Kling actually
  // ran), drop back to idle so the user can re-click.
  useEffect(() => {
    if (taskFailed && regenState.status === 'done') {
      setRegenState({ status: 'idle' })
    }
  }, [taskFailed, regenState.status])

  const statusLabel = (() => {
    if (regenState.status === 'submitting') return { text: '送出中…', tone: 'pending' }
    if (taskFailed) return { text: '失敗 · 點重新生成', tone: 'error' }
    if (taskProcessing) return { text: '生成中…', tone: 'pending' }
    if (taskCompleted) return { text: '已完成', tone: 'done' }
    if (taskId) return { text: '已送出', tone: 'done' }
    return { text: '尚未生成', tone: 'idle' }
  })()
  const statusToneClass =
    statusLabel.tone === 'done'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
      : statusLabel.tone === 'pending'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : statusLabel.tone === 'error'
          ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
          : 'border-stone-800/60 bg-stone-900/30 text-stone-500'

  return (
    <article
      className={`overflow-hidden rounded-sm border-y border-r border-l-4 border-stone-800/60 bg-stone-900/30 ${accentClass}`}
    >
      <header
        className="flex cursor-pointer select-none items-center justify-between gap-4 border-b border-amber-900/15 bg-stone-950/40 px-4 py-2.5 transition-colors hover:bg-stone-950/60"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex flex-1 items-center gap-3 overflow-hidden">
          <div className="flex-shrink-0 font-mono text-[14px] uppercase tracking-wider text-amber-500/80">
            {groupLabel}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1 rounded-sm border border-stone-800 bg-stone-900/60 px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-stone-400">
            <AppIcon name="play" className="h-2.5 w-2.5" />
            {timeRangeLabel}
          </div>
          <div
            className={`flex-shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[12px] tracking-wider ${statusToneClass}`}
          >
            {statusLabel.tone === 'done' ? '✓ ' : statusLabel.tone === 'error' ? '⚠ ' : statusLabel.tone === 'pending' ? '↻ ' : ''}
            {statusLabel.text}
          </div>
          {!expanded && briefDescription ? (
            <div className="truncate font-serif-cn text-[12px] text-stone-300">
              {briefDescription}
            </div>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {expanded ? (
            <button
              type="button"
              disabled={regenState.status === 'submitting' || panels.length < 2}
              onClick={(e) => {
                e.stopPropagation()
                void handleRegenerate()
              }}
              title="重新送這個 group 跑 Kling 多鏡頭"
              className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[12px] tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                regenState.status === 'submitting'
                  ? 'border-amber-400 bg-amber-500/30 text-amber-100 ring-2 ring-amber-500/40'
                  : regenState.status === 'done'
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    : regenState.status === 'error'
                      ? 'border-rose-500/60 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                      : 'border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
              }`}
            >
              {regenState.status === 'submitting' ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-amber-400/40 border-t-amber-200" />
              ) : (
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
              )}
              {regenState.status === 'submitting'
                ? '送出中…'
                : regenState.status === 'done'
                  ? '✓ 已送出'
                  : regenState.status === 'error'
                    ? '⚠ 失敗,點重試'
                    : '重新生成'}
            </button>
          ) : null}
          <div className="font-mono text-[14px] tracking-wider text-stone-500">
            {expanded ? '▲' : '▼'}
          </div>
        </div>
      </header>

      {!expanded ? null : (
      <div className="space-y-3 p-4">
        {regenState.status === 'submitting' ? (
          <div className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400/40 border-t-amber-200" />
            <div className="font-serif-cn text-[12px] text-amber-200">
              送 Kling 中…task 已 queue,大約 30 秒進到 worker。Kling Omni 算 3-5 分鐘出影片,完成後左邊會自動刷新。
            </div>
          </div>
        ) : regenState.status === 'done' ? (
          <div className="flex items-center gap-2 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
            <AppIcon name="check" className="h-3 w-3 text-emerald-300" />
            <div className="font-serif-cn text-[12px] text-emerald-200">
              ✓ 已送出 — Kling Omni 大約 3-5 分鐘出影片,進度會顯示在左邊綁定區。可以同時去其他 group 編輯。
            </div>
          </div>
        ) : regenState.status === 'error' ? (
          <div className="flex items-center gap-2 rounded-sm border border-rose-500/40 bg-rose-500/10 px-3 py-2">
            <AppIcon name="alert" className="h-3 w-3 text-rose-300" />
            <div className="flex-1 font-serif-cn text-[12px] text-rose-200">
              ⚠ 送出失敗:{regenState.message}
            </div>
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              className="rounded-sm border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 font-mono text-[12px] tracking-wider text-rose-200 transition-colors hover:bg-rose-500/25"
            >
              重試
            </button>
          </div>
        ) : null}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-5">
          <MultiShotBindingsRail
            taskId={taskId}
            groupLabel={null}
            projectId={projectId}
            downloadFilenameBase={(() => {
              const epPart = episodeNumber && episodeNumber > 0 ? `ep${episodeNumber}_` : ''
              return `${epPart}group${String(groupOrdinal).padStart(2, '0')}`
            })()}
            hideCastSection
            characterOverrideAppearanceById={characterOverrides}
            locationOverrideViewByLocationId={locationOverrides}
            onCharacterChipClick={(binding) => {
              const character = characterById.get(binding.id)
              if (!character) return
              const currentAppearanceId =
                characterOverrides[binding.id] !== undefined
                  ? characterOverrides[binding.id]
                  : binding.appearanceId
              setPickerCharacter({ character, currentAppearanceId })
            }}
            onSceneChipClick={(binding) => {
              const location = locationById.get(binding.id)
              if (!location) return
              const currentViewName =
                locationOverrides[binding.id] !== undefined
                  ? locationOverrides[binding.id]
                  : binding.viewName
              setPickerLocation({ location, currentViewName })
            }}
          />
          {overrideCount > 0 ? (
            <div className="mt-2 flex items-center justify-between rounded-sm border border-violet-500/30 bg-violet-500/5 px-2 py-1.5">
              <div className="font-mono text-[12px] tracking-wider text-violet-300">
                ✏ 已修改 {overrideCount} 個綁定 — 「重新生成」會套用
              </div>
              <button
                type="button"
                onClick={handleResetOverrides}
                className="font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-violet-300"
              >
                清空
              </button>
            </div>
          ) : null}
          {/* Banner moved to top of expanded body so it's not buried
              under the player. See above. */}
        </div>

        <div className="col-span-12 space-y-3 lg:col-span-7">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              叙事提示词
              <span className="text-stone-500">· {narrativeDraft.length} 字</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-stone-400">
                <AppIcon name="play" className="h-3 w-3" />
                时长
                <select
                  value={totalDurationDraft}
                  onChange={(e) => {
                    setTotalDurationDraft(Number.parseInt(e.target.value, 10) || 15)
                    // Re-seed narrative so the time slices match the
                    // new total. Skipped when the user has dirty edits
                    // — protected by buildInitialNarrative guard.
                    setNarrativeDirty(false)
                  }}
                  className="rounded-sm border border-stone-800 bg-stone-900 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 outline-none focus:border-amber-500/40"
                >
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                  <option value={15}>15s</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setNarrativeDraft(buildInitialNarrative())
                  setNarrativeDirty(false)
                }}
                title="從分鏡描述重新生成這段敘事"
                className="rounded-sm border border-stone-800 px-2 py-0.5 font-mono text-[12px] tracking-wider text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-400"
              >
                ↻ 重生敘事
              </button>
            </div>
          </div>

          <textarea
            value={narrativeDraft}
            onChange={(e) => {
              setNarrativeDraft(e.target.value)
              setNarrativeDirty(true)
            }}
            rows={panels.length >= 4 ? 14 : 9}
            placeholder="0-5 seconds: 角色 + 場景 + 動作 + 鏡頭 + 氛圍&#10;5-10 seconds: ...&#10;10-15 seconds: ..."
            className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/40 p-2.5 font-serif-cn text-[12px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40"
          />
          {narrativeDirty ? (
            <div className="font-mono text-[12px] tracking-wider text-violet-300">
              ✏ 敘事已修改 — 「重新生成」會以這段為主 prompt(覆蓋分鏡描述)
            </div>
          ) : (
            <div className="font-mono text-[12px] tracking-wider text-stone-600">
              預設由 {panels.length} 個分鏡描述自動拼接。直接編輯這段即可,送出時會以你寫的為準。
            </div>
          )}

          {(groupCast.length > 0 || groupScenes.length > 0 || boundCharacters.length > 0) ? (
            <div className="space-y-2 rounded-sm border border-stone-800/60 bg-stone-950/30 p-2">
              {groupCast.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
                    <AppIcon name="user" className="h-3 w-3" />
                    出場角色 · {groupCast.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupCast.map((c) => {
                      const overridden = characterOverrides[c.character.id] !== undefined
                        && characterOverrides[c.character.id] !== c.appearanceId
                      const stateClass = overridden
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-amber-900/30 bg-stone-950/40'
                      return (
                        <button
                          key={c.character.id}
                          type="button"
                          onClick={() => {
                            setPickerCharacter({
                              character: c.character,
                              currentAppearanceId: characterOverrides[c.character.id] !== undefined
                                ? characterOverrides[c.character.id]
                                : c.appearanceId,
                            })
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 ${stateClass}`}
                          title={`${c.character.name} · ${c.appearanceLabel ?? '默認造型'} — 點擊換造型`}
                        >
                          <div className="relative h-5 w-5 overflow-hidden rounded-full bg-stone-800">
                            {c.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.avatarUrl} alt={c.character.name} className="h-full w-full object-cover" />
                            ) : (
                              <AppIcon name="user" className="h-3 w-3 m-auto text-stone-600" />
                            )}
                          </div>
                          <span className="font-serif-cn text-[14px] text-stone-200">
                            {c.character.name}
                          </span>
                          <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                            {c.appearanceLabel ?? '默認造型'}
                          </span>
                          {overridden ? (
                            <span className="font-mono text-[12px] tracking-wider text-violet-300">
                              ✏ 已改
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {groupScenes.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
                    <AppIcon name="image" className="h-3 w-3" />
                    場景 · {groupScenes.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupScenes.map((s) => {
                      const overridden = locationOverrides[s.location.id] !== undefined
                        && locationOverrides[s.location.id] !== s.viewName
                      const stateClass = overridden
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-amber-900/30 bg-stone-950/40'
                      return (
                        <button
                          key={s.location.id}
                          type="button"
                          onClick={() => {
                            setPickerLocation({
                              location: s.location,
                              currentViewName: locationOverrides[s.location.id] !== undefined
                                ? locationOverrides[s.location.id]
                                : s.viewName,
                            })
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 ${stateClass}`}
                          title={`${s.location.name} · ${s.viewName ?? '主視角'} — 點擊換視角`}
                        >
                          <div className="relative h-5 w-8 overflow-hidden rounded-sm bg-stone-800">
                            {s.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.avatarUrl} alt={s.location.name} className="h-full w-full object-cover" />
                            ) : (
                              <AppIcon name="image" className="h-3 w-3 m-auto text-stone-600" />
                            )}
                          </div>
                          <span className="font-serif-cn text-[14px] text-stone-200">
                            {s.location.name}
                          </span>
                          <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                            {s.viewName ?? '主視角'}
                          </span>
                          {overridden ? (
                            <span className="font-mono text-[12px] tracking-wider text-violet-300">
                              ✏ 已改
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {boundCharacters.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
                    <AppIcon name="user" className="h-3 w-3" />
                    演員綁定 · {boundCharacters.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {boundCharacters.map((c) => {
                      const overrideAppearanceId = characterOverrides[c.id]
                      const hasOverride =
                        overrideAppearanceId !== undefined
                        && overrideAppearanceId !== c.appearanceId
                      const stateClass = hasOverride
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-amber-900/30 bg-stone-950/40'
                      const character = characterById.get(c.id) ?? null
                      const handleClick = () => {
                        if (!character) return
                        const currentAppearanceId =
                          characterOverrides[c.id] !== undefined
                            ? characterOverrides[c.id]
                            : c.appearanceId
                        setPickerCharacter({ character, currentAppearanceId })
                      }
                      const title = hasOverride
                        ? `${c.name} — 下次重生會改用新造型(尚未送出)`
                        : `${c.name} · ${c.appearanceLabel ?? '默認造型'}${character ? ' — 點擊換造型' : ''}`
                      const className = `inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 transition-colors ${
                        character ? 'cursor-pointer hover:border-amber-500/60 hover:bg-amber-500/10' : ''
                      } ${stateClass}`
                      const inner = (
                        <>
                          <div className="relative h-5 w-5 overflow-hidden rounded-full bg-stone-800">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={c.imageUrl}
                              alt={c.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <span className="font-serif-cn text-[14px] text-stone-200">
                            {c.name}
                          </span>
                          <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                            {c.appearanceLabel ?? '默認造型'}
                          </span>
                          {hasOverride ? (
                            <span className="font-mono text-[12px] tracking-wider text-violet-300">
                              ✏ 已改
                            </span>
                          ) : null}
                        </>
                      )
                      return character ? (
                        <button
                          key={c.id}
                          type="button"
                          onClick={handleClick}
                          className={className}
                          title={title}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div key={c.id} className={className} title={title}>
                          {inner}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="border-t border-stone-800/60 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvancedEditor((v) => !v)}
              className="flex items-center gap-1 font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
            >
              {showAdvancedEditor ? '▼' : '▶'} 進階分鏡編輯({panels.length} 鏡 · 編輯各分鏡描述 / 對白)
            </button>
            {showAdvancedEditor ? (
              <div className="mt-2 space-y-2">
                {panels.map((p, panelIdx) => {
                  const descValue = descDrafts[p.id] ?? ''
                  const dialValue = dialogueDrafts[p.id] ?? ''
                  const descOriginal = p.description ?? p.prompt ?? ''
                  const dialOriginal = p.srtSegment ?? ''
                  const descChanged = descValue !== descOriginal
                  const dialChanged = dialValue !== dialOriginal
                  const isSavingThis = savingPanelId === p.id
                  return (
                    <div
                      key={p.id}
                      className="rounded-sm border border-stone-800/60 bg-stone-950/40 p-2"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] tracking-wider text-amber-500/60">
                            #{String(panelIdx + 1).padStart(2, '0')}
                          </span>
                          {Array.isArray(p.characters) && p.characters.length > 0 ? (
                            <span className="font-mono text-[12px] tracking-wider text-stone-500">
                              {p.characters.join(' / ')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <textarea
                        value={descValue}
                        onChange={(e) =>
                          setDescDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        rows={2}
                        placeholder="鏡頭描述"
                        className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/40 p-1.5 font-serif-cn text-[12px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40"
                      />
                      {descChanged ? (
                        <button
                          type="button"
                          disabled={isSavingThis}
                          onClick={() => handleSaveDescription(p.id)}
                          className="mt-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          {isSavingThis ? '儲存中…' : '儲存描述'}
                        </button>
                      ) : null}
                      <div className="mt-1.5">
                        <textarea
                          value={dialValue}
                          onChange={(e) =>
                            setDialogueDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          rows={1}
                          placeholder="對白(可空白)"
                          className="w-full resize-none rounded-sm border border-amber-500/15 bg-amber-500/5 p-1.5 font-serif-cn text-[11px] leading-relaxed italic text-amber-300/80 outline-none focus:border-amber-500/40"
                        />
                        {dialChanged ? (
                          <button
                            type="button"
                            disabled={isSavingThis}
                            onClick={() => handleSaveDialogue(p.id)}
                            className="mt-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                          >
                            {isSavingThis ? '儲存中…' : '儲存對白'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      </div>
      )}

      <CharacterAppearancePickerModal
        open={pickerCharacter !== null}
        onClose={() => setPickerCharacter(null)}
        character={pickerCharacter?.character ?? null}
        currentAppearanceId={pickerCharacter?.currentAppearanceId ?? null}
        onSelect={(appearanceId) => {
          if (!pickerCharacter) return
          const characterId = pickerCharacter.character.id
          setCharacterOverrides((prev) => ({ ...prev, [characterId]: appearanceId }))
        }}
      />

      <LocationViewPickerModal
        open={pickerLocation !== null}
        onClose={() => setPickerLocation(null)}
        location={pickerLocation?.location ?? null}
        currentViewName={pickerLocation?.currentViewName ?? null}
        onSelect={(viewName) => {
          if (!pickerLocation) return
          const locationId = pickerLocation.location.id
          setLocationOverrides((prev) => ({ ...prev, [locationId]: viewName }))
        }}
      />
    </article>
  )
}

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
  const statusLabel = (() => {
    if (regenState.status === 'submitting') return { text: '送出中…', tone: 'pending' }
    if (taskId) return { text: '已送出', tone: 'done' }
    return { text: '尚未生成', tone: 'idle' }
  })()
  const statusToneClass =
    statusLabel.tone === 'done'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
      : statusLabel.tone === 'pending'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
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
          <div className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-amber-500/80">
            {groupLabel}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1 rounded-sm border border-stone-800 bg-stone-900/60 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-stone-400">
            <AppIcon name="play" className="h-2.5 w-2.5" />
            {timeRangeLabel}
          </div>
          <div
            className={`flex-shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] tracking-wider ${statusToneClass}`}
          >
            ✓ {statusLabel.text}
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
              className="flex items-center gap-1.5 rounded-sm border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 font-mono text-[9px] tracking-wider text-amber-200 transition-all hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              {regenState.status === 'submitting' ? '送出中…' : '重新生成'}
            </button>
          ) : null}
          <div className="font-mono text-[10px] tracking-wider text-stone-500">
            {expanded ? '▲' : '▼'}
          </div>
        </div>
      </header>

      {!expanded ? null : (
      <div className="grid grid-cols-12 gap-4 p-4">
        <div className="col-span-12 lg:col-span-7">
          <MultiShotBindingsRail
            taskId={taskId}
            groupLabel={null}
            projectId={projectId}
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
              <div className="font-mono text-[9px] tracking-wider text-violet-300">
                ✏ 已修改 {overrideCount} 個綁定 — 「重新生成」會套用
              </div>
              <button
                type="button"
                onClick={handleResetOverrides}
                className="font-mono text-[9px] tracking-wider text-stone-500 transition-colors hover:text-violet-300"
              >
                清空
              </button>
            </div>
          ) : null}
          {regenState.status === 'error' ? (
            <div className="mt-2 rounded-sm border border-rose-500/30 bg-rose-500/5 px-2 py-1 font-serif-cn text-[11px] text-rose-300">
              {regenState.message}
            </div>
          ) : null}
          {regenState.status === 'done' ? (
            <div className="mt-2 rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 font-serif-cn text-[11px] text-emerald-300">
              已送出 — Kling 大約 3-5 分鐘出影片,進度會顯示在上方綁定區
            </div>
          ) : null}
        </div>

        <div className="col-span-12 space-y-3 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-amber-500/70">
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              叙事提示词
              <span className="text-stone-500">· {narrativeDraft.length} 字</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-stone-400">
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
                  className="rounded-sm border border-stone-800 bg-stone-900 px-1.5 py-0.5 font-mono text-[10px] text-stone-200 outline-none focus:border-amber-500/40"
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
                className="rounded-sm border border-stone-800 px-2 py-0.5 font-mono text-[9px] tracking-wider text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-400"
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
            <div className="font-mono text-[9px] tracking-wider text-violet-300">
              ✏ 敘事已修改 — 「重新生成」會以這段為主 prompt(覆蓋分鏡描述)
            </div>
          ) : (
            <div className="font-mono text-[9px] tracking-wider text-stone-600">
              預設由 {panels.length} 個分鏡描述自動拼接。直接編輯這段即可,送出時會以你寫的為準。
            </div>
          )}

          <div className="border-t border-stone-800/60 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvancedEditor((v) => !v)}
              className="flex items-center gap-1 font-mono text-[9px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
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
                          <span className="font-mono text-[9px] tracking-wider text-amber-500/60">
                            #{String(panelIdx + 1).padStart(2, '0')}
                          </span>
                          {Array.isArray(p.characters) && p.characters.length > 0 ? (
                            <span className="font-mono text-[9px] tracking-wider text-stone-500">
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
                          className="mt-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
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
                            className="mt-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
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

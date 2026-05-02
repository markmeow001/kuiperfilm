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
  onRegenerate: (
    panelIds: string[],
    overrides: GroupRegenOverrides,
  ) => Promise<{ taskId: string | null; error?: string }>
}

export function GroupCard({
  groupId: _groupId,
  groupOrdinal: _groupOrdinal,
  groupLabel,
  accentClass,
  panels,
  taskId,
  projectId,
  updatePanelText,
  characterRoster,
  locationRoster,
  onRegenerate,
}: GroupCardProps) {
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
  // Local drafts keyed by panel id. Re-seeded whenever the panel's
  // server-side description / dialogue changes (e.g. analyze
  // re-cascades after a description edit somewhere upstream).
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
    const overrides: GroupRegenOverrides = {
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

  return (
    <article
      className={`overflow-hidden rounded-sm border-y border-r border-l-4 border-stone-800/60 bg-stone-900/30 ${accentClass}`}
    >
      <header className="flex items-center justify-between border-b border-amber-900/15 bg-stone-950/40 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-500/80">
            {groupLabel}
          </div>
          <div className="font-mono text-[9px] tracking-wider text-stone-500">
            {panels.length} 鏡
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono text-[9px] tracking-wider text-stone-500">
            {taskId ? `TASK ${taskId.slice(0, 8)}` : '尚未送多鏡頭'}
          </div>
          <button
            type="button"
            disabled={regenState.status === 'submitting' || panels.length < 2}
            onClick={handleRegenerate}
            title="重新送這個 group 跑 Kling 多鏡頭"
            className="flex items-center gap-1.5 rounded-sm border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 font-mono text-[9px] tracking-wider text-amber-200 transition-all hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className="h-3 w-3" />
            {regenState.status === 'submitting' ? '送出中…' : '重新生成'}
          </button>
        </div>
      </header>

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

        <div className="col-span-12 space-y-2 lg:col-span-5">
          <div className="font-mono text-[9px] uppercase tracking-wider text-amber-500/70">
            分鏡描述 · {panels.length} 鏡
          </div>
          <div className="space-y-2">
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
                    placeholder="鏡頭描述 — 例:近景,CATHERINE 雙手扶著工作台,目光看向鏡頭"
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
                      placeholder="對白(可空白) — 例:CATHERINE「就這樣吧。」"
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
        </div>
      </div>

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

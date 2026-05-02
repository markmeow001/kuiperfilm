'use client'

/**
 * Phase 12.5.4 — Groups layout for the multi-shot B-path workflow.
 *
 * The gallery / timeline layouts are panel-centric: each card shows a
 * generated panel image and lets the user iterate on it. That mental
 * model makes sense when the video model is image-to-video (KieAI,
 * Kling-2.x i2v) — the panel image IS the first frame.
 *
 * Kling-3 / Kling-Omni / Kling-O1 are text-to-video with
 * SubjectInfos.N strong identity binding. There is no panel-level
 * image at all — the model generates a 5-15s multi-shot video per
 * group directly from the script + character/scene reference images.
 * Showing empty 9:16 image placeholders in that mode is misleading
 * and the per-panel "regenerate image" affordance is meaningless.
 *
 * This layout flips the unit from panel → group:
 *   - One card per multiShotGroup
 *   - Each card embeds the multi-shot video player + binding chips
 *   - Per-panel descriptions stack inside the card (read-only in
 *     commit 1; editable in commit 2; with character/scene override
 *     pickers in commit 3)
 *
 * It only ships behind a layoutMode toggle. The parent decides when
 * to default to 'groups' (currently: when videoModel matches the
 * B-path regex) but the user can flip back to gallery / timeline.
 */

import { useMemo } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MultiShotBindingsRail } from './MultiShotBindingsRail'

interface PanelLike {
  id: string
  panelIndex?: number | null
  description?: string | null
  prompt?: string | null
  srtSegment?: string | null
  characters?: string[] | null
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
}

interface V2GroupsLayoutProps {
  panels: PanelLike[]
  orderedGroupIds: string[]
  taskByGroup: Record<string, string>
  toolbarNode: React.ReactNode
  emptyHint?: React.ReactNode
}

const GROUP_ACCENTS = [
  'border-l-amber-500',
  'border-l-rose-500',
  'border-l-emerald-500',
  'border-l-sky-500',
  'border-l-violet-500',
  'border-l-orange-500',
] as const

function accentForOrdinal(ordinal: number): string {
  return GROUP_ACCENTS[ordinal % GROUP_ACCENTS.length]
}

export function V2GroupsLayout({
  panels,
  orderedGroupIds,
  taskByGroup,
  toolbarNode,
  emptyHint,
}: V2GroupsLayoutProps) {
  const groups = useMemo(() => {
    const byGroupId = new Map<string, PanelLike[]>()
    const ungrouped: PanelLike[] = []
    for (const p of panels) {
      if (p.multiShotGroupId) {
        const list = byGroupId.get(p.multiShotGroupId) ?? []
        list.push(p)
        byGroupId.set(p.multiShotGroupId, list)
      } else {
        ungrouped.push(p)
      }
    }
    const ordered = orderedGroupIds
      .map((groupId) => ({
        groupId,
        panels: (byGroupId.get(groupId) ?? [])
          .slice()
          .sort((a, b) => (a.multiShotGroupOrder ?? 0) - (b.multiShotGroupOrder ?? 0)),
      }))
      .filter((g) => g.panels.length > 0)
    return { ordered, ungrouped }
  }, [panels, orderedGroupIds])

  const hasNoGroups = groups.ordered.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-amber-900/15 px-8 pb-3 pt-5">
        {toolbarNode}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {hasNoGroups ? (
          <div className="rounded-sm border border-amber-500/20 bg-amber-500/5 px-6 py-8 text-center">
            <p className="font-fraunces text-base italic text-amber-400">
              還沒有切組 — 先點上方「自動切組」讓 LLM 把分鏡分成多鏡頭群,然後就能一次出影片
            </p>
            {emptyHint ? <div className="mt-4">{emptyHint}</div> : null}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.ordered.map((g, idx) => {
              const taskId = taskByGroup[g.groupId] ?? null
              const ordinal = idx + 1
              const accent = accentForOrdinal(idx)
              const groupLabel = `GROUP ${String(ordinal).padStart(2, '0')}`
              return (
                <article
                  key={g.groupId}
                  className={`overflow-hidden rounded-sm border-y border-r border-l-4 border-stone-800/60 bg-stone-900/30 ${accent}`}
                >
                  <header className="flex items-center justify-between border-b border-amber-900/15 bg-stone-950/40 px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-amber-500/80">
                        {groupLabel}
                      </div>
                      <div className="font-mono text-[9px] tracking-wider text-stone-500">
                        {g.panels.length} 鏡 · {g.panels.length * 2}-{g.panels.length * 3}s
                      </div>
                    </div>
                    <div className="font-mono text-[9px] tracking-wider text-stone-500">
                      {taskId ? `TASK ${taskId.slice(0, 8)}` : '尚未送多鏡頭'}
                    </div>
                  </header>

                  <div className="grid grid-cols-12 gap-4 p-4">
                    <div className="col-span-12 lg:col-span-7">
                      <MultiShotBindingsRail taskId={taskId} groupLabel={null} />
                    </div>

                    <div className="col-span-12 space-y-2 lg:col-span-5">
                      <div className="font-mono text-[9px] uppercase tracking-wider text-amber-500/70">
                        分鏡描述 · {g.panels.length} 鏡
                      </div>
                      <div className="space-y-1.5">
                        {g.panels.map((p, panelIdx) => (
                          <div
                            key={p.id}
                            className="rounded-sm border border-stone-800/60 bg-stone-950/40 px-2.5 py-1.5"
                          >
                            <div className="mb-1 flex items-center gap-2">
                              <span className="font-mono text-[9px] tracking-wider text-amber-500/60">
                                #{String(panelIdx + 1).padStart(2, '0')}
                              </span>
                              {Array.isArray(p.characters) && p.characters.length > 0 ? (
                                <span className="font-mono text-[9px] tracking-wider text-stone-500">
                                  · {p.characters.join(' / ')}
                                </span>
                              ) : null}
                            </div>
                            <div className="font-serif-cn text-[12px] leading-relaxed text-stone-200">
                              {p.description ?? p.prompt ?? '(無描述)'}
                            </div>
                            {p.srtSegment ? (
                              <div className="mt-1 border-l-2 border-amber-500/30 pl-2 font-serif-cn text-[11px] italic text-amber-300/80">
                                「{p.srtSegment}」
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <footer className="flex items-center justify-end gap-2 border-t border-amber-900/15 bg-stone-950/30 px-4 py-2">
                    <div className="font-mono text-[9px] tracking-wider text-stone-500">
                      Commit 2 將加入「重新生成」+ 描述編輯;Commit 3 加入「換造型 / 換視角」
                    </div>
                  </footer>
                </article>
              )
            })}

            {groups.ungrouped.length > 0 ? (
              <div className="rounded-sm border border-stone-800/60 bg-stone-900/20 px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <AppIcon name="sparklesAlt" className="h-3 w-3 text-stone-500" />
                  <div className="font-mono text-[9px] uppercase tracking-wider text-stone-500">
                    未切組 · {groups.ungrouped.length} 鏡
                  </div>
                </div>
                <p className="font-serif-cn text-[11px] italic text-stone-500">
                  這些分鏡尚未指派到 multi-shot group。再跑一次「自動切組」可以把它們納入。
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

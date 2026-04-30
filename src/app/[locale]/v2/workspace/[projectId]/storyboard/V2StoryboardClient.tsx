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

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'

interface V2StoryboardClientProps {
  projectId: string
}

interface PanelLike {
  id: string
  description?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  prompt?: string | null
  videoPrompt?: string | null
  characters?: string[] | null
}

interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

interface ProjectLike {
  episodes?: Array<{ id: string }> | null
}

export function V2StoryboardClient({ projectId }: V2StoryboardClientProps) {
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLike | undefined
  const firstEpisodeId = project?.episodes?.[0]?.id ?? null

  const storyboardsQuery = useStoryboards(firstEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined

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

  if (projectQuery.isLoading || storyboardsQuery.isLoading) {
    return (
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">載入中…</p>
      </div>
    )
  }

  if (!firstEpisodeId) {
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
    return (
      <div className="px-12 py-10">
        <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
          <p className="font-fraunces text-base italic text-stone-400">
            還沒有分鏡資料 — 請回劇本 step 點「生成劇本」
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top: panel strip */}
      <div className="border-b border-amber-900/15 px-12 pb-4 pt-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-fraunces text-sm italic text-amber-500/80">Storyboard Strip</div>
          <div className="font-mono text-[10px] tracking-wider text-stone-500">
            {allPanels.length} SHOTS · DRAFT 03
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {allPanels.map((p, i) => {
            const active = p.id === selectedId
            const hasImage = Boolean(p.imageUrl)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`flex-shrink-0 overflow-hidden rounded-sm border text-left transition-all ${
                  active
                    ? 'border-amber-500/60 ring-2 ring-amber-500/20'
                    : 'border-stone-800/60 hover:border-stone-700'
                }`}
                style={{ width: 176 }}
              >
                <div className="relative h-24 overflow-hidden bg-gradient-to-br from-stone-800 to-stone-900">
                  {hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl ?? ''} alt={`panel ${i + 1}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-stone-950/70">
                      <AppIcon name="image" className="h-5 w-5 text-stone-600" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-transparent to-transparent" />
                  <div className="absolute left-2 top-1.5 rounded bg-stone-950/50 px-1.5 py-0.5 font-mono text-[10px] text-stone-200 backdrop-blur-sm">
                    #{String(i + 1).padStart(2, '0')}
                  </div>
                </div>
                <div className="bg-stone-900/40 px-2 py-2">
                  <div className="truncate font-serif-cn text-xs text-stone-200">
                    {p.description?.slice(0, 30) ?? `分鏡 ${i + 1}`}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 3-column body */}
      <div className="grid flex-1 grid-cols-12 gap-6 overflow-y-auto px-12 py-6">
        {/* Left: prompt builder placeholder */}
        <div className="col-span-3 space-y-5">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-amber-600">
              SHOT {String(selectedIndex + 1).padStart(2, '0')} · 提示詞
            </div>
            <div className="rounded-sm border border-amber-900/20 bg-stone-900/40 p-3 font-serif-cn text-sm leading-relaxed text-stone-300">
              {selected?.prompt ?? selected?.description ?? '(無 prompt)'}
            </div>
          </div>

          <PromptChipGroup label="視角" options={['平視', '仰視', '俯視', '傾斜']} cols={2} active={0} />
          <PromptChipGroup label="景別" options={['遠景', '全景', '中景', '近景', '特寫']} cols={3} active={2} />
          <PromptChipGroup
            label="運鏡"
            options={['中度推進', '搖降', '手持', '快速變焦', '升格']}
            cols={1}
            active={0}
          />
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-stone-500">質量詞</div>
            <div className="flex flex-wrap gap-1.5">
              {['逆光', '丁達爾', '粒子', '4K', '電影感'].map((q, i) => (
                <span
                  key={q}
                  className={`rounded-sm border px-2 py-1 font-serif-cn text-[11px] ${
                    i < 3
                      ? 'border-amber-500/30 bg-amber-500/5 text-amber-400'
                      : 'border-stone-800 text-stone-500'
                  }`}
                >
                  {q}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Center: selected panel preview */}
        <div className="col-span-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-fraunces text-sm italic text-amber-500/80">Selected Shot</div>
            <button
              type="button"
              disabled
              className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 px-3 py-1.5 font-mono text-[10px] tracking-wider text-amber-500 opacity-50"
              title="12.5.2 將開放"
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" /> Kling 多鏡頭(實驗)
            </button>
          </div>

          <div className="overflow-hidden rounded-sm border border-stone-800/60 bg-stone-900/30">
            <div className="relative aspect-video bg-gradient-to-br from-stone-800 to-stone-900">
              {selected?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.imageUrl} alt="selected" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <AppIcon name="image" className="h-8 w-8 text-stone-600" />
                </div>
              )}
            </div>
            <div className="bg-stone-900/60 px-4 py-3">
              <div className="font-serif-cn text-stone-100">
                鏡頭 {String(selectedIndex + 1).padStart(2, '0')}
              </div>
              {selected?.videoUrl ? (
                <div className="mt-1 font-mono text-[10px] tracking-wider text-amber-500">
                  ✓ 視頻已生成
                </div>
              ) : selected?.imageUrl ? (
                <div className="mt-1 font-mono text-[10px] tracking-wider text-stone-500">
                  圖已生成,視頻待跑
                </div>
              ) : (
                <div className="mt-1 font-mono text-[10px] tracking-wider text-stone-500">尚未生成</div>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              disabled
              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-stone-800 bg-stone-900/50 py-2.5 font-serif-cn text-sm text-stone-300 opacity-60"
              title="12.5.2 接通"
            >
              <AppIcon name="image" className="h-3.5 w-3.5" />
              重新生成
            </button>
            <button
              type="button"
              disabled
              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 py-2.5 font-serif-cn text-sm text-amber-400 opacity-60"
              title="12.5.2 接通"
            >
              <AppIcon name="play" className="h-3.5 w-3.5" />
              首尾幀生視頻
            </button>
          </div>
        </div>

        {/* Right: inspector placeholder */}
        <div className="col-span-3 space-y-5">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-amber-600">主體 · CAST</div>
            {Array.isArray(selected?.characters) && selected.characters.length > 0 ? (
              <div className="space-y-1.5">
                {selected.characters.map((name, i) => (
                  <div
                    key={`${name}-${i}`}
                    className="flex items-center gap-2.5 rounded-sm border border-stone-800/60 bg-stone-900/40 px-2.5 py-1.5"
                  >
                    <div className="h-7 w-7 flex-shrink-0 rounded-sm bg-gradient-to-br from-amber-500 to-rose-700" />
                    <div className="font-serif-cn text-xs text-stone-200">{name}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-serif-cn text-xs text-stone-500">(無關聯角色)</p>
            )}
          </div>

          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-amber-600">註記 · NOTES</div>
            <div className="rounded-sm border border-stone-800/60 bg-stone-900/40 px-3 py-2 font-serif-cn text-xs leading-relaxed text-stone-400">
              {selected?.videoPrompt ?? '(無註記)'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PromptChipGroup({
  label,
  options,
  cols,
  active,
}: {
  label: string
  options: string[]
  cols: number
  active: number
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] tracking-wider text-stone-500">{label}</div>
      <div className={`grid gap-1.5 ${cols === 1 ? '' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {options.map((v, i) => (
          <button
            key={v}
            type="button"
            disabled
            className={`rounded-sm border px-2 py-1.5 text-left font-serif-cn text-xs transition-all ${
              i === active
                ? 'border-amber-500/50 bg-amber-500/5 text-amber-400'
                : 'border-stone-800 text-stone-500'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

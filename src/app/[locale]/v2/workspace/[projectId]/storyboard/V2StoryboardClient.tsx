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
import { useRegenerateProjectPanelImage } from '@/lib/query/mutations/storyboard-panel-mutations'

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
  novelPromotionData?: { episodes?: Array<{ id: string }> | null } | null
}

interface ProjectLikeFull {
  novelPromotionData?: {
    videoModel?: string | null
    episodes?: Array<{ id: string }> | null
  } | null
}

type MultiShotState =
  | { status: 'idle' }
  | { status: 'submitting'; sent: number; total: number }
  | { status: 'done'; sent: number; failures: number }
  | { status: 'error'; message: string }

const KLING_GROUP_SIZE = 5 // panel/group; API allows 2-6

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
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLikeFull | undefined
  const firstEpisodeId = project?.novelPromotionData?.episodes?.[0]?.id ?? null

  const storyboardsQuery = useStoryboards(firstEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined
  const regenPanel = useRegenerateProjectPanelImage(projectId)

  const [multiShotState, setMultiShotState] = useState<MultiShotState>({ status: 'idle' })

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

  async function handleSubmitMultiShot() {
    const videoModel = project?.novelPromotionData?.videoModel
    if (!videoModel) {
      setMultiShotState({
        status: 'error',
        message: '請先在 profile / 預設模型配置 中選擇視頻模型(建議 Kling-3.0-Omni)',
      })
      return
    }
    if (!videoModel.toLowerCase().includes('kling')) {
      setMultiShotState({
        status: 'error',
        message: `多鏡頭只支援 Kling 系列模型,你目前選的是 ${videoModel}`,
      })
      return
    }
    const eligible = allPanels.filter((p) => Boolean(p.imageUrl))
    if (eligible.length < 2) {
      setMultiShotState({
        status: 'error',
        message: '至少需要 2 個有圖的分鏡才能跑 multi-shot',
      })
      return
    }
    const groups = chunk(eligible.map((p) => p.id), KLING_GROUP_SIZE)
    setMultiShotState({ status: 'submitting', sent: 0, total: groups.length })
    let sent = 0
    let failures = 0
    for (const groupIds of groups) {
      try {
        const res = await fetch(`/api/novel-promotion/${projectId}/generate-multi-shot-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ panelIds: groupIds, videoModel, async: true }),
        })
        if (!res.ok) failures += 1
      } catch {
        failures += 1
      }
      sent += 1
      setMultiShotState({ status: 'submitting', sent, total: groups.length })
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
              onClick={() => handleSubmitMultiShot()}
              disabled={multiShotState.status === 'submitting'}
              className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[10px] tracking-wider text-amber-500 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              title="把所有有圖的分鏡 5 個一組送 Kling multi-shot=intelligence"
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              {multiShotState.status === 'submitting'
                ? `送出中 ${multiShotState.sent}/${multiShotState.total}`
                : 'Kling 多鏡頭(批次)'}
            </button>
          </div>
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
              disabled={!selected || regenPanel.isPending}
              onClick={() => {
                if (!selected) return
                regenPanel.mutate({ panelId: selected.id })
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-stone-800 bg-stone-900/50 py-2.5 font-serif-cn text-sm text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="image" className="h-3.5 w-3.5" />
              {regenPanel.isPending ? '提交中…' : '重新生成圖'}
            </button>
            <button
              type="button"
              disabled
              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 py-2.5 font-serif-cn text-sm text-amber-400 opacity-60"
              title="12.5.2 接 video pipeline"
            >
              <AppIcon name="play" className="h-3.5 w-3.5" />
              首尾幀生視頻
            </button>
          </div>
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

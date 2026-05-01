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
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'
import { useRegenerateProjectPanelImage } from '@/lib/query/mutations/storyboard-panel-mutations'
import { useAutoGroupMultiShot } from '@/lib/query/mutations/auto-group-multi-shot-mutation'
import { useTaskSnapshot } from '@/lib/query/hooks/useTaskStatus'
import { queryKeys } from '@/lib/query/keys'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'

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
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
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
  // Episode picked via the V2WorkspaceShell tab bar (URL ?episode=<id>);
  // falls back to first episode when none is selected.
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)

  const storyboardsQuery = useStoryboards(currentEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined
  const regenPanel = useRegenerateProjectPanelImage(projectId)
  const autoGroup = useAutoGroupMultiShot(projectId)

  const [multiShotState, setMultiShotState] = useState<MultiShotState>({ status: 'idle' })
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>({ status: 'idle' })

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
  const analyzeError = analyzeSnapshot.data?.errorMessage ?? null

  useEffect(() => {
    if (!isAnalyzing) return
    const interval = setInterval(() => { void analyzeSnapshot.refetch() }, 3000)
    return () => clearInterval(interval)
  }, [isAnalyzing, analyzeSnapshot])

  const previousAnalyzeStatus = useRef(analyzeStatus)
  useEffect(() => {
    if (previousAnalyzeStatus.current !== 'completed' && analyzeStatus === 'completed' && currentEpisodeId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(currentEpisodeId) })
    }
    previousAnalyzeStatus.current = analyzeStatus
  }, [analyzeStatus, currentEpisodeId, queryClient])

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
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
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
    // B path = Tencent VOD Kling-3 / Omni / O1 (text-to-video with
    // multi_shot=intelligence). Panels without imageUrl are still
    // eligible because the model goes straight from text to video.
    // C path needs imageUrl for first-frame i2v.
    const isBPath = /^tencent-vod::Kling-(3|O1)/i.test(videoModel)
    const eligible = isBPath
      ? allPanels
      : allPanels.filter((p) => Boolean(p.imageUrl))
    if (eligible.length < 2) {
      setMultiShotState({
        status: 'error',
        message: isBPath
          ? '至少需要 2 個分鏡才能跑 multi-shot(B path)'
          : '至少需要 2 個有圖的分鏡才能跑 multi-shot(或切到 Kling-3.0-Omni 走 t2v B path,免生圖)',
      })
      return
    }

    // Prefer LLM-assigned groups (Phase 12.5.3): if any panel has a
    // multiShotGroupId, group everything by that, otherwise fall back to
    // mechanical chunk(5).
    let groups: string[][]
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
      groups = Array.from(grouped.values()).map((panels) =>
        panels
          .slice()
          .sort((a, b) => (a.multiShotGroupOrder ?? 0) - (b.multiShotGroupOrder ?? 0))
          .map((p) => p.id),
      )
      // Drop any group < 2 (Kling rejects). Drop any group > 6 (slice).
      groups = groups
        .filter((g) => g.length >= 2)
        .map((g) => (g.length > 6 ? g.slice(0, 6) : g))
    } else {
      groups = chunk(eligible.map((p) => p.id), KLING_GROUP_SIZE)
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
    const submitDisabled = analyzeState.status === 'submitting' || isAnalyzing || !currentEpisodeId
    const ctaLabel = analyzeState.status === 'submitting'
      ? '提交中…'
      : isAnalyzing
        ? `分析中… ${analyzeProgress}%`
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
            {analyzeStatus === 'failed' && analyzeError ? (
              <p className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                上次分析失敗:{analyzeError}
              </p>
            ) : null}
            {!currentEpisodeId ? (
              <p className="font-mono text-[10px] tracking-wider text-stone-500">
                沒有可用集數 — 請先回上方分頁建立或選擇集數,並到劇本 step 貼劇本
              </p>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top: panel strip */}
      <div className="border-b border-amber-900/15 px-12 pb-4 pt-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="font-fraunces text-sm italic text-amber-500/80">Storyboard Strip</div>
            {hasGroups ? (
              <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-400">
                {orderedGroupIds.length} GROUPS · {groupedPanelCount}/{allPanels.length} 已切組
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={analyzeState.status === 'submitting' || isAnalyzing || !currentEpisodeId}
              onClick={handleAnalyzeStoryboard}
              title="重新從劇本生成分鏡(會覆蓋現有分鏡)"
              className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[10px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              {analyzeState.status === 'submitting'
                ? '提交中…'
                : isAnalyzing
                  ? `分析中… ${analyzeProgress}%`
                  : '↻ 重新分析'}
            </button>
            <button
              type="button"
              disabled={autoGroup.isPending || allPanels.length < 2}
              onClick={handleAutoGroup}
              title="LLM 把分鏡按場景/角色連續性切成 2-6 個 panel/群,提升 Kling 多鏡頭品質"
              className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[10px] tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              {autoGroup.isPending ? '切組中…' : hasGroups ? '↻ 重新切組' : '🧠 智能切組'}
            </button>
            <div className="font-mono text-[10px] tracking-wider text-stone-500">
              {allPanels.length} SHOTS · DRAFT 03
            </div>
          </div>
        </div>
        {isAnalyzing ? (
          <div className="mb-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
            正在重新分析劇本… {analyzeProgress}% — 完成後分鏡會自動刷新
          </div>
        ) : null}
        {analyzeState.status === 'error' ? (
          <div className="mb-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
            提交失敗:{analyzeState.message}
          </div>
        ) : null}
        {autoGroup.isError ? (
          <div className="mb-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
            切組失敗:{(autoGroup.error as Error)?.message ?? '未知錯誤'}
          </div>
        ) : null}
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
              title={(() => {
                const m = project?.novelPromotionData?.videoModel ?? ''
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
                    return /^tencent-vod::Kling-(3|O1)/i.test(m)
                      ? '智能多鏡頭 (B 路徑)'
                      : 'Kling 多鏡頭(批次)'
                  })()}
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

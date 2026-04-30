'use client'

/**
 * Phase 12.7 — v2 FinalPage.
 *
 * Minimum viable: native HTML5 video player on the left
 * (auto-picks the first panel that has a videoUrl), 12-segment
 * timeline strip below it, stats panel + export CTAs on the right.
 *
 * Real全集 stitching / export pipeline is wiring through the
 * existing FFmpeg-based video editor — Phase 12.7.x will hook
 * the export button to that. For now the export button is
 * disabled with a tooltip pointing at the legacy /workspace
 * "全集合成" CTA.
 */

import { useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'

interface V2FinalClientProps {
  projectId: string
}

interface PanelLike {
  id: string
  imageUrl?: string | null
  videoUrl?: string | null
}

interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

interface ProjectLike {
  novelPromotionData?: {
    videoRatio?: string | null
    targetDuration?: number | null
    episodes?: Array<{ id: string }> | null
  } | null
}

export function V2FinalClient({ projectId }: V2FinalClientProps) {
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLike | undefined
  const firstEpisodeId = project?.novelPromotionData?.episodes?.[0]?.id ?? null
  const storyboardsQuery = useStoryboards(firstEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined

  const allPanels = useMemo<PanelLike[]>(() => {
    return (storyboardsData?.storyboards ?? []).flatMap((s) => s.panels ?? [])
  }, [storyboardsData])

  const panelsWithVideo = allPanels.filter((p) => p.videoUrl)
  const panelsWithImage = allPanels.filter((p) => p.imageUrl)
  const firstVideoPanel = panelsWithVideo[0] ?? null

  const [active, setActive] = useState<string | null>(null)
  const activePanel = active ? allPanels.find((p) => p.id === active) ?? firstVideoPanel : firstVideoPanel

  const ratio = project?.novelPromotionData?.videoRatio ?? '9:16'
  const targetDuration = project?.novelPromotionData?.targetDuration ?? 60
  const generatedSeconds = panelsWithVideo.length * 5 // rough estimate; Kling default 5s

  return (
    <div className="px-12 py-10">
      <div className="grid grid-cols-3 gap-8">
        {/* Player + Timeline */}
        <div className="col-span-2">
          <div className="relative overflow-hidden rounded-sm border border-amber-900/30 bg-stone-950">
            <div className="relative aspect-video bg-gradient-to-br from-stone-800 to-stone-900">
              {activePanel?.videoUrl ? (
                <video
                  key={activePanel.id}
                  src={activePanel.videoUrl}
                  controls
                  className="h-full w-full bg-stone-950"
                />
              ) : activePanel?.imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activePanel.imageUrl}
                    alt="preview"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-stone-950/40">
                    <p className="font-fraunces text-base italic text-stone-300">尚未生成此分鏡視頻</p>
                  </div>
                </>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <p className="font-fraunces text-base italic text-stone-500">還沒有任何分鏡資料</p>
                </div>
              )}
            </div>
            <div className="absolute left-4 top-4 font-mono text-[10px] tracking-[0.3em] text-amber-300/80">
              EP 01 · OPENING SEQUENCE
            </div>
          </div>

          {/* Timeline strip */}
          <div className="mt-5 rounded-sm border border-stone-800/60 bg-stone-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-fraunces text-sm italic text-amber-500/80">Timeline</div>
              <div className="font-mono text-[10px] tracking-wider text-stone-500">
                {panelsWithVideo.length} / {allPanels.length} 段已生視頻
              </div>
            </div>
            <div className="flex h-12 gap-1 overflow-x-auto">
              {allPanels.map((p, i) => {
                const ready = Boolean(p.videoUrl)
                const isActive = activePanel?.id === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActive(p.id)}
                    className={`relative flex-shrink-0 overflow-hidden rounded-sm border-2 transition-all ${
                      isActive
                        ? 'border-amber-500'
                        : ready
                          ? 'border-amber-700/40'
                          : 'border-stone-800/60 opacity-50'
                    }`}
                    style={{ width: 48 }}
                    title={ready ? '已生視頻' : p.imageUrl ? '只有圖' : '尚未生成'}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-stone-900" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-stone-950/40 to-transparent" />
                    <div className="absolute bottom-0.5 left-0.5 font-mono text-[8px] text-stone-200">
                      {String(i + 1).padStart(2, '0')}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Stats + Export */}
        <div className="col-span-1 space-y-5">
          <div className="rounded-sm border border-amber-900/20 bg-stone-900/40 p-5">
            <div className="mb-4 font-fraunces text-sm italic text-amber-500/80">Sheet</div>
            <dl className="space-y-3">
              {[
                { k: '總分鏡', v: `${allPanels.length} 個` },
                { k: '已生圖', v: `${panelsWithImage.length}` },
                { k: '已生視頻', v: `${panelsWithVideo.length}` },
                { k: '解析度', v: ratio },
                { k: '目標時長', v: `${targetDuration}s` },
                { k: '預估已產出', v: `${generatedSeconds}s` },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex justify-between border-b border-stone-800/50 pb-2 last:border-0"
                >
                  <dt className="font-serif-cn text-sm text-stone-400">{row.k}</dt>
                  <dd className="self-end font-mono text-xs tracking-wider text-stone-200">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <button
            type="button"
            disabled
            title="12.7.x 接 FFmpeg 全集合成 pipeline"
            className="flex w-full items-center justify-center gap-2 rounded-sm bg-amber-500 py-3 font-serif-cn text-base font-medium text-stone-950 opacity-60 disabled:cursor-not-allowed"
          >
            <AppIcon name="download" className="h-4 w-4" />
            匯出 MP4 · 1080P
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled
              className="rounded-sm border border-stone-800 bg-stone-900/40 py-2.5 font-serif-cn text-xs text-stone-300 opacity-60"
            >
              下載分鏡素材
            </button>
            <button
              type="button"
              disabled
              className="rounded-sm border border-stone-800 bg-stone-900/40 py-2.5 font-serif-cn text-xs text-stone-300 opacity-60"
            >
              查看劇本
            </button>
          </div>

          <div className="rounded-sm border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-rose-900/10 p-4">
            <div className="font-fraunces text-sm italic text-amber-400">From spark to screen.</div>
            <div className="mt-2 font-serif-cn text-xs leading-relaxed text-stone-300">
              Phase 12.7 stub — 完整 export / preview 12.7.x 接通。
              <br />
              先用 timeline 上的 thumbnail 點選預覽各分鏡視頻。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

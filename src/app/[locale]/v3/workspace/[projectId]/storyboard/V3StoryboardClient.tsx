'use client'

/**
 * V3 Storyboard — Plan A "Gallery + Detail" layout preview.
 *
 * 60% main gallery grid (left) + 40% selected-shot detail panel (right).
 * Gallery cards render at the project's actual videoRatio (9:16 / 16:9 /
 * 1:1 etc) so portrait and landscape projects both look right. Selected
 * shot mid-size (~280px wide for 9:16 on a 16-inch screen), no longer
 * dominates the viewport.
 *
 * Reuses existing v2 hooks (useStoryboards, useUpdatePanelText,
 * useGenerateVideo, useRegeneratePanelImage) so wiring matches v2.
 *
 * 多鏡頭組合:點「智能多鏡頭」後 panels grouped by multiShotGroupId,
 * rendered as group cards instead of individual panels (collapsable).
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import {
  useStoryboards,
  useUpdatePanelText,
  useGenerateVideo,
} from '@/lib/query/hooks/useStoryboards'
import { useRegenerateProjectPanelImage } from '@/lib/query/mutations/storyboard-panel-mutations'
import { useCurrentEpisode } from '../../../../v2/workspace/[projectId]/hooks/useCurrentEpisode'

interface PanelLike {
  id: string
  storyboardId?: string | null
  panelIndex?: number | null
  description?: string | null
  srtSegment?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  characters?: string[] | null
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
}

interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

interface ProjectLikeFull {
  novelPromotionData?: {
    videoModel?: string | null
    videoRatio?: string | null
    episodes?: Array<{ id: string }> | null
  } | null
}

function aspectClassFromRatio(ratio: string | null | undefined): string {
  if (!ratio) return 'aspect-video'
  switch (ratio.trim()) {
    case '1:1':  return 'aspect-square'
    case '16:9': return 'aspect-video'
    case '9:16': return 'aspect-[9/16]'
    case '4:3':  return 'aspect-[4/3]'
    case '3:4':  return 'aspect-[3/4]'
    case '3:2':  return 'aspect-[3/2]'
    case '2:3':  return 'aspect-[2/3]'
    case '21:9': return 'aspect-[21/9]'
    default: {
      const [w, h] = ratio.split(':').map((n) => Number.parseFloat(n))
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `aspect-[${w}/${h}]`
      return 'aspect-video'
    }
  }
}

interface V3StoryboardClientProps {
  projectId: string
  locale: string
}

export function V3StoryboardClient({ projectId, locale }: V3StoryboardClientProps) {
  const queryClient = useQueryClient()
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLikeFull | undefined
  const projectVideoRatio = project?.novelPromotionData?.videoRatio ?? '16:9'
  const aspectClass = aspectClassFromRatio(projectVideoRatio)

  const { currentEpisodeId } = useCurrentEpisode(projectId)
  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined

  const allPanels = useMemo<PanelLike[]>(() => {
    return (storyboardsData?.storyboards ?? []).flatMap((s) => s.panels ?? [])
  }, [storyboardsData])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [groupedView, setGroupedView] = useState(false)
  const selected = allPanels.find((p) => p.id === selectedId) ?? allPanels[0] ?? null

  // ─── Group view ──────────────────────────────────────────────────
  // When user toggles 多鏡頭 grouped view, panels are collapsed into
  // their multiShotGroupId clusters (or chunks of 5 fallback).
  const groups = useMemo(() => {
    if (!groupedView) return []
    const map = new Map<string, PanelLike[]>()
    let fallbackIdx = 0
    for (const p of allPanels) {
      const gid = p.multiShotGroupId || `auto-${Math.floor(fallbackIdx / 5)}`
      fallbackIdx += 1
      const arr = map.get(gid) || []
      arr.push(p)
      map.set(gid, arr)
    }
    return Array.from(map.entries()).map(([id, panels]) => ({ id, panels }))
  }, [groupedView, allPanels])

  // ─── Mutations ───────────────────────────────────────────────────
  const regenPanel = useRegenerateProjectPanelImage(projectId)
  const updateText = useUpdatePanelText(projectId, currentEpisodeId)
  const generateVideo = useGenerateVideo(projectId, currentEpisodeId)

  const [descDraft, setDescDraft] = useState('')
  const [dialogueDraft, setDialogueDraft] = useState('')
  // Reset drafts when the user picks a different panel. Intentionally
  // narrow deps to selected?.id so external updates to description /
  // srtSegment (e.g., LLM regenerated text landing while the user is
  // mid-edit) don't clobber the in-progress draft. Reading the latest
  // value off `selected` inside the effect is correct: the effect only
  // fires on id change, by which point `selected` has resolved.
  useEffect(() => {
    setDescDraft(selected?.description ?? '')
    setDialogueDraft(selected?.srtSegment ?? '')
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRegenImage() {
    if (!selected) return
    regenPanel.mutate({ panelId: selected.id })
  }
  function handleSaveDesc() {
    if (!selected) return
    updateText.mutate({ panelId: selected.id, description: descDraft })
  }
  function handleSaveDialogue() {
    if (!selected) return
    updateText.mutate({ panelId: selected.id, srtSegment: dialogueDraft })
  }
  function handleGenVideo() {
    if (!selected) return
    const videoModel = project?.novelPromotionData?.videoModel
    if (!videoModel) {
      alert('專案尚未設定 video model')
      return
    }
    generateVideo.mutate({
      panelId: selected.id,
      storyboardId: selected.storyboardId ?? '',
      panelIndex: selected.panelIndex ?? 0,
      videoModel,
    })
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="font-body grain min-h-screen bg-stone-950 text-stone-200">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-amber-900/20 bg-stone-950/80 px-8 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link href={`/${locale}/v2/workspace/${projectId}/storyboard`} className="font-mono text-[11px] tracking-wider text-stone-500 hover:text-amber-400">
            ← 回 V2
          </Link>
          <div className="font-display text-2xl italic text-amber-400">分鏡 V3</div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600/70">
            PLAN A · GALLERY
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setGroupedView((v) => !v)}
            className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-wider transition-all ${
              groupedView
                ? 'border-violet-500/60 bg-violet-500/15 text-violet-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
            }`}
          >
            <AppIcon name="sparklesAlt" className="h-3 w-3" />
            {groupedView ? '✓ 多鏡頭組合中' : '智能多鏡頭組合'}
          </button>
          <div className="font-mono text-[10px] tracking-wider text-stone-500">
            {allPanels.length} SHOTS
            {groupedView ? ` · ${groups.length} GROUPS` : ''}
          </div>
        </div>
      </header>

      {/* Main 60/40 split */}
      <div className="grid min-h-[calc(100vh-65px)] grid-cols-[1.5fr_1fr] gap-0">
        {/* Left: gallery */}
        <div className="overflow-y-auto border-r border-amber-900/15 px-8 py-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="font-fraunces text-base italic text-amber-500/80">
              {groupedView ? `${groups.length} 個多鏡頭組合` : `${allPanels.length} 個分鏡`}
            </div>
            <div className="font-mono text-[10px] tracking-wider text-stone-600">
              比例 {projectVideoRatio}
            </div>
          </div>

          {groupedView ? (
            <div className="space-y-6">
              {groups.map((g, gi) => (
                <div key={g.id} className="rounded-sm border border-amber-900/30 bg-stone-900/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="font-fraunces text-sm italic text-amber-400">
                      Group {String(gi + 1).padStart(2, '0')} · {g.panels.length} shots
                    </div>
                    <button
                      type="button"
                      className="rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1 font-mono text-[10px] tracking-wider text-violet-300 hover:bg-violet-500/20"
                    >
                      ↻ 重生 multi-shot 視頻
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {g.panels.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={`relative overflow-hidden rounded-sm border ${
                          selectedId === p.id ? 'border-amber-500/60 ring-2 ring-amber-500/20' : 'border-stone-800'
                        }`}
                      >
                        <div className={`relative ${aspectClass} bg-stone-900`}>
                          {p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imageUrl} alt={`#${i + 1}`} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <AppIcon name="image" className="h-5 w-5 text-stone-700" />
                            </div>
                          )}
                          <div className="absolute left-1.5 top-1.5 rounded bg-stone-950/60 px-1.5 py-0.5 font-mono text-[9px] text-stone-200 backdrop-blur-sm">
                            #{String(i + 1).padStart(2, '0')}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {allPanels.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`group flex flex-col overflow-hidden rounded-sm border text-left transition-all ${
                    selectedId === p.id
                      ? 'border-amber-500/60 ring-2 ring-amber-500/20'
                      : 'border-stone-800/60 hover:border-amber-500/40'
                  }`}
                >
                  <div className={`relative ${aspectClass} bg-gradient-to-br from-stone-800 to-stone-900`}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={`#${i + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <AppIcon name="image" className="h-7 w-7 text-stone-600" />
                      </div>
                    )}
                    <div className="absolute left-2 top-2 rounded bg-stone-950/60 px-2 py-0.5 font-mono text-[10px] text-stone-200 backdrop-blur-sm">
                      #{String(i + 1).padStart(2, '0')}
                    </div>
                    {p.videoUrl ? (
                      <div className="absolute bottom-2 right-2 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[9px] text-stone-950 backdrop-blur-sm">
                        ▶ 視頻
                      </div>
                    ) : null}
                  </div>
                  <div className="bg-stone-900/40 px-3 py-2">
                    <div className="line-clamp-2 font-serif-cn text-xs leading-snug text-stone-200">
                      {p.description?.slice(0, 60) ?? `分鏡 ${i + 1}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: selected shot detail */}
        <aside className="overflow-y-auto bg-stone-950/40 px-6 py-6">
          {selected ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div className="font-fraunces text-base italic text-amber-500/80">
                  鏡頭 {String((allPanels.findIndex((p) => p.id === selected.id) + 1)).padStart(2, '0')}
                </div>
                <div className="font-mono text-[10px] tracking-wider text-stone-500">
                  {selected.videoUrl ? '✓ 視頻已生成' : selected.imageUrl ? '圖已生成' : '尚未生成'}
                </div>
              </div>

              {/* Preview */}
              <div className={`relative overflow-hidden rounded-sm border border-stone-800 ${aspectClass} mx-auto max-h-[480px] max-w-[280px] bg-gradient-to-br from-stone-800 to-stone-900`}>
                {selected.videoUrl ? (
                  <video src={selected.videoUrl} poster={selected.imageUrl ?? undefined} controls className="h-full w-full object-cover" />
                ) : selected.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.imageUrl} alt="selected" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <AppIcon name="image" className="h-8 w-8 text-stone-600" />
                  </div>
                )}
              </div>

              {/* Action row */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleRegenImage}
                  disabled={regenPanel.isPending}
                  className="rounded-sm border border-stone-800 bg-stone-900/50 py-2 font-serif-cn text-xs text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50"
                >
                  {regenPanel.isPending ? '提交中…' : '重新生成圖'}
                </button>
                <button
                  type="button"
                  onClick={handleGenVideo}
                  disabled={!selected.imageUrl || generateVideo.isPending}
                  className="rounded-sm border border-amber-500/40 bg-amber-500/10 py-2 font-serif-cn text-xs text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {generateVideo.isPending ? '提交中…' : selected.videoUrl ? '↻ 重生視頻' : '生成視頻'}
                </button>
              </div>

              {/* Edit fields */}
              <div className="mt-5 space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="font-mono text-[10px] tracking-wider text-amber-600">描述詞</div>
                    <button
                      type="button"
                      onClick={handleSaveDesc}
                      disabled={updateText.isPending || descDraft === (selected.description ?? '')}
                      className="rounded-sm border border-amber-500/40 px-2 py-0.5 font-mono text-[9px] tracking-wider text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      儲存
                    </button>
                  </div>
                  <textarea
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    rows={4}
                    className="w-full rounded-sm border border-stone-800 bg-stone-900/50 p-2 font-body text-xs text-stone-200 outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="font-mono text-[10px] tracking-wider text-amber-600">對話</div>
                    <button
                      type="button"
                      onClick={handleSaveDialogue}
                      disabled={updateText.isPending || dialogueDraft === (selected.srtSegment ?? '')}
                      className="rounded-sm border border-amber-500/40 px-2 py-0.5 font-mono text-[9px] tracking-wider text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      儲存
                    </button>
                  </div>
                  <textarea
                    value={dialogueDraft}
                    onChange={(e) => setDialogueDraft(e.target.value)}
                    rows={3}
                    placeholder="這個鏡頭的台詞 / 旁白 / 字幕"
                    className="w-full rounded-sm border border-stone-800 bg-stone-900/50 p-2 font-body text-xs text-stone-200 outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              {/* Download row */}
              <div className="mt-4 flex gap-2">
                <a
                  href={selected.imageUrl ?? '#'}
                  download={selected.imageUrl ? `panel-${(allPanels.findIndex((p) => p.id === selected.id) + 1).toString().padStart(2, '0')}.jpg` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!selected.imageUrl}
                  onClick={(e) => { if (!selected.imageUrl) e.preventDefault() }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-stone-800 py-1.5 font-mono text-[10px] tracking-wider transition-all ${selected.imageUrl ? 'text-stone-400 hover:border-amber-500/40 hover:text-amber-400' : 'cursor-not-allowed text-stone-600 opacity-50'}`}
                >
                  <AppIcon name="download" className="h-3 w-3" />
                  下載圖
                </a>
                <a
                  href={selected.videoUrl ?? '#'}
                  download={selected.videoUrl ? `panel-${(allPanels.findIndex((p) => p.id === selected.id) + 1).toString().padStart(2, '0')}.mp4` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!selected.videoUrl}
                  onClick={(e) => { if (!selected.videoUrl) e.preventDefault() }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-stone-800 py-1.5 font-mono text-[10px] tracking-wider transition-all ${selected.videoUrl ? 'text-stone-400 hover:border-amber-500/40 hover:text-amber-400' : 'cursor-not-allowed text-stone-600 opacity-50'}`}
                >
                  <AppIcon name="download" className="h-3 w-3" />
                  下載影片
                </a>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <p className="font-fraunces text-sm italic text-stone-500">點左邊任一分鏡進行編輯</p>
            </div>
          )}
        </aside>
      </div>
      {/* Suppress unused warning */}
      <div className="hidden">{queryClient.toString().slice(0, 1)}</div>
    </div>
  )
}

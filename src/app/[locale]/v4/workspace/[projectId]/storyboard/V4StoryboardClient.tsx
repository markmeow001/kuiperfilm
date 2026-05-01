'use client'

/**
 * V4 Storyboard — Plan B "Timeline + Editor" layout preview.
 *
 * 上排 horizontal timeline 帶所有 panel 縮圖(像 Premiere/CapCut 的 clip
 * track),用 multiShotGroupId 切組,group 間有「| Group A」分隔。
 * 下排 50/50:左 selected shot preview(中等 ~360px 寬,適合 16:9 沉浸感
 * 又不到霸佔)+ 右 detail form(描述詞 / 對話 / 動作)。
 *
 * 跟 V3(Gallery Plan A)同源 hook,純佈局差。User 預期 16:9 horizontal
 * project 走這個版本,9:16 走 V3 那個 grid 版本。最終可加 toggle 由
 * 使用者選。
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
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
  multiShotGroupId?: string | null
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

interface V4StoryboardClientProps {
  projectId: string
  locale: string
}

export function V4StoryboardClient({ projectId, locale }: V4StoryboardClientProps) {
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLikeFull | undefined
  const projectVideoRatio = project?.novelPromotionData?.videoRatio ?? '16:9'
  const aspectClass = aspectClassFromRatio(projectVideoRatio)
  const isPortraitRatio = (() => {
    const [w, h] = projectVideoRatio.split(':').map((n) => Number.parseFloat(n))
    return Number.isFinite(w) && Number.isFinite(h) && h > w
  })()
  // Timeline thumb height — wider for landscape (16:9 needs more room
  // to be readable), taller for portrait so 9:16 isn't pencil-thin.
  const timelineThumbHeight = isPortraitRatio ? 'h-40' : 'h-24'

  const { currentEpisodeId } = useCurrentEpisode(projectId)
  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined

  const allPanels = useMemo<PanelLike[]>(() => {
    return (storyboardsData?.storyboards ?? []).flatMap((s) => s.panels ?? [])
  }, [storyboardsData])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = allPanels.find((p) => p.id === selectedId) ?? allPanels[0] ?? null
  const selectedIndex = allPanels.findIndex((p) => p.id === selected?.id)

  // Group boundaries for the timeline divider visualisation.
  const groupBoundaryAt = useMemo(() => {
    const set = new Set<number>()
    for (let i = 1; i < allPanels.length; i += 1) {
      const prev = allPanels[i - 1].multiShotGroupId
      const cur = allPanels[i].multiShotGroupId
      if (prev && cur && prev !== cur) set.add(i)
    }
    return set
  }, [allPanels])

  // ─── Mutations ───────────────────────────────────────────────────
  const regenPanel = useRegenerateProjectPanelImage(projectId)
  const updateText = useUpdatePanelText(projectId, currentEpisodeId)
  const generateVideo = useGenerateVideo(projectId, currentEpisodeId)

  const [descDraft, setDescDraft] = useState('')
  const [dialogueDraft, setDialogueDraft] = useState('')
  useEffect(() => {
    setDescDraft(selected?.description ?? '')
    setDialogueDraft(selected?.srtSegment ?? '')
  }, [selected?.id, selected?.description, selected?.srtSegment])

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
          <Link href={`/${locale}/v3/workspace/${projectId}/storyboard`} className="font-mono text-[11px] tracking-wider text-stone-500 hover:text-amber-400">
            ⇄ V3 (Gallery)
          </Link>
          <div className="font-display text-2xl italic text-amber-400">分鏡 V4</div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600/70">
            PLAN B · TIMELINE
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[10px] tracking-wider text-violet-300 hover:bg-violet-500/20"
          >
            <AppIcon name="sparklesAlt" className="h-3 w-3" />
            智能多鏡頭組合
          </button>
          <div className="font-mono text-[10px] tracking-wider text-stone-500">
            {allPanels.length} SHOTS · 比例 {projectVideoRatio}
          </div>
        </div>
      </header>

      {/* Timeline strip */}
      <section className="border-b border-amber-900/15 bg-stone-950/60 px-8 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-fraunces text-sm italic text-amber-500/80">Timeline</div>
          <div className="font-mono text-[10px] tracking-wider text-stone-600">
            點任一片段 · 拖動橫向捲動
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {allPanels.map((p, i) => {
            const active = p.id === selected?.id
            const isBoundary = groupBoundaryAt.has(i)
            return (
              <div key={p.id} className="flex flex-shrink-0 items-stretch">
                {isBoundary ? (
                  <div className="mx-2 flex flex-col items-center justify-center">
                    <div className="h-full w-px bg-amber-500/30" />
                    <div className="mt-1 font-mono text-[8px] tracking-wider text-amber-600/60">|</div>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`group relative flex flex-shrink-0 flex-col overflow-hidden rounded-sm border transition-all ${
                    active
                      ? 'border-amber-500/70 ring-2 ring-amber-500/30'
                      : 'border-stone-800 hover:border-stone-700'
                  }`}
                >
                  <div className={`relative ${timelineThumbHeight} ${aspectClass} bg-gradient-to-br from-stone-800 to-stone-900`}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={`#${i + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <AppIcon name="image" className="h-4 w-4 text-stone-700" />
                      </div>
                    )}
                    <div className="absolute left-1 top-1 rounded bg-stone-950/60 px-1 py-0.5 font-mono text-[9px] text-stone-200 backdrop-blur-sm">
                      #{String(i + 1).padStart(2, '0')}
                    </div>
                    {p.videoUrl ? (
                      <div className="absolute right-1 bottom-1 rounded bg-amber-500/90 px-1 py-0.5 font-mono text-[8px] text-stone-950">
                        ▶
                      </div>
                    ) : null}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Bottom split: preview | form */}
      <main className="grid grid-cols-[1fr_1fr] gap-8 px-8 py-6">
        {/* LEFT: Selected preview */}
        <div className="flex flex-col items-start">
          {selected ? (
            <>
              <div className="mb-3 flex w-full items-center justify-between">
                <div className="font-fraunces text-base italic text-amber-500/80">
                  鏡頭 {String(selectedIndex + 1).padStart(2, '0')} · Selected
                </div>
                <div className="font-mono text-[10px] tracking-wider text-stone-500">
                  {selected.videoUrl ? '✓ 視頻已生成' : selected.imageUrl ? '圖已生成,視頻待跑' : '尚未生成'}
                </div>
              </div>
              <div className={`relative w-full overflow-hidden rounded-sm border border-stone-800 ${aspectClass} bg-gradient-to-br from-stone-800 to-stone-900`}>
                {selected.videoUrl ? (
                  <video src={selected.videoUrl} poster={selected.imageUrl ?? undefined} controls className="h-full w-full object-cover" />
                ) : selected.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.imageUrl} alt="selected" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <AppIcon name="image" className="h-10 w-10 text-stone-600" />
                  </div>
                )}
              </div>
              <div className="mt-3 flex w-full gap-2">
                <button
                  type="button"
                  onClick={handleRegenImage}
                  disabled={regenPanel.isPending}
                  className="flex-1 rounded-sm border border-stone-800 bg-stone-900/50 py-2 font-serif-cn text-xs text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50"
                >
                  {regenPanel.isPending ? '提交中…' : '重新生成圖'}
                </button>
                <button
                  type="button"
                  onClick={handleGenVideo}
                  disabled={!selected.imageUrl || generateVideo.isPending}
                  className="flex-1 rounded-sm border border-amber-500/40 bg-amber-500/10 py-2 font-serif-cn text-xs text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {generateVideo.isPending ? '提交中…' : selected.videoUrl ? '↻ 重生視頻' : '生成視頻'}
                </button>
              </div>
              <div className="mt-2 flex w-full gap-2">
                <a
                  href={selected.imageUrl ?? '#'}
                  download={selected.imageUrl ? `panel-${(selectedIndex + 1).toString().padStart(2, '0')}.jpg` : undefined}
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
                  download={selected.videoUrl ? `panel-${(selectedIndex + 1).toString().padStart(2, '0')}.mp4` : undefined}
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
            <div className="flex h-full w-full items-center justify-center text-center">
              <p className="font-fraunces text-sm italic text-stone-500">尚未選擇分鏡</p>
            </div>
          )}
        </div>

        {/* RIGHT: form */}
        <aside className="space-y-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="font-mono text-[10px] tracking-wider text-amber-600">SHOT {String(selectedIndex + 1).padStart(2, '0')} · 描述詞</div>
              <button
                type="button"
                onClick={handleSaveDesc}
                disabled={!selected || updateText.isPending || descDraft === (selected?.description ?? '')}
                className="rounded-sm border border-amber-500/40 px-2 py-0.5 font-mono text-[9px] tracking-wider text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
              >
                {updateText.isPending ? '儲存中…' : '儲存'}
              </button>
            </div>
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              rows={5}
              placeholder="這個鏡頭的場景 / 構圖描述,生圖會用到"
              className="w-full rounded-sm border border-stone-800 bg-stone-900/50 p-3 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="font-mono text-[10px] tracking-wider text-amber-600">SHOT {String(selectedIndex + 1).padStart(2, '0')} · 對話</div>
              <button
                type="button"
                onClick={handleSaveDialogue}
                disabled={!selected || updateText.isPending || dialogueDraft === (selected?.srtSegment ?? '')}
                className="rounded-sm border border-amber-500/40 px-2 py-0.5 font-mono text-[9px] tracking-wider text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
              >
                {updateText.isPending ? '儲存中…' : '儲存'}
              </button>
            </div>
            <textarea
              value={dialogueDraft}
              onChange={(e) => setDialogueDraft(e.target.value)}
              rows={3}
              placeholder="這個鏡頭的台詞 / 旁白 / 字幕。空白即為無對白。"
              className="w-full rounded-sm border border-stone-800 bg-stone-900/50 p-3 font-body text-sm text-stone-200 outline-none focus:border-amber-500/50"
            />
          </div>

          {/* Quick reference: chip groups (non-functional preview) */}
          <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 p-3">
            <div className="mb-2 font-mono text-[10px] tracking-wider text-stone-500">運鏡 / 視角(待接 capability)</div>
            <div className="flex flex-wrap gap-1.5">
              {['平視', '仰視', '俯視', '中景', '近景', '中度推進', '逆光', '電影感'].map((chip) => (
                <span key={chip} className="rounded-sm border border-stone-700 bg-stone-900/50 px-2 py-0.5 font-serif-cn text-[10px] text-stone-400">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}

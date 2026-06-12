'use client'

/**
 * V5 Storyboard — Narrative-driven preview (R2V flow).
 *
 * Read-only render of mockup 13's narrative editor layout: left roster
 * (characters / locations / props with @-mention names) + right narrative
 * column of panel segments. PR-D1 ships READ-ONLY; PR-D2 adds inline
 * @chip highlighting, PR-D3 lifts to a Tiptap editor with autocomplete +
 * single-segment regenerate + autosave.
 *
 * Mirrors v3/v4's preview-route pattern (alongside `/v2` prod). No data
 * mutation, no schema impact — pure visual scaffold over existing panel
 * data.
 *
 * Data sources (reused, not new):
 *   - useProjectData(projectId)            project + characters + locations
 *   - useCurrentEpisode(projectId)         current episode tracking
 *   - useStoryboards(projectId, episodeId) panels with description / srtSegment
 *
 * The narrative paragraph for each panel is `description` (falls back to
 * `srtSegment` if description is empty). PR-D2 will parse @-tokens within
 * the text and link them to the roster items.
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'
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
}

interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

interface CharacterLike {
  id: string
  name: string
  aliases?: string[] | null
  appearances?: Array<{ imageUrl?: string | null }> | null
}

interface LocationLike {
  id: string
  name: string
  images?: Array<{ imageUrl?: string | null }> | null
}

interface PropLike {
  id: string
  name: string
}

interface EpisodeLike {
  id: string
  episodeNumber?: number | null
  name?: string | null
}

interface ProjectLikeFull {
  novelPromotionData?: {
    videoRatio?: string | null
    episodes?: EpisodeLike[] | null
    characters?: CharacterLike[] | null
    locations?: LocationLike[] | null
    props?: PropLike[] | null
  } | null
}

interface V5StoryboardClientProps {
  projectId: string
  locale: string
}

/** First non-empty image url from a character's appearance set. */
function pickCharacterThumb(c: CharacterLike): string | null {
  for (const a of c.appearances ?? []) {
    if (a?.imageUrl) return a.imageUrl
  }
  return null
}

/** First non-empty image url from a location's image set. */
function pickLocationThumb(l: LocationLike): string | null {
  for (const i of l.images ?? []) {
    if (i?.imageUrl) return i.imageUrl
  }
  return null
}

export function V5StoryboardClient({ projectId, locale }: V5StoryboardClientProps) {
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLikeFull | undefined
  const np = project?.novelPromotionData

  const { currentEpisodeId } = useCurrentEpisode(projectId)
  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined

  const allPanels = useMemo<PanelLike[]>(() => {
    return (storyboardsData?.storyboards ?? []).flatMap((s) => s.panels ?? [])
  }, [storyboardsData])

  const characters = np?.characters ?? []
  const locations = np?.locations ?? []
  const props = np?.props ?? []
  const episodes = np?.episodes ?? []

  // Reading order — sequential render; PR-D3 will make this editable.
  const segments = allPanels

  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null)

  return (
    <div className="font-body min-h-screen bg-stone-950 text-stone-200">
      {/* Top banner — V5 marker, link back to V2 prod */}
      <header className="flex items-center justify-between border-b border-amber-900/20 bg-stone-950/80 px-8 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link
            href={`/${locale}/v2/workspace/${projectId}/storyboard`}
            className="font-mono text-[11px] tracking-wider text-stone-500 hover:text-amber-400"
          >
            ← 回 V2
          </Link>
          <div className="font-display text-2xl italic text-amber-400">敘事編輯 V5</div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600/70">
            R2V · NARRATIVE PREVIEW (READ-ONLY)
          </div>
        </div>
        <div className="font-mono text-[10px] text-stone-500">
          {projectQuery.isLoading ? '載入中…' : `${segments.length} 段敘事 · ${characters.length} 角色 · ${locations.length} 場景 · ${props.length} 道具`}
        </div>
      </header>

      {/* Episode tabs */}
      {episodes.length > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-900/15 bg-stone-950/60 px-8 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">集</div>
          {episodes.map((ep, idx) => (
            <div
              key={ep.id}
              className={
                ep.id === currentEpisodeId
                  ? 'rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-300'
                  : 'rounded-md border border-stone-800 bg-stone-900/40 px-3 py-1 text-[12px] text-stone-400'
              }
            >
              EP {ep.episodeNumber ?? idx + 1}
              {ep.name && <span className="ml-2 text-stone-500">{ep.name}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Body grid: left roster / right narrative */}
      <div className="grid grid-cols-[280px_1fr] gap-0">
        {/* ─── Roster (left) ───────────────────────────────────────── */}
        <aside className="border-r border-amber-900/15 bg-stone-950/40 px-5 py-6">
          <RosterSection
            title="角色"
            count={characters.length}
            items={characters.map((c) => ({
              id: c.id,
              name: c.name,
              meta: countMentionsIn(segments, c.name, c.aliases),
              thumbUrl: pickCharacterThumb(c),
              kind: 'character' as const,
            }))}
          />
          <RosterSection
            title="場景"
            count={locations.length}
            items={locations.map((l) => ({
              id: l.id,
              name: l.name,
              meta: countMentionsIn(segments, l.name, null),
              thumbUrl: pickLocationThumb(l),
              kind: 'location' as const,
            }))}
          />
          {props.length > 0 && (
            <RosterSection
              title="道具"
              count={props.length}
              items={props.map((p) => ({
                id: p.id,
                name: p.name,
                meta: countMentionsIn(segments, p.name, null),
                thumbUrl: null,
                kind: 'prop' as const,
              }))}
            />
          )}
        </aside>

        {/* ─── Narrative segments (right) ──────────────────────────── */}
        <main className="px-8 py-6">
          {storyboardsQuery.isLoading && (
            <div className="rounded border border-stone-800 bg-stone-900/40 px-5 py-12 text-center text-stone-500">
              載入分鏡資料中…
            </div>
          )}

          {!storyboardsQuery.isLoading && segments.length === 0 && (
            <div className="rounded border border-stone-800 bg-stone-900/40 px-5 py-12 text-center text-stone-500">
              這集還沒生成分鏡。先回 V2 跑「分析劇本」→「拆鏡」。
            </div>
          )}

          {segments.map((seg, idx) => (
            <SegmentBlock
              key={seg.id}
              index={idx + 1}
              segment={seg}
              isActive={seg.id === activeSegmentId}
              onClick={() => setActiveSegmentId(seg.id === activeSegmentId ? null : seg.id)}
            />
          ))}
        </main>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────

interface RosterItem {
  id: string
  name: string
  meta: number
  thumbUrl: string | null
  kind: 'character' | 'location' | 'prop'
}

function RosterSection({
  title,
  count,
  items,
}: {
  title: string
  count: number
  items: RosterItem[]
}) {
  if (items.length === 0) {
    return (
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">{title}</div>
          <div className="font-mono text-[10px] text-stone-600">0</div>
        </div>
        <div className="rounded border border-dashed border-stone-800 px-3 py-3 text-[11px] text-stone-600">
          尚未建立
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">{title}</div>
        <div className="font-mono text-[10px] text-stone-600">{count}</div>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="group flex items-center gap-2 rounded border border-transparent px-2 py-1.5 hover:border-amber-900/30 hover:bg-stone-900/40"
          >
            <div
              className="h-7 w-7 flex-none rounded bg-stone-800 bg-cover bg-center"
              style={item.thumbUrl ? { backgroundImage: `url(${item.thumbUrl})` } : undefined}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-stone-200">
                {item.name}
                <span className="ml-1.5 font-mono text-[10px] text-amber-500/70">@{item.name}</span>
              </div>
              <div className="text-[10px] text-stone-500">
                {item.meta > 0 ? `出現 ${item.meta} 段` : '未出現'}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SegmentBlock({
  index,
  segment,
  isActive,
  onClick,
}: {
  index: number
  segment: PanelLike
  isActive: boolean
  onClick: () => void
}) {
  const text = (segment.description?.trim() || segment.srtSegment?.trim() || '').trim()
  const refChars = (segment.characters ?? []).filter((c) => c && c.trim())

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'mb-4 block w-full rounded border px-5 py-4 text-left transition-colors '
        + (isActive
          ? 'border-amber-500/60 bg-amber-500/5'
          : 'border-stone-800 bg-stone-900/30 hover:border-amber-900/30 hover:bg-stone-900/50')
      }
    >
      <div className="mb-2 flex items-center gap-3">
        <div className="font-mono text-[11px] tracking-[0.15em] text-amber-500/80">
          段 {index}
        </div>
        {refChars.length > 0 && (
          <div className="font-mono text-[10px] text-stone-500">
            {refChars.slice(0, 3).map((c) => `@${c}`).join(' · ')}
            {refChars.length > 3 && ` +${refChars.length - 3}`}
          </div>
        )}
      </div>

      {text ? (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-200">
          {text}
        </p>
      ) : (
        <p className="text-[13px] italic text-stone-600">這段沒有敘事文字</p>
      )}
    </button>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Count panels whose description / srtSegment mentions the given name
 * (or any alias). Substring match — PR-D2 will replace with proper
 * @-token parsing.
 */
function countMentionsIn(
  panels: PanelLike[],
  name: string,
  aliases: string[] | null | undefined,
): number {
  const needles = [name, ...(aliases ?? [])].filter((n) => n && n.trim())
  if (needles.length === 0) return 0
  let count = 0
  for (const p of panels) {
    const haystack = `${p.description ?? ''} ${p.srtSegment ?? ''}`
    if (needles.some((n) => haystack.includes(n))) count += 1
  }
  return count
}

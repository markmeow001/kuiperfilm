'use client'

/**
 * /m/projects/:projectId/episodes/:episodeId — per-panel review.
 *
 * Vertical scroll feed of every panel in the episode. Each panel
 * card shows:
 *   - Panel index + shot type / camera move
 *   - Image (if generated) or placeholder
 *   - Video player with native mobile controls (if generated)
 *   - Description
 *   - Matched dialogue lines (speaker + content)
 *
 * Read-only. Tapping the video uses native HTML5 controls — fullscreen
 * playback handled by the browser/iOS, no custom player needed.
 *
 * The same /api/novel-promotion/:projectId/storyboards?episodeId=...
 * endpoint that v2 uses; we just project the response into a flat
 * panel list since mobile doesn't expose group/storyboard structure.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'

interface PanelLike {
  id: string
  panelIndex?: number
  imageUrl?: string | null
  videoUrl?: string | null
  description?: string | null
  shotType?: string | null
  cameraMove?: string | null
  multiShotGroupId?: string | null
}

interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

interface StoryboardsResponse {
  storyboards?: StoryboardLike[]
}

interface MatchedVoiceLine {
  id: string
  lineIndex: number
  speaker: string
  content: string
  matchedPanelId: string | null
  matchedPanelIndex: number | null
}

interface VoiceLinesResponse {
  voiceLines?: MatchedVoiceLine[]
}

export default function MobileEpisodeReviewPage() {
  const { status } = useSession()
  const router = useRouter()
  const params = useParams<{ locale: string; projectId: string; episodeId: string }>()
  const locale = params?.locale ?? 'zh'
  const projectId = params?.projectId ?? ''
  const episodeId = params?.episodeId ?? ''

  const [storyboards, setStoryboards] = useState<StoryboardsResponse | null>(null)
  const [voice, setVoice] = useState<VoiceLinesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/${locale}/m/auth/signin`)
    }
  }, [status, router, locale])

  useEffect(() => {
    if (status !== 'authenticated' || !projectId || !episodeId) return
    let alive = true
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [sbRes, vlRes] = await Promise.all([
          fetch(
            `/api/novel-promotion/${projectId}/storyboards?episodeId=${encodeURIComponent(episodeId)}`,
          ),
          fetch(
            `/api/novel-promotion/${projectId}/voice-lines?episodeId=${encodeURIComponent(episodeId)}`,
          ).catch(() => null),
        ])
        if (!sbRes.ok) throw new Error(`HTTP ${sbRes.status}`)
        const sb = (await sbRes.json()) as StoryboardsResponse
        if (alive) setStoryboards(sb)
        if (vlRes && vlRes.ok) {
          const vl = (await vlRes.json()) as VoiceLinesResponse
          if (alive) setVoice(vl)
        }
      } catch (err) {
        if (alive) setError((err as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [status, projectId, episodeId])

  const allPanels: PanelLike[] = useMemo(() => {
    return (storyboards?.storyboards ?? []).flatMap((sb) => sb.panels ?? [])
  }, [storyboards])

  const dialogueByPanelId: Map<string, MatchedVoiceLine[]> = useMemo(() => {
    const map = new Map<string, MatchedVoiceLine[]>()
    for (const line of voice?.voiceLines ?? []) {
      if (!line.matchedPanelId) continue
      const arr = map.get(line.matchedPanelId) ?? []
      arr.push(line)
      map.set(line.matchedPanelId, arr)
    }
    return map
  }, [voice])

  const counts = useMemo(() => {
    const total = allPanels.length
    const withImage = allPanels.filter((p) => p.imageUrl).length
    const withVideo = allPanels.filter((p) => p.videoUrl).length
    return { total, withImage, withVideo }
  }, [allPanels])

  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center">
        <div className="font-fraunces text-sm italic text-stone-500">載入中…</div>
      </main>
    )
  }
  if (status === 'unauthenticated') return null

  return (
    <main className="px-4 pb-20 pt-6">
      <header className="mb-6">
        <Link
          href={`/${locale}/m/projects/${projectId}`}
          className="font-mono text-[10px] tracking-[0.3em] text-stone-500 active:text-amber-500"
        >
          ← EPISODES
        </Link>
        <h1 className="mt-2 font-serif-cn text-2xl font-medium text-stone-100">
          集數 review
        </h1>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <Stat label="分鏡" value={counts.total} />
          <Stat label="已生圖" value={`${counts.withImage}/${counts.total}`} />
          <Stat label="已生片" value={`${counts.withVideo}/${counts.total}`} />
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-3 font-serif-cn text-sm text-rose-300">
          載入失敗：{error}
        </div>
      ) : null}

      {!error && allPanels.length === 0 ? (
        <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 px-4 py-8 text-center">
          <div className="font-fraunces text-base italic text-stone-500">
            還沒有分鏡
          </div>
        </div>
      ) : null}

      <ol className="space-y-4">
        {allPanels.map((panel, idx) => (
          <PanelCard
            key={panel.id}
            panel={panel}
            index={panel.panelIndex ?? idx + 1}
            dialogues={dialogueByPanelId.get(panel.id) ?? []}
            detailHref={`/${locale}/m/projects/${projectId}/episodes/${episodeId}/panels/${panel.id}`}
          />
        ))}
      </ol>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-sm border border-stone-800/60 bg-stone-900/40 px-2 py-1.5 text-center">
      <div className="font-mono text-[9px] tracking-wider text-stone-500">{label}</div>
      <div className="mt-0.5 font-serif-cn text-sm font-medium text-stone-100">{value}</div>
    </div>
  )
}

function PanelCard({
  panel,
  index,
  dialogues,
  detailHref,
}: {
  panel: PanelLike
  index: number
  dialogues: MatchedVoiceLine[]
  detailHref: string
}) {
  const indexStr = String(index).padStart(2, '0')
  const meta = [panel.shotType, panel.cameraMove].filter(Boolean).join(' · ')

  return (
    <li className="overflow-hidden rounded-sm border border-amber-900/20 bg-stone-900/50">
      {/* Media: video preferred, image fallback. Tap controls play
          inside the card; tapping the chrome below navigates to edit. */}
      <div className="relative aspect-video bg-stone-900">
        {panel.videoUrl ? (
          <video
            src={panel.videoUrl}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full bg-stone-950"
          />
        ) : panel.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={panel.imageUrl}
            alt={`Panel ${indexStr}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-fraunces text-sm italic text-stone-600">
            尚未生成
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-sm bg-stone-950/80 px-2 py-0.5 font-mono text-[10px] tracking-wider text-amber-300">
          PANEL {indexStr}
        </div>
        {panel.videoUrl ? (
          <div className="absolute right-3 top-3 rounded-sm bg-emerald-500/90 px-2 py-0.5 font-mono text-[9px] tracking-wider text-stone-950">
            ▶ VIDEO
          </div>
        ) : panel.imageUrl ? (
          <div className="absolute right-3 top-3 rounded-sm bg-amber-500/80 px-2 py-0.5 font-mono text-[9px] tracking-wider text-stone-950">
            IMAGE
          </div>
        ) : null}
      </div>

      <Link
        href={detailHref}
        className="block space-y-2 px-4 py-3 active:bg-stone-900/80"
      >
        {meta ? (
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-500/80">
            {meta}
          </div>
        ) : null}
        {panel.description ? (
          <div className="font-fraunces text-sm leading-relaxed text-stone-300">
            {panel.description}
          </div>
        ) : null}
        {dialogues.length > 0 ? (
          <div className="mt-2 space-y-1 rounded-sm border border-stone-800/60 bg-stone-950/40 px-3 py-2">
            {dialogues.map((d) => (
              <div key={d.id} className="font-serif-cn text-sm">
                <span className="text-amber-400">{d.speaker}：</span>
                <span className="text-stone-200">{d.content}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-end pt-1">
          <span className="font-mono text-[10px] tracking-wider text-stone-500">
            點此編輯 →
          </span>
        </div>
      </Link>
    </li>
  )
}

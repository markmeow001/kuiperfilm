'use client'

/**
 * /m/projects/:projectId — episode list for one project.
 *
 * Hits /api/novel-promotion/:projectId/episodes which already returns
 * each episode with a precomputed `progress` (script/storyboard/video
 * percentages) and `thumbnailUrl`. We render one card per episode
 * showing thumbnail + title + 3 progress bars + tap target into the
 * review surface.
 *
 * Read-only: no episode create / reorder / delete on mobile.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'

interface EpisodeProgress {
  script: number
  storyboard: number
  video: number
}

interface EpisodeListItem {
  id: string
  episodeNumber: number
  name: string | null
  description: string | null
  thumbnailUrl: string | null
  progress: EpisodeProgress
  updatedAt: string
}

interface EpisodesResponse {
  episodes: EpisodeListItem[]
  project?: { name?: string | null }
}

export default function MobileProjectEpisodesPage() {
  const { status } = useSession()
  const router = useRouter()
  const params = useParams<{ locale: string; projectId: string }>()
  const locale = params?.locale ?? 'zh'
  const projectId = params?.projectId ?? ''

  const [data, setData] = useState<EpisodesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/${locale}/m/auth/signin`)
    }
  }, [status, router, locale])

  useEffect(() => {
    if (status !== 'authenticated' || !projectId) return
    let alive = true
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/novel-promotion/${projectId}/episodes`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as EpisodesResponse
        if (alive) setData(json)
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
  }, [status, projectId])

  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center">
        <div className="font-fraunces text-sm italic text-stone-500">載入中…</div>
      </main>
    )
  }
  if (status === 'unauthenticated') return null

  const episodes = data?.episodes ?? []

  return (
    <main className="px-4 pb-20 pt-6">
      <header className="mb-6">
        <Link
          href={`/${locale}/m/projects`}
          className="font-mono text-[10px] tracking-[0.3em] text-stone-500 active:text-amber-500"
        >
          ← PROJECTS
        </Link>
        <h1 className="mt-2 font-serif-cn text-2xl font-medium text-stone-100">
          {data?.project?.name ?? '專案'}
        </h1>
        <div className="mt-1 font-fraunces text-xs italic text-stone-500">
          {episodes.length} episode{episodes.length === 1 ? '' : 's'}
        </div>
      </header>

      {error ? (
        <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-3 font-serif-cn text-sm text-rose-300">
          載入失敗：{error}
        </div>
      ) : null}

      {!error && episodes.length === 0 ? (
        <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 px-4 py-8 text-center">
          <div className="font-fraunces text-base italic text-stone-500">
            還沒有集數
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {episodes.map((ep) => (
          <li key={ep.id}>
            <Link
              href={`/${locale}/m/projects/${projectId}/episodes/${ep.id}`}
              className="block overflow-hidden rounded-sm border border-amber-900/20 bg-stone-900/50 active:bg-stone-900/80"
            >
              <div className="relative aspect-video bg-stone-900">
                {ep.thumbnailUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={ep.thumbnailUrl}
                    alt={ep.name ?? `EP ${ep.episodeNumber}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-fraunces text-sm italic text-stone-600">
                    no thumbnail
                  </div>
                )}
                <div className="absolute left-3 top-3 rounded-sm bg-stone-950/80 px-2 py-0.5 font-mono text-[10px] tracking-wider text-amber-300">
                  EP {String(ep.episodeNumber).padStart(2, '0')}
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="font-serif-cn text-base font-medium text-stone-100">
                  {ep.name ?? `第 ${ep.episodeNumber} 集`}
                </div>
                {ep.description ? (
                  <div className="mt-1 line-clamp-2 font-fraunces text-xs italic text-stone-400">
                    {ep.description}
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <ProgressPill label="劇本" value={ep.progress.script} />
                  <ProgressPill label="分鏡" value={ep.progress.storyboard} />
                  <ProgressPill label="影片" value={ep.progress.video} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

function ProgressPill({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const tone =
    pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-stone-700'
  return (
    <div className="rounded-sm border border-stone-800/60 bg-stone-950/40 px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-wider text-stone-500">
          {label}
        </span>
        <span className="font-mono text-[10px] text-stone-300">{pct}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-800">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

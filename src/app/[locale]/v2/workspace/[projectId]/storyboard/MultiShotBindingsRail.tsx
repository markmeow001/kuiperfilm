'use client'

/**
 * Stage 1 chip rail for the multi-shot B-path bindings.
 *
 * Given the most-recent multi-shot taskId for a group, this component
 * polls task.result.bindings via `useMultiShotTask` and renders a
 * Seedance-style chip strip showing which character appearance and
 * which scene view the worker actually anchored against (Tencent
 * SubjectInfos.N). Read-only in Stage 1 — Stage 2 will turn each
 * chip into an editable affordance that pushes overrides into the
 * next regenerate call.
 *
 * Empty / pre-completion states are intentionally muted so the rail
 * doesn't shout when the user hasn't done anything yet.
 */

import { AppIcon } from '@/components/ui/icons'
import {
  useMultiShotTask,
  type MultiShotCharacterBinding,
  type MultiShotSceneBinding,
} from '@/lib/query/hooks/useMultiShotTask'

interface MultiShotBindingsRailProps {
  taskId: string | null | undefined
  groupLabel?: string | null
  // The worker stores result.multiShotVideoUrl as a raw COS key
  // (not a signed URL), so the rail has to route playback through
  // /api/novel-promotion/{projectId}/video-proxy?key=... — the
  // route requires projectId for auth, hence this prop.
  projectId?: string
  // Optional human-friendly download filename (without extension).
  // Routed through the proxy as `&filename=...` so the response
  // emits Content-Disposition with a saner name than the URL
  // segment. Falls back to a `multi-shot-<taskHash>` slug.
  downloadFilenameBase?: string
  // commit 3 — when provided, chips become buttons that open the
  // appearance / view picker. Caller wires to the modals.
  onCharacterChipClick?: (binding: MultiShotCharacterBinding) => void
  onSceneChipClick?: (binding: MultiShotSceneBinding) => void
  // Highlight chips that have a pending override applied locally
  // (so the user can see "this will swap on next regen"). Keys are
  // characterId / locationId.
  characterOverrideAppearanceById?: Record<string, string | null>
  locationOverrideViewByLocationId?: Record<string, string | null>
}

/**
 * Worker returns the COS key untouched (e.g. "images/multi-shot-...")
 * — not a public URL. Rewrite it through the project's video-proxy
 * route so the browser can stream + the server enforces auth.
 *
 * If the value already looks like a full URL we leave it alone.
 *
 * `downloadFilenameBase` is appended as a `filename` query param so
 * the proxy emits Content-Disposition with the user-friendly name
 * (e.g. `ep1_group01.mp4`) instead of the URL segment "video-proxy".
 */
function resolveVideoSrc(
  raw: string | null | undefined,
  projectId: string | undefined,
  downloadFilenameBase?: string,
): string | null {
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (!projectId) return null
  const params = new URLSearchParams({ key: raw })
  if (downloadFilenameBase && downloadFilenameBase.trim().length > 0) {
    params.set('filename', downloadFilenameBase.trim())
  }
  return `/api/novel-promotion/${projectId}/video-proxy?${params.toString()}`
}

export function MultiShotBindingsRail({
  taskId,
  groupLabel,
  projectId,
  downloadFilenameBase,
  onCharacterChipClick,
  onSceneChipClick,
  characterOverrideAppearanceById,
  locationOverrideViewByLocationId,
}: MultiShotBindingsRailProps) {
  const { data, isLoading } = useMultiShotTask(taskId)

  if (!taskId) return null

  const status = data?.status ?? null
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled'
  const bindings = data?.result?.bindings ?? null
  const rawVideoKey = data?.result?.multiShotVideoUrl ?? null
  const videoUrl = resolveVideoSrc(rawVideoKey, projectId, downloadFilenameBase)
  const shotCount = data?.result?.shotCount ?? null
  const characters = bindings?.characters ?? []
  const scenes = bindings?.scenes ?? []
  const hasContent = characters.length > 0 || scenes.length > 0

  return (
    <div className="rounded-sm border border-amber-900/15 bg-stone-900/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-amber-500/70">
          <AppIcon name="sparklesAlt" className="h-3 w-3" />
          多鏡頭綁定
          {groupLabel ? (
            <span className="text-stone-500">· {groupLabel}</span>
          ) : null}
        </div>
        <div className="font-mono text-[9px] tracking-wider">
          {status === 'completed' ? (
            <span className="text-emerald-400/80">已完成</span>
          ) : status === 'failed' ? (
            <span className="text-rose-400/80">失敗</span>
          ) : status === 'queued' || status === 'processing' ? (
            <span className="animate-pulse text-amber-400/80">生成中</span>
          ) : isLoading ? (
            <span className="text-stone-500">載入中</span>
          ) : (
            <span className="text-stone-500">—</span>
          )}
        </div>
      </div>

      {!isTerminal && !hasContent && !videoUrl ? (
        <div className="font-serif-cn text-[11px] italic text-stone-500">
          多鏡頭視頻生成中(約 3-5 分鐘) — 完成後會顯示視頻播放器與綁定的角色造型 / 場景視角。
        </div>
      ) : null}

      {status === 'failed' ? (() => {
        const rawMsg = data?.error?.message || data?.errorMessage || ''
        const isRateLimit = /70000|requestlimitexceeded|maximum concurrency/i.test(rawMsg)
        return (
          <div className="rounded-sm border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-serif-cn text-[11px] text-rose-300">
            {isRateLimit ? (
              <>
                <strong className="text-rose-200">Tencent VOD 並發上限被打到</strong>
                <div className="mt-0.5 text-[10px] text-rose-300/80">
                  你的 Tencent 帳號同時跑的視頻任務太多。建議:
                  <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                    <li>等 30-60 秒後點上方「重新生成」</li>
                    <li>不要一次送多個 group(改成一次跑一組)</li>
                    <li>長期解法:聯絡 Tencent 提高並發配額</li>
                  </ul>
                </div>
              </>
            ) : (
              rawMsg || '視頻生成失敗 — 重試後綁定才會更新'
            )}
          </div>
        )
      })() : null}

      {videoUrl ? (
        <div className="mx-auto mb-2.5 w-full max-w-[260px] overflow-hidden rounded-sm border border-amber-900/20 bg-stone-950">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            playsInline
            // Cap height so 9:16 doesn't blow up the segment card —
            // user reported the player taking up the whole screen.
            // 420px keeps it readable on a 13" laptop without
            // forcing the narrative pane out of the fold.
            className="mx-auto block h-auto max-h-[420px] w-full object-contain"
          />
          <div className="flex items-center justify-between border-t border-amber-900/20 bg-stone-900/40 px-2 py-1">
            <div className="font-mono text-[9px] tracking-wider text-amber-500/70">
              MULTI-SHOT {shotCount ? `· ${shotCount} 鏡` : ''}
            </div>
            <a
              href={videoUrl}
              // Don't override the proxy's Content-Disposition with
              // the `download` attribute — when the response sets
              // its own filename, the browser respects that. Empty
              // string still triggers the download flow.
              download=""
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9px] tracking-wider text-stone-400 transition-colors hover:text-amber-400"
            >
              下載
            </a>
          </div>
        </div>
      ) : null}

      {hasContent ? (
        <div className="space-y-2">
          {characters.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-stone-500">
                Cast · {characters.length}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {characters.map((c) => {
                  const overrideAppearanceId = characterOverrideAppearanceById?.[c.id]
                  const hasOverride = overrideAppearanceId !== undefined
                    && overrideAppearanceId !== c.appearanceId
                  const baseClass =
                    'inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2'
                  const stateClass = hasOverride
                    ? 'border-violet-500/60 bg-violet-500/10'
                    : 'border-amber-900/30 bg-stone-950/40'
                  const interactive = onCharacterChipClick
                    ? `${baseClass} ${stateClass} cursor-pointer transition-colors hover:border-amber-500/60 hover:bg-amber-500/10`
                    : `${baseClass} ${stateClass}`
                  const title = hasOverride
                    ? `${c.name} — 下次重生會改用新造型(尚未送出)`
                    : `${c.name} · ${c.appearanceLabel ?? '默認造型'}${onCharacterChipClick ? ' — 點擊換造型' : ''}`
                  if (onCharacterChipClick) {
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onCharacterChipClick(c)}
                        className={interactive}
                        title={title}
                      >
                        <div className="relative h-5 w-5 overflow-hidden rounded-full bg-stone-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.imageUrl} alt={c.name} className="h-full w-full object-cover" />
                        </div>
                        <span className="font-serif-cn text-[10px] text-stone-200">{c.name}</span>
                        <span className="font-mono text-[9px] tracking-wider text-amber-500/70">
                          {c.appearanceLabel ?? '默認造型'}
                        </span>
                        {hasOverride ? (
                          <span className="font-mono text-[9px] tracking-wider text-violet-300">
                            ✏ 已改
                          </span>
                        ) : null}
                      </button>
                    )
                  }
                  return (
                    <div key={c.id} className={interactive} title={title}>
                      <div className="relative h-5 w-5 overflow-hidden rounded-full bg-stone-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.imageUrl} alt={c.name} className="h-full w-full object-cover" />
                      </div>
                      <span className="font-serif-cn text-[10px] text-stone-200">{c.name}</span>
                      <span className="font-mono text-[9px] tracking-wider text-amber-500/70">
                        {c.appearanceLabel ?? '默認造型'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {scenes.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-stone-500">
                Scenes · {scenes.length}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scenes.map((s) => {
                  const overrideView = locationOverrideViewByLocationId?.[s.id]
                  const hasOverride = overrideView !== undefined && overrideView !== s.viewName
                  const baseClass =
                    'inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2'
                  const stateClass = hasOverride
                    ? 'border-violet-500/60 bg-violet-500/10'
                    : 'border-amber-900/30 bg-stone-950/40'
                  const interactive = onSceneChipClick
                    ? `${baseClass} ${stateClass} cursor-pointer transition-colors hover:border-amber-500/60 hover:bg-amber-500/10`
                    : `${baseClass} ${stateClass}`
                  const title = hasOverride
                    ? `${s.name} — 下次重生會改用新視角(尚未送出)`
                    : `${s.name} · ${s.viewName ?? '主視角'}${onSceneChipClick ? ' — 點擊換視角' : ''}`
                  if (onSceneChipClick) {
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onSceneChipClick(s)}
                        className={interactive}
                        title={title}
                      >
                        <div className="relative h-5 w-8 overflow-hidden rounded-sm bg-stone-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" />
                        </div>
                        <span className="font-serif-cn text-[10px] text-stone-200">{s.name}</span>
                        <span className="font-mono text-[9px] tracking-wider text-amber-500/70">
                          {s.viewName ?? '主視角'}
                        </span>
                        {hasOverride ? (
                          <span className="font-mono text-[9px] tracking-wider text-violet-300">
                            ✏ 已改
                          </span>
                        ) : null}
                      </button>
                    )
                  }
                  return (
                    <div key={s.id} className={interactive} title={title}>
                      <div className="relative h-5 w-8 overflow-hidden rounded-sm bg-stone-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" />
                      </div>
                      <span className="font-serif-cn text-[10px] text-stone-200">{s.name}</span>
                      <span className="font-mono text-[9px] tracking-wider text-amber-500/70">
                        {s.viewName ?? '主視角'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

'use client'

/**
 * Chip rail for the multi-shot B-path bindings (Stage 1 + Stage 2).
 *
 * Given the most-recent multi-shot taskId for a group, this component
 * polls task.result.bindings via `useMultiShotTask` and renders a
 * Seedance-style chip strip showing which character appearance and
 * which scene view the worker actually anchored against (Tencent
 * SubjectInfos.N).
 *
 * Stage 1 (default, no callbacks): read-only chips — show what's bound.
 * Stage 2 (caller supplies `onCharacterChipClick` / `onSceneChipClick`):
 *   chips become buttons that open the appearance / view picker;
 *   pending overrides render with the violet "✏ 已改" treatment so the
 *   user sees what will swap on next regenerate. The caller owns the
 *   override map state (characterOverrides / locationOverrides) and
 *   forwards it through `characterOverrideAppearanceById` /
 *   `locationOverrideViewByLocationId`.
 *
 * Empty / pre-completion states are intentionally muted so the rail
 * doesn't shout when the user hasn't done anything yet.
 */

import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  useMultiShotTask,
  type MultiShotCharacterBinding,
  type MultiShotSceneBinding,
  type MultiShotTaskRecord,
} from '@/lib/query/hooks/useMultiShotTask'
import { resolveErrorDisplay } from '@/lib/errors/display'

/**
 * Heuristic stage label derived from progress percentage. Avoids the
 * cost of a second API call (lifecycle events) — the band ranges match
 * the worker's reportTaskProgress calls in
 * multi-shot-video-{seedance,b}-path.ts.
 */
function progressStageLabel(progress: number, taskType: string | null): string {
  // Seedance composite stage bands per
  // multi-shot-video-seedance-path.ts:
  //   5 received → 12 collect_refs → 15 start → 20 submit → 40 poll
  //   → 40-90 polling_external (interpolated) → 92 persist → 98 done
  if (taskType === 'video_multi_shot' || taskType === 'multi_shot_video') {
    if (progress < 10) return '排隊中…'
    if (progress < 18) return '收集角色/場景參考…'
    if (progress < 35) return '送出 AI 模型…'
    if (progress < 85) return 'AI 生成中…'
    if (progress < 95) return '下載並上傳影片…'
    if (progress < 100) return '即將完成…'
    return '完成'
  }
  // Generic fallback.
  if (progress < 10) return '排隊中…'
  if (progress < 35) return '送出中…'
  if (progress < 85) return '生成中…'
  if (progress < 100) return '收尾中…'
  return '完成'
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Average runtime baselines per worker — used to compute the ETA hint
 * shown next to the progress bar. Numbers come from observed prod runs:
 *   - Seedance composite (taijiai): 5-9 min (BobAPI sometimes queues
 *     under load; pick the upper bound so the ETA doesn't lie when
 *     things are slow).
 *   - Kling B-path: 3-5 min typical, sometimes 8.
 * We use the upper bound so users aren't surprised when it runs long.
 */
const TASK_ETA_MS: Record<string, number> = {
  video_multi_shot: 9 * 60 * 1000,
  multi_shot_video: 9 * 60 * 1000,
}

function MultiShotProgressBar({ task }: { task: MultiShotTaskRecord }) {
  // Re-render once a second so elapsed / ETA tick without waiting on
  // the 3s task poll. Only mounts while non-terminal so the timer
  // unsubscribes as soon as the run completes.
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const startTs = task.startedAt
    ? Date.parse(task.startedAt)
    : task.createdAt
      ? Date.parse(task.createdAt)
      : NaN
  const elapsedMs = Number.isFinite(startTs) ? Date.now() - startTs : 0
  const progress = typeof task.progress === 'number'
    ? Math.max(0, Math.min(100, task.progress))
    : 0
  const stage = progressStageLabel(progress, task.type ?? null)
  const baselineEta = task.type ? TASK_ETA_MS[task.type] : undefined
  // ETA = max(0, baseline - elapsed). Progress is interpolated server-
  // side so it's a noisy estimator; baseline-minus-elapsed is more
  // honest because it doesn't bounce when the progress band changes.
  const etaMs = baselineEta ? Math.max(0, baselineEta - elapsedMs) : null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-mono text-[11px] tracking-wider">
        <span className="text-amber-400/90">{stage}</span>
        <span className="text-stone-500">
          {formatElapsed(elapsedMs)}
          {etaMs !== null && etaMs > 0 ? ` · 預計 ~${formatElapsed(etaMs)}` : ''}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-800/80">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-700 ease-out"
          style={{ width: `${Math.max(progress, 2)}%` }}
        />
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] tracking-wider text-stone-500">
        <span>進度 {progress}%</span>
        <span className="italic">不必停在此頁,完成後會自動刷新</span>
      </div>
    </div>
  )
}

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
  // When true the rail skips rendering its own Cast chip section so
  // the host (e.g. GroupCard) can place the bound-characters list
  // somewhere else (currently: below the Scene chip strip in the
  // right column). Scenes stay inside the rail because they pair
  // visually with the player on the left.
  hideCastSection?: boolean
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

/**
 * Thumbnail video player with an explicit fullscreen overlay button.
 *
 * The native <video controls> shipped the fullscreen control behind the
 * "⋮" overflow menu, which most users never expanded — they assumed the
 * clip was preview-only. 2026-05-21: surfaced as a top-right overlay
 * button that calls requestFullscreen() (with iOS Safari's
 * webkitEnterFullscreen() fallback that puts the <video> itself into
 * the native iOS player). Click bubble stops at the button so it
 * doesn't toggle play/pause on the underlying video.
 */
function ClipPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  function handleFullscreenClick(e: React.MouseEvent) {
    e.stopPropagation()
    const el = videoRef.current
    if (!el) return
    // iOS Safari: <video>.webkitEnterFullscreen() drops the user into
    // the native player. Other browsers: requestFullscreen on the
    // <video> itself so the controls stay native + we don't have to
    // own the player chrome.
    type FullscreenVideo = HTMLVideoElement & {
      webkitEnterFullscreen?: () => void
      webkitRequestFullscreen?: () => Promise<void>
    }
    const fsEl = el as FullscreenVideo
    if (typeof fsEl.webkitEnterFullscreen === 'function') {
      fsEl.webkitEnterFullscreen()
    } else if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => {
        // Fullscreen rejected (user gesture lost / Permissions-Policy
        // block). No user-facing surface — they can fall back to the
        // native ⋮ menu. Silent.
      })
    } else if (typeof fsEl.webkitRequestFullscreen === 'function') {
      void fsEl.webkitRequestFullscreen()
    }
  }

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        // 9:16 reference player. Sized as a thumbnail-with-controls,
        // not a primary viewing surface — the rail is for confirming
        // the cut, not for watching it.
        className="mx-auto block h-auto max-h-[320px] w-full object-contain"
      />
      <button
        type="button"
        onClick={handleFullscreenClick}
        title="全螢幕播放"
        aria-label="全螢幕播放"
        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-sm border border-stone-700/60 bg-stone-950/70 text-stone-300 backdrop-blur-sm transition-colors hover:border-amber-500/60 hover:bg-stone-900/90 hover:text-amber-400"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Maximize corners (lucide-react Maximize2 shape inlined to
              avoid adding a new icon to the registry for one use site). */}
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>
  )
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
  hideCastSection,
}: MultiShotBindingsRailProps) {
  const { data, isLoading } = useMultiShotTask(taskId)

  if (!taskId) return null

  const status = data?.status ?? null
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled'
  const bindings = data?.result?.bindings ?? null
  // 2026-05-03 — long-dialogue groups produce N clips. Prefer the
  // array; fall back to wrapping the legacy single URL.
  const rawClipKeys: string[] = (() => {
    const arr = data?.result?.multiShotClipUrls
    if (Array.isArray(arr) && arr.length > 0) return arr
    const legacy = data?.result?.multiShotVideoUrl
    return legacy ? [legacy] : []
  })()
  const clipUrls: string[] = rawClipKeys
    .map((key, i) =>
      resolveVideoSrc(
        key,
        projectId,
        rawClipKeys.length > 1 && downloadFilenameBase
          ? `${downloadFilenameBase}_clip${i + 1}`
          : downloadFilenameBase,
      ),
    )
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  const isChunked = clipUrls.length > 1
  const shotCount = data?.result?.shotCount ?? null
  const characters = bindings?.characters ?? []
  const scenes = bindings?.scenes ?? []
  const showCastBlock = !hideCastSection && characters.length > 0
  const hasContent = showCastBlock || scenes.length > 0

  return (
    <div className="rounded-sm border border-amber-900/15 bg-stone-900/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
          <AppIcon name="sparklesAlt" className="h-3 w-3" />
          多鏡頭綁定
          {groupLabel ? (
            <span className="text-stone-500">· {groupLabel}</span>
          ) : null}
        </div>
        <div className="font-mono text-[12px] tracking-wider">
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

      {!isTerminal && !hasContent && clipUrls.length === 0 ? (
        <div className="space-y-2">
          {data ? <MultiShotProgressBar task={data} /> : null}
          <div className="font-serif-cn text-[11px] italic text-stone-500">
            完成後會顯示視頻播放器與綁定的角色造型 / 場景視角。
          </div>
        </div>
      ) : null}

      {status === 'failed' ? (() => {
        const rawMsg = data?.error?.message || data?.errorMessage || ''
        const rawCode = data?.error?.code || ''
        const isRateLimit = /70000|requestlimitexceeded|maximum concurrency/i.test(rawMsg)
        const isOrphaned = /queue job (already terminated|missing).*db/i.test(rawMsg)
          || /queue job missing.*restart/i.test(rawMsg)
        // Provider content-moderation rejection (Seedance / AtlasCloud).
        // Exclude "case-sensitive" so it doesn't false-match. The audio
        // sub-case ("output audio may contain sensitive information") gets
        // a specific, actionable hint: turn off 音頻.
        const isSensitive = rawCode === 'SENSITIVE_CONTENT'
          || (/sensitive|敏感|moderation|prohibited|nsfw|违规|不当/i.test(rawMsg)
              && !/case[- ]?sensitive/i.test(rawMsg))
        const isAudioSensitive = isSensitive && /audio|音[訊频]/i.test(rawMsg)
        // Friendly fallback for anything else — route through the central
        // resolver so users never see raw provider JSON. Raw stays in the
        // title tooltip for ops debugging.
        const friendlyFallback =
          resolveErrorDisplay({ code: rawCode || null, message: rawMsg || null })?.message
          || '視頻生成失敗 — 重試後綁定才會更新'
        return (
          <div className="rounded-sm border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-serif-cn text-[11px] text-rose-300">
            {isRateLimit ? (
              <>
                <strong className="text-rose-200">Tencent VOD 並發上限被打到</strong>
                <div className="mt-0.5 text-[14px] text-rose-300/80">
                  你的 Tencent 帳號同時跑的視頻任務太多。建議:
                  <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                    <li>等 30-60 秒後點上方「重新生成」</li>
                    <li>不要一次送多個 group(改成一次跑一組)</li>
                    <li>長期解法:聯絡 Tencent 提高並發配額</li>
                  </ul>
                </div>
              </>
            ) : isOrphaned ? (
              <>
                <strong className="text-rose-200">任務被中斷(可能是部署期間)</strong>
                <div className="mt-0.5 text-[14px] text-rose-300/80">
                  這個任務原本在跑,但因為 server restart 被中止。系統自動清掉了 zombie task。
                  <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                    <li>點上方「重新生成」就會送新 task</li>
                    <li>(剛剛我們 deploy 了新版本,所以中斷了正在跑的任務)</li>
                  </ul>
                </div>
              </>
            ) : isAudioSensitive ? (
              <>
                <strong className="text-rose-200">影片被供應商內容審核擋下（音訊）</strong>
                <div className="mt-0.5 text-[14px] text-rose-300/80">
                  Seedance 2.0 會配原生音訊,AtlasCloud 判定這次生成的「音訊」可能含敏感內容而擋下
                  (與你的畫面 / 描述無關,常是誤判)。建議:
                  <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                    <li>把上方「音頻」關掉再「重新生成」(此鏡若無對白,關了不影響)</li>
                    <li>或微調敘事內容後重試</li>
                  </ul>
                </div>
              </>
            ) : isSensitive ? (
              <>
                <strong className="text-rose-200">內容被供應商審核擋下</strong>
                <div className="mt-0.5 text-[14px] text-rose-300/80">
                  這次生成被 AtlasCloud / Seedance 內容審核判定可能含敏感資訊。
                  請調整敘事 / 角色 / 場景內容後重新生成。
                </div>
              </>
            ) : (
              <span title={rawMsg || undefined}>{friendlyFallback}</span>
            )}
          </div>
        )
      })() : null}

      {clipUrls.length > 0 ? (
        <div className="mx-auto mb-2.5 w-full max-w-[180px] space-y-2">
          {clipUrls.map((url, i) => (
            <div
              key={url}
              className="overflow-hidden rounded-sm border border-amber-900/20 bg-stone-950"
            >
              <ClipPlayer url={url} />
              <div className="flex items-center justify-between border-t border-amber-900/20 bg-stone-900/40 px-2 py-1">
                <div className="font-mono text-[12px] tracking-wider text-amber-500/70">
                  {isChunked ? (
                    <>CLIP {i + 1}/{clipUrls.length}</>
                  ) : (
                    <>MULTI-SHOT {shotCount ? `· ${shotCount} 鏡` : ''}</>
                  )}
                </div>
                <a
                  href={url}
                  // Don't override the proxy's Content-Disposition with
                  // the `download` attribute — when the response sets
                  // its own filename, the browser respects that.
                  download=""
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[12px] tracking-wider text-stone-400 transition-colors hover:text-amber-400"
                >
                  下載
                </a>
              </div>
            </div>
          ))}
          {isChunked ? (
            <div className="mt-1.5 rounded-sm border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 font-mono text-[10px] leading-relaxed tracking-wider text-amber-300/80">
              對白超過 15s，已拆成 {clipUrls.length} 段。下載後可在剪映 / CapCut 順序拼接。
            </div>
          ) : null}
        </div>
      ) : null}

      {hasContent ? (
        <div className="space-y-2">
          {showCastBlock ? (
            <div>
              <div className="mb-1 font-mono text-[12px] uppercase tracking-wider text-stone-500">
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
                        <span className="font-serif-cn text-[14px] text-stone-200">{c.name}</span>
                        <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                          {c.appearanceLabel ?? '默認造型'}
                        </span>
                        {hasOverride ? (
                          <span className="font-mono text-[12px] tracking-wider text-violet-300">
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
                      <span className="font-serif-cn text-[14px] text-stone-200">{c.name}</span>
                      <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
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
              <div className="mb-1 font-mono text-[12px] uppercase tracking-wider text-stone-500">
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
                        <span className="font-serif-cn text-[14px] text-stone-200">{s.name}</span>
                        <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                          {s.viewName ?? '主視角'}
                        </span>
                        {hasOverride ? (
                          <span className="font-mono text-[12px] tracking-wider text-violet-300">
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
                      <span className="font-serif-cn text-[14px] text-stone-200">{s.name}</span>
                      <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
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

'use client'

/**
 * Phase T-1 (2026-05-27) — V2 Playground / Freedom Mode client.
 *
 * Variant A "fal-faithful" layout (approved 2026-05-27, user comment:
 * "中規中矩, 大部分使用者能很快上手"):
 *   - Top tab strip
 *   - 50/50 split: input (left) / output (right)
 *   - Bottom toolbar with model picker + cost estimate + RUN button
 *
 * T-1 scope (image-only):
 *   - Prompt textarea
 *   - Reference images grid (up to 9, multipart upload to /api/playground/upload-reference)
 *   - Reference video slot (capped at 1 per ARK lowest common denominator; see
 *     feedback_kuiperfilm_ref_video_lowest_common_denominator memory)
 *   - Reference text input
 *   - Output preview (large <img> when result lands)
 *   - Model picker (filtered to image-only models from useUserModels)
 *   - Aspect ratio dropdown
 *   - Run history rail (top-right, scrollable, last 20)
 *
 * Not in T-1 (deferred to T-2/T-3):
 *   - @imageN inline chip tokens in textarea (placeholder for now — just text)
 *   - Video output (returns VIDEO_NOT_YET_SUPPORTED from API)
 *   - "You can also try with..." model swap chip strip
 *   - Cost estimate (TODO once image pricing table is plumbed)
 */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useUserModels, type UserModelOption } from '@/lib/query/hooks/useUserModels'
import {
  useUploadPlaygroundReference,
  useSubmitPlaygroundRun,
  usePlaygroundRuns,
  type PlaygroundRunRow,
} from '@/lib/query/mutations/playground-mutations'

interface V2PlaygroundClientProps {
  locale: string
}

const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: '9:16 直屏' },
  { value: '16:9', label: '16:9 橫屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3 經典' },
  { value: '3:4', label: '3:4 直幅' },
  { value: '4:5', label: '4:5 IG' },
]

const MAX_REF_IMAGES = 9
const MAX_REF_VIDEOS = 1 // ARK parity — see Phase S decision memory

export function V2PlaygroundClient({ locale }: V2PlaygroundClientProps) {
  const userModelsQuery = useUserModels()
  const upload = useUploadPlaygroundReference()
  const submit = useSubmitPlaygroundRun()
  const runsQuery = usePlaygroundRuns(null)

  // Form state
  const [prompt, setPrompt] = useState('')
  const [refText, setRefText] = useState('')
  const [refImages, setRefImages] = useState<Array<{ key: string; signedUrl: string }>>([])
  const [refVideo, setRefVideo] = useState<{ key: string; signedUrl: string } | null>(null)
  const [outputType, _setOutputType] = useState<'image' | 'video'>('image') // T-1: locked to image
  const [modelKey, setModelKey] = useState<string>('')
  const [aspectRatio, setAspectRatio] = useState('9:16')

  // Output state
  const [latestRun, setLatestRun] = useState<PlaygroundRunRow | null>(null)

  // File picker refs
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)

  // Build the image-only model list. Image models from useUserModels (admin-enabled).
  const imageModels = useMemo<UserModelOption[]>(() => {
    return userModelsQuery.data?.image ?? []
  }, [userModelsQuery.data])

  // Default to the first model when payload arrives.
  useEffect(() => {
    if (modelKey || imageModels.length === 0) return
    setModelKey(imageModels[0].value)
  }, [imageModels, modelKey])

  // ── Handlers ──────────────────────────────────────────────────────

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (refImages.length >= MAX_REF_IMAGES) {
      alert(`參考圖最多 ${MAX_REF_IMAGES} 張`)
      return
    }
    try {
      const result = await upload.mutateAsync({ file, type: 'image' })
      setRefImages((prev) => [...prev, { key: result.key, signedUrl: result.signedUrl }])
    } catch (err) {
      alert(`圖片上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
    }
  }

  async function handleVideoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (refVideo) {
      alert('參考影片只能 1 支（ARK 上限對齊）。請先移除再上傳新的。')
      return
    }
    try {
      const result = await upload.mutateAsync({ file, type: 'video' })
      setRefVideo({ key: result.key, signedUrl: result.signedUrl })
    } catch (err) {
      alert(`影片上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
    }
  }

  function removeRefImage(idx: number) {
    setRefImages((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeRefVideo() {
    setRefVideo(null)
  }

  async function handleRun() {
    if (!prompt.trim()) {
      alert('請先輸入提示詞')
      return
    }
    if (!modelKey) {
      alert('請先選擇模型')
      return
    }
    try {
      const result = await submit.mutateAsync({
        prompt: prompt.trim(),
        referenceImages: refImages.map((r) => r.key),
        referenceVideos: refVideo ? [refVideo.key] : [],
        referenceText: refText.trim() || undefined,
        outputType,
        modelKey,
        aspectRatio,
      })
      // Latest run goes to the preview area.
      setLatestRun({
        id: result.run.id,
        prompt: prompt.trim(),
        outputType: result.run.outputType as 'image' | 'video',
        modelKey: result.run.modelKey,
        status: result.run.status as PlaygroundRunRow['status'],
        resultUrls: [result.run.resultUrl],
        errorMessage: null,
        createdAt: result.run.createdAt,
        completedAt: result.run.completedAt,
      })
    } catch (err) {
      alert(`生成失敗:${(err as Error)?.message ?? '未知錯誤'}`)
    }
  }

  function handlePickHistoryRun(run: PlaygroundRunRow) {
    setLatestRun(run)
  }

  const isBusy = upload.isPending || submit.isPending

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-stone-950 text-stone-300">
      {/* TOP — tab strip + brand */}
      <header className="flex items-center justify-between border-b border-stone-800 px-8 py-3">
        <div className="flex items-center gap-6">
          <Link
            href={`/${locale}/v2`}
            className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500 hover:text-amber-400"
          >
            <AppIcon name="chevronLeft" className="h-3 w-3" />
            回到專案
          </Link>
          <div className="font-display text-xl font-semibold italic text-amber-400">
            KuiperAI · Playground
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-600">
            Freedom Mode · T-1
          </div>
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider">
          <span className="rounded-sm border-b-2 border-amber-500 bg-stone-900 px-3 py-1.5 text-amber-400">
            體驗
          </span>
          <span className="px-3 py-1.5 text-stone-600">API</span>
          <span className="px-3 py-1.5 text-stone-600">範例</span>
        </div>
      </header>

      {/* BODY — 50/50 split */}
      <div className="grid flex-1 grid-cols-2 overflow-hidden">
        {/* ─── LEFT: input ─── */}
        <div className="flex flex-col overflow-y-auto border-r border-stone-800 p-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-mono text-[12px] uppercase tracking-wider text-stone-500">輸入</div>
          </div>

          {/* Prompt */}
          <div className="mb-5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="描述你想生成的畫面... 譬如「賽博龐克城市夜景, 巨型廣告牌特寫, 雨夜霓虹倒映」"
              className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/40 p-3 text-[14px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40"
            />
          </div>

          {/* Reference images grid */}
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between font-mono text-[12px] uppercase tracking-wider">
              <span className="text-stone-500">
                參考圖片 <span className="text-violet-400">({refImages.length}/{MAX_REF_IMAGES})</span>
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {/* Upload slot */}
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isBusy || refImages.length >= MAX_REF_IMAGES}
                className="aspect-square rounded-sm border border-dashed border-stone-700 text-xl text-stone-500 transition-all hover:border-violet-500/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ＋
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleImagePick}
              />
              {/* Existing refs */}
              {refImages.map((ref, idx) => (
                <div
                  key={ref.key}
                  className="group relative aspect-square overflow-hidden rounded-sm border border-violet-500/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.signedUrl} alt={`ref ${idx + 1}`} className="h-full w-full object-cover" />
                  <div className="absolute left-1 top-1 rounded-sm bg-stone-950/80 px-1 font-mono text-[10px] text-amber-300">
                    {idx + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRefImage(idx)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-sm bg-stone-950/80 text-stone-300 opacity-0 transition-opacity hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
              {/* Empty slot placeholders */}
              {Array.from({ length: Math.max(0, MAX_REF_IMAGES - refImages.length - 1) }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square rounded-sm border border-dashed border-stone-800/60"></div>
              ))}
            </div>
            <div className="mt-1 text-right font-mono text-[10px] text-stone-600">
              MAX:{MAX_REF_IMAGES} · jpg/png/webp · ≤10MB
            </div>
          </div>

          {/* Reference video */}
          <div className="mb-5">
            <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-stone-500">
              參考影片 <span className="text-violet-400">({refVideo ? 1 : 0}/{MAX_REF_VIDEOS})</span>
            </div>
            {refVideo ? (
              <div className="flex items-center gap-3 rounded-sm border border-violet-500/30 bg-violet-500/5 p-2">
                <video
                  src={refVideo.signedUrl}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  className="h-16 w-28 rounded-sm object-cover"
                />
                <div className="flex-1 font-mono text-[11px] uppercase tracking-wider text-violet-300">
                  動作參考已綁
                </div>
                <button
                  type="button"
                  onClick={removeRefVideo}
                  disabled={isBusy}
                  className="rounded-sm border border-stone-700 px-2 py-1 font-mono text-[11px] text-stone-400 hover:border-rose-500/60 hover:text-rose-300"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={isBusy}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-stone-700 bg-stone-900/30 p-6 text-stone-500 transition-all hover:border-violet-500/40 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon name="upload" className="h-6 w-6" />
                <div className="text-[12px]">可拖曳檔案至此，或點擊上傳</div>
                <div className="font-mono text-[10px] text-stone-600">mp4/mov/webm · ≤50MB · 建議 ≤15s</div>
              </button>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={handleVideoPick}
            />
          </div>

          {/* Reference text */}
          <div className="mb-2">
            <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-stone-500">
              參考文字 <span className="text-stone-600">(選填)</span>
            </div>
            <input
              type="text"
              value={refText}
              onChange={(e) => setRefText(e.target.value)}
              placeholder="風格 / 旁白 / 隱喻 等補充..."
              className="w-full rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-2 text-[13px] text-stone-300 placeholder:text-stone-600 outline-none focus:border-amber-500/40"
            />
          </div>
        </div>

        {/* ─── RIGHT: output + history ─── */}
        <div className="flex flex-col overflow-y-auto p-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="font-mono text-[12px] uppercase tracking-wider text-stone-500">輸出</div>
              <div className="font-mono text-[11px] text-stone-600">
                {submit.isPending ? '生成中…' : latestRun ? latestRun.status : '閒置'}
              </div>
            </div>
            {latestRun?.resultUrls?.[0] ? (
              <a
                href={latestRun.resultUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm border border-stone-700 px-2 py-1 font-mono text-[11px] uppercase text-stone-400 hover:border-amber-500/60 hover:text-amber-300"
                download
              >
                ↓ 下載
              </a>
            ) : null}
          </div>

          {/* Preview */}
          <div
            className="relative mb-3 overflow-hidden rounded-sm border border-stone-800 bg-stone-900/40"
            style={{ aspectRatio: aspectRatio.replace(':', ' / ') }}
          >
            {submit.isPending ? (
              <div className="flex h-full w-full items-center justify-center text-stone-500">
                <div className="flex items-center gap-3">
                  <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-amber-400" />
                  <div className="font-mono text-[12px] uppercase tracking-wider">生成中…</div>
                </div>
              </div>
            ) : latestRun?.status === 'failed' ? (
              <div className="flex h-full w-full items-center justify-center p-8 text-center">
                <div>
                  <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-rose-400">生成失敗</div>
                  <div className="font-mono text-[11px] text-stone-500">{latestRun.errorMessage ?? '未知錯誤'}</div>
                </div>
              </div>
            ) : latestRun?.resultUrls?.[0] ? (
              latestRun.outputType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={latestRun.resultUrls[0]} alt="output" className="h-full w-full object-contain" />
              ) : (
                <video src={latestRun.resultUrls[0]} controls playsInline className="h-full w-full object-contain" />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-stone-600">
                <div className="text-center">
                  <AppIcon name="image" className="mx-auto h-12 w-12 opacity-30" />
                  <div className="mt-3 font-mono text-[11px] uppercase tracking-wider">尚未生成 · 比例 {aspectRatio}</div>
                </div>
              </div>
            )}
          </div>

          {/* History rail */}
          <div className="mt-2">
            <div className="mb-2 flex items-center justify-between font-mono text-[12px] uppercase tracking-wider">
              <span className="text-stone-500">最近生成 ({runsQuery.data?.runs?.length ?? 0})</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {(runsQuery.data?.runs ?? []).slice(0, 12).map((run) => (
                <button
                  type="button"
                  key={run.id}
                  onClick={() => handlePickHistoryRun(run)}
                  title={run.prompt.slice(0, 80)}
                  className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-sm border bg-stone-900 transition-all ${
                    latestRun?.id === run.id ? 'border-amber-500/60' : 'border-stone-800 hover:border-violet-500/40'
                  }`}
                >
                  {run.resultUrls?.[0] && run.outputType === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={run.resultUrls[0]} alt="history" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-stone-500">
                      {run.status === 'failed' ? '✕' : run.outputType === 'video' ? '▶' : '…'}
                    </div>
                  )}
                </button>
              ))}
              {(runsQuery.data?.runs ?? []).length === 0 ? (
                <div className="rounded-sm border border-dashed border-stone-800 px-3 py-3 font-mono text-[10px] uppercase tracking-wider text-stone-600">
                  尚無生成記錄
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM toolbar — model / aspect / RUN */}
      <footer className="flex items-center justify-between border-t border-stone-800 bg-stone-950 px-8 py-3">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500">
            <AppIcon name="sparklesAlt" className="h-3 w-3" />
            <span>模型</span>
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              disabled={isBusy || imageModels.length === 0}
              className="max-w-[260px] truncate rounded-sm border border-stone-800 bg-stone-900 px-2 py-1 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40 disabled:opacity-50"
            >
              {imageModels.length === 0 ? (
                <option value="">尚無啟用的圖片模型 — 請到 /profile 啟用</option>
              ) : null}
              {imageModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500">
            <span>比例</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              disabled={isBusy}
              className="rounded-sm border border-stone-800 bg-stone-900 px-2 py-1 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
            >
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="font-mono text-[10px] uppercase tracking-wider text-stone-600">
            輸出 · 圖片 (T-1)
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPrompt('')
              setRefText('')
              setRefImages([])
              setRefVideo(null)
            }}
            disabled={isBusy}
            className="rounded-sm border border-stone-700 px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-stone-300 hover:border-stone-500 disabled:opacity-40"
          >
            重置
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={isBusy || !modelKey || !prompt.trim()}
            className="flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-2.5 font-mono text-[13px] font-semibold uppercase tracking-wider text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submit.isPending ? '生成中…' : '生成'}
            <span className="rounded-sm border border-stone-950/30 px-1 font-mono text-[10px] opacity-70">⌘+↵</span>
          </button>
        </div>
      </footer>
    </div>
  )
}

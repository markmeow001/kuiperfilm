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
import { resolveErrorDisplay } from '@/lib/errors/display'
import { VIDEO_PROMPT_SOFT_LIMIT, compressVideoPrompt } from '@/lib/playground/video-prompt-compress'
import { variantKeyForMode, variantModeMismatch, type VideoRefMode } from '@/lib/video-models/variant-for-mode'
import { useUserModels, type UserModelOption } from '@/lib/query/hooks/useUserModels'
import {
  useUploadPlaygroundReference,
  useSubmitPlaygroundRun,
  usePlaygroundRuns,
  usePlaygroundCostEstimate,
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
  // T-2 (2026-05-27): output type toggle is live. Switching resets the
  // model picker because image / video catalogs don't overlap.
  const [outputType, setOutputType] = useState<'image' | 'video'>('image')
  const [modelKey, setModelKey] = useState<string>('')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  // Video-only: duration in seconds. Defaulted to 5 for first-run snappiness;
  // Seedance / Kling all accept 4-15.
  const [durationSec, setDurationSec] = useState<number>(5)
  // Video-only resolution (720p/1080p…). Driven by the selected model's
  // capability-catalog resolutionOptions; the picker only renders when the
  // model exposes a real choice (>1 option). 2026-06-16 — AtlasCloud Seedance
  // R2V now offers 1080p.
  const [resolution, setResolution] = useState<string>('720p')

  // Output state
  const [latestRun, setLatestRun] = useState<PlaygroundRunRow | null>(null)
  const [compressing, setCompressing] = useState(false)
  // 参考图用途 (video): 'image' = first frame (i2v), 'omni' = style/identity
  // reference (r2v). Defaults to first frame — the semantics users expected
  // when they reported refs "only following the style" (2026-07-02).
  const [videoRefMode, setVideoRefMode] = useState<Extract<VideoRefMode, 'image' | 'omni'>>('image')

  // T-3 cost estimate (live) — refetches when model/outputType/duration changes.
  // Resolution isn't currently a user-controlled state in Playground T-1/T-2
  // (defaults to whatever the model defaults), so we omit it. If the user
  // later sees "—" cost, the pricing entry is capability-based and probably
  // needs resolution to compute — Phase T-4 can add a resolution dropdown.
  const costEstimate = usePlaygroundCostEstimate({
    modelKey,
    outputType,
    ...(outputType === 'video' ? { durationSec, resolution } : {}),
  })

  // File picker refs
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  // Phase T-3 — prompt textarea ref for caret-aware @-token insertion.
  // Without this, "insert @image1" would have to append at end-of-text and
  // users couldn't position the reference mid-sentence.
  const promptRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * Phase T-3 — insert a reference token (@image1 / @video1 etc) at the
   * current caret position in the prompt textarea. Replaces selection
   * when there is one. Keeps focus + moves caret to right after the
   * inserted token so the user can keep typing.
   */
  function insertReferenceToken(token: string) {
    const ta = promptRef.current
    if (!ta) {
      setPrompt((prev) => (prev ? `${prev} ${token}` : token))
      return
    }
    const start = ta.selectionStart ?? prompt.length
    const end = ta.selectionEnd ?? prompt.length
    const before = prompt.slice(0, start)
    const after = prompt.slice(end)
    // Add a leading space if the previous char isn't whitespace, and a
    // trailing space if the next char isn't whitespace. Avoids 'rooftop@image1'
    // mid-word collisions that would confuse the model.
    const needLeadingSpace = before.length > 0 && !/\s$/.test(before)
    const needTrailingSpace = after.length > 0 && !/^\s/.test(after)
    const insert = `${needLeadingSpace ? ' ' : ''}${token}${needTrailingSpace ? ' ' : ''}`
    const next = before + insert + after
    setPrompt(next)
    // Restore focus + position caret right after the inserted token.
    setTimeout(() => {
      ta.focus()
      const caretPos = start + insert.length
      ta.setSelectionRange(caretPos, caretPos)
    }, 0)
  }

  // Build model lists for both output modes; picker filters by current
  // outputType. Both populated from useUserModels (admin-enabled lists).
  const imageModels = useMemo<UserModelOption[]>(() => {
    return userModelsQuery.data?.image ?? []
  }, [userModelsQuery.data])
  const videoModels = useMemo<UserModelOption[]>(() => {
    return userModelsQuery.data?.video ?? []
  }, [userModelsQuery.data])
  const activeModels = outputType === 'image' ? imageModels : videoModels

  // Reset model picker when output type changes; the two catalogs don't
  // overlap (image keys never appear in the video allowlist and vice versa).
  useEffect(() => {
    if (activeModels.length === 0) {
      if (modelKey) setModelKey('')
      return
    }
    // Keep current selection if it's still valid; otherwise default to first.
    const found = activeModels.find((m) => m.value === modelKey)
    if (!found) setModelKey(activeModels[0].value)
  }, [activeModels, modelKey])

  // Resolution options come from the selected model's built-in capability
  // catalog (findBuiltinCapabilities → resolutionOptions). Only show the
  // picker when there's a real choice (>1). Keep `resolution` valid when the
  // model changes — fall back to 720p if available, else the first option.
  const selectedVideoModel = activeModels.find((m) => m.value === modelKey)
  const resolutionOptions: string[] =
    (outputType === 'video' && selectedVideoModel?.capabilities?.video?.resolutionOptions) || []
  const showResolutionPicker = resolutionOptions.length > 1
  useEffect(() => {
    if (resolutionOptions.length > 0 && !resolutionOptions.includes(resolution)) {
      setResolution(resolutionOptions.includes('720p') ? '720p' : resolutionOptions[0])
    }
  }, [resolutionOptions, resolution])

  // Auto-pick up worker-completed video runs: when usePlaygroundRuns
  // refetches (every 3s while pending/running rows exist), promote ANY
  // change (pending→running→succeeded/failed) into the preview state so
  // the user sees the worker picked up + finished without manual refresh.
  // Previously the effect only updated on terminal transitions, leaving
  // the UI stuck on the initial 'pending' status for the entire 1-3 min
  // generation window.
  useEffect(() => {
    if (!latestRun) return
    if (latestRun.status === 'succeeded' || latestRun.status === 'failed') return
    const updated = runsQuery.data?.runs?.find((r) => r.id === latestRun.id)
    if (updated && updated.status !== latestRun.status) {
      setLatestRun(updated)
    } else if (updated && updated.status === 'succeeded' && (!latestRun.resultUrls?.[0] || latestRun.resultUrls?.[0] !== updated.resultUrls?.[0])) {
      // Status was already 'succeeded' on a previous tick but URLs may
      // have signed-URL refreshes from the server — promote those too.
      setLatestRun(updated)
    }
  }, [runsQuery.data, latestRun])

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

  async function handleRun(overrideModelKey?: string) {
    if (!prompt.trim()) {
      alert('請先輸入提示詞')
      return
    }
    // Image prompts: hard client-side guard mirroring the server cap.
    if (outputType === 'image' && prompt.trim().length > 4000) {
      alert(`提示詞過長（${prompt.trim().length}/4000 字符），請精簡後再生成`)
      return
    }
    const useModelKey = overrideModelKey ?? modelKey
    if (!useModelKey) {
      alert('請先選擇模型')
      return
    }
    // Video prompts: Seedance-class models dilute over-long prompts, so
    // anything past the soft limit is auto-compressed via the CANVAS_TEXT
    // task before submit (normally billed as a text task).
    let effectivePrompt = prompt.trim()
    if (outputType === 'video' && effectivePrompt.length > VIDEO_PROMPT_SOFT_LIMIT) {
      setCompressing(true)
      try {
        effectivePrompt = await compressVideoPrompt(effectivePrompt)
      } catch (err) {
        alert(`提示詞過長（${prompt.trim().length} 字符）且自動壓縮失敗：${(err as Error)?.message ?? '未知錯誤'}`)
        return
      } finally {
        setCompressing(false)
      }
    }
    // Phase T-3 — when this is a cross-model swap, also sync the picker so
    // subsequent runs and the cost estimate reflect the new selection.
    if (overrideModelKey && overrideModelKey !== modelKey) {
      setModelKey(overrideModelKey)
    }
    // Video + refs: route to the endpoint variant implementing the chosen
    // 参考图用途 (i2v sibling for first-frame, r2v for style reference). Keys
    // without a t2v/i2v/r2v suffix — or without the sibling enabled — pass
    // through unchanged.
    const effectiveModelKey = outputType === 'video' && refImages.length > 0
      ? variantKeyForMode(useModelKey, videoRefMode, videoModels.map((m) => m.value))
      : useModelKey
    try {
      const result = await submit.mutateAsync({
        prompt: effectivePrompt,
        referenceImages: refImages.map((r) => r.key),
        referenceVideos: refVideo ? [refVideo.key] : [],
        referenceText: refText.trim() || undefined,
        outputType,
        modelKey: effectiveModelKey,
        aspectRatio,
        ...(outputType === 'video' ? { durationSec } : {}),
        ...(showResolutionPicker ? { resolution } : {}),
      })
      // Latest run goes to the preview area.
      setLatestRun({
        id: result.run.id,
        prompt: effectivePrompt,
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

  const isBusy = upload.isPending || submit.isPending || compressing

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
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="描述你想生成的畫面... 譬如「賽博龐克城市夜景, 巨型廣告牌特寫, 雨夜霓虹倒映」&#10;&#10;💡 上傳參考素材後可點下方紫色 chip 插入 @image1 / @video1 引用"
              className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/40 p-3 text-[14px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40"
            />
            {/* Phase T-3 — @-token quick-insert toolbar.
                Shows up only when there's at least one uploaded ref. Click
                inserts @imageN / @videoN at the prompt's caret position. */}
            {(refImages.length > 0 || refVideo) ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-stone-600">引用</span>
                {refImages.map((_, idx) => {
                  const token = `@image${idx + 1}`
                  return (
                    <button
                      type="button"
                      key={`tok-${token}`}
                      onClick={() => insertReferenceToken(token)}
                      title={`插入 ${token} 引用第 ${idx + 1} 張參考圖`}
                      className="rounded-sm border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] text-violet-300 hover:bg-violet-500/20"
                    >
                      {token}
                    </button>
                  )
                })}
                {refVideo ? (
                  <button
                    type="button"
                    onClick={() => insertReferenceToken('@video1')}
                    title="插入 @video1 引用參考影片"
                    className="rounded-sm border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] text-violet-300 hover:bg-violet-500/20"
                  >
                    @video1
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Reference images grid */}
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between font-mono text-[12px] uppercase tracking-wider">
              <span className="text-stone-500">
                參考圖片 <span className="text-violet-400">({refImages.length}/{MAX_REF_IMAGES})</span>
              </span>
            </div>
            {/* 参考图用途 — video only. Seedance-class endpoints give the image
                different SEMANTICS per variant (i2v = first frame, r2v = style/
                identity ref); the submit swaps to the sibling variant that
                implements the chosen mode. */}
            {outputType === 'video' && refImages.length > 0 ? (
              <div className="mb-2">
                <div className="flex gap-1">
                  {([
                    { key: 'image', label: '首幀（畫面從這張圖開始）' },
                    { key: 'omni', label: '風格 / 角色參考' },
                  ] as const).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setVideoRefMode(m.key)}
                      className={`flex-1 rounded-sm border px-2 py-1.5 font-mono text-[11px] transition-colors ${
                        videoRefMode === m.key
                          ? 'border-violet-500/60 bg-violet-500/10 text-violet-300'
                          : 'border-stone-700 text-stone-500 hover:text-stone-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {(() => {
                  const keys = videoModels.map((m) => m.value)
                  const eff = variantKeyForMode(modelKey, videoRefMode, keys)
                  const notes: string[] = []
                  if (videoRefMode === 'image' && refImages.length > 1) {
                    notes.push('首幀模式僅使用第 1 張參考圖')
                  }
                  if (eff !== modelKey) {
                    const label = videoModels.find((m) => m.value === eff)?.label ?? eff
                    notes.push(`已自動匹配端點：${label}`)
                  } else if (variantModeMismatch(modelKey, videoRefMode)) {
                    const want = videoRefMode === 'image' ? 'I2V' : 'R2V'
                    return <div className="mt-1 font-mono text-[10px] text-amber-400">此模式需要 {want} 端點變體 — 請到 /profile 啟用對應模型</div>
                  }
                  return notes.length > 0
                    ? <div className="mt-1 font-mono text-[10px] text-stone-500">{notes.join(' · ')}</div>
                    : null
                })()}
              </div>
            ) : null}
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
                {submit.isPending
                  ? '提交中…'
                  : latestRun?.status === 'pending'
                    ? '排隊中'
                    : latestRun?.status === 'running'
                      ? '生成中'
                      : latestRun?.status === 'succeeded'
                        ? '已完成'
                        : latestRun?.status === 'failed'
                          ? '失敗'
                          : '閒置'}
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

          {/* Preview — height-driven for portrait ratios, width-driven for
              landscape. CSS aspect-ratio alone gives runaway height on
              9:16 because the right column is ~700px wide → 700×1244px
              overflows the viewport. Picking the right driver per ratio
              keeps the preview frame snug. */}
          {(() => {
            const [aw, ah] = aspectRatio.split(':').map(Number)
            const isPortrait = ah > aw
            const previewStyle: React.CSSProperties = isPortrait
              ? {
                  aspectRatio: `${aw} / ${ah}`,
                  height: 'min(64vh, 640px)',
                  width: 'auto',
                  maxWidth: '100%',
                }
              : {
                  aspectRatio: `${aw} / ${ah}`,
                  width: '100%',
                  height: 'auto',
                  maxHeight: 'min(64vh, 640px)',
                }
            return (
          <div className="mb-3 flex justify-center">
          <div
            className="relative overflow-hidden rounded-sm border border-stone-800 bg-stone-900/40"
            style={previewStyle}
          >
            {submit.isPending ? (
              <div className="flex h-full w-full items-center justify-center text-stone-500">
                <div className="flex items-center gap-3">
                  <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-amber-400" />
                  <div className="font-mono text-[12px] uppercase tracking-wider">提交中…</div>
                </div>
              </div>
            ) : latestRun?.status === 'failed' ? (
              <div className="flex h-full w-full items-center justify-center p-8 text-center">
                <div>
                  <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-rose-400">生成失敗</div>
                  {/* Normalize provider errors (e.g. AtlasCloud 402 → "余额不足，请先充值")
                      instead of dumping raw "提交失败 (402): {...}". Raw stays in the
                      title tooltip for ops. (2026-06-03 audit) */}
                  <div
                    className="font-mono text-[11px] text-stone-500"
                    title={latestRun.errorMessage ?? undefined}
                  >
                    {resolveErrorDisplay({ message: latestRun.errorMessage })?.message
                      ?? latestRun.errorMessage
                      ?? '未知錯誤'}
                  </div>
                </div>
              </div>
            ) : latestRun?.status === 'pending' || latestRun?.status === 'running' ? (
              // Phase V (2026-05-28) — explicit async-progress state.
              // For video, the POST returns in ~100ms with status='pending'
              // but the worker takes 1-3 minutes to actually produce the
              // mp4. Without this branch, the UI fell through to the
              // 「尚未生成」 placeholder for the entire wait window, making
              // the user think nothing was happening (it was — they just
              // couldn't see it). usePlaygroundRuns auto-polls every 3s
              // while pending/running rows exist, so this banner flips to
              // the video automatically when the worker finishes.
              <div className="flex h-full w-full items-center justify-center p-6 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
                    <div className="font-mono text-[14px] uppercase tracking-wider text-amber-300">
                      {latestRun.status === 'pending' ? '排隊中' : '生成中'}
                    </div>
                  </div>
                  <div className="max-w-md font-serif-cn text-[12px] leading-relaxed text-stone-400">
                    {latestRun.outputType === 'video'
                      ? '影片生成大約需要 1-3 分鐘，可保持此頁面開啟。完成後會自動顯示，也會出現在下方歷史紀錄中。'
                      : '處理中…'}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-stone-600">
                    Run ID · {latestRun.id.slice(0, 8)}…
                  </div>
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
          </div>
            )
          })()}

          {/* Phase T-3 — cross-model chip strip. After a run completes,
              show 2-3 OTHER user-enabled models of the same outputType
              for one-click re-execute with the same prompt + refs.
              Encourages comparison shopping without re-typing. */}
          {latestRun?.status === 'succeeded' && activeModels.length > 1 ? (
            <div className="mb-3 rounded-sm border border-stone-800 bg-stone-900/30 p-3">
              <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-stone-500">
                您可以繼續：用其他模型試同一 prompt
              </div>
              <div className="flex flex-wrap gap-2">
                {activeModels
                  .filter((m) => m.value !== modelKey)
                  .slice(0, 4)
                  .map((m) => (
                    <button
                      type="button"
                      key={m.value}
                      onClick={() => handleRun(m.value)}
                      disabled={isBusy}
                      className="rounded-sm border border-stone-700 bg-stone-900/40 px-3 py-1.5 font-mono text-[11px] text-stone-300 hover:border-violet-400/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
                      title={`用 ${m.label} 重跑同一 prompt + refs`}
                    >
                      {m.label}
                    </button>
                  ))}
              </div>
            </div>
          ) : null}

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

      {/* BOTTOM toolbar — output / model / params / RUN */}
      <footer className="flex items-center justify-between border-t border-stone-800 bg-stone-950 px-8 py-3">
        <div className="flex items-center gap-4">
          {/* Phase T-2 (2026-05-27) — output toggle. Image stays synchronous;
              video enqueues + polls (see usePlaygroundRuns auto-refetch). */}
          <div className="inline-flex items-center gap-0 rounded-sm border border-stone-800 bg-stone-900 p-0.5">
            <button
              type="button"
              onClick={() => setOutputType('image')}
              disabled={isBusy}
              className={`rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                outputType === 'image'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              圖片
            </button>
            <button
              type="button"
              onClick={() => setOutputType('video')}
              disabled={isBusy}
              className={`rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                outputType === 'video'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              影片
            </button>
          </div>

          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500">
            <AppIcon name="sparklesAlt" className="h-3 w-3" />
            <span>模型</span>
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              disabled={isBusy || activeModels.length === 0}
              className="max-w-[260px] truncate rounded-sm border border-stone-800 bg-stone-900 px-2 py-1 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40 disabled:opacity-50"
            >
              {activeModels.length === 0 ? (
                <option value="">尚無啟用的{outputType === 'image' ? '圖片' : '影片'}模型 — 請到 /profile 啟用</option>
              ) : null}
              {activeModels.map((m) => (
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

          {/* Video-only: duration. Mirrors GroupCard 5-15s integer dropdown. */}
          {outputType === 'video' ? (
            <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500">
              <AppIcon name="play" className="h-3 w-3" />
              <span>時長</span>
              <select
                value={durationSec}
                onChange={(e) => setDurationSec(Number.parseInt(e.target.value, 10) || 5)}
                disabled={isBusy}
                className="rounded-sm border border-stone-800 bg-stone-900 px-2 py-1 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
              >
                {Array.from({ length: 11 }, (_, i) => 5 + i).map((sec) => (
                  <option key={sec} value={sec}>{sec}s</option>
                ))}
              </select>
            </label>
          ) : null}

          {/* Video-only: resolution. Rendered only when the selected model's
              capability catalog exposes >1 option (e.g. AtlasCloud Seedance R2V
              480p/720p/1080p). Mirrors the 比例/時長 control style. */}
          {showResolutionPicker ? (
            <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500">
              <span>解析度</span>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                disabled={isBusy}
                className="rounded-sm border border-stone-800 bg-stone-900 px-2 py-1 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
              >
                {resolutionOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
          ) : null}
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
          {/* Phase T-3 — live cost estimate next to RUN.
              "—" when pricing entry doesn't exist or capability tier didn't
              match. Hover for the detail string ("0.0960/秒 × 5s" etc). */}
          <div
            className="text-right"
            title={costEstimate.data?.detail ?? '尚無計費資訊'}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-stone-600">估算成本</div>
            <div className="font-mono text-[14px] text-amber-300">
              {typeof costEstimate.data?.amountUsd === 'number'
                ? `≈ $${costEstimate.data.amountUsd.toFixed(costEstimate.data.amountUsd < 1 ? 4 : 2)}`
                : '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleRun()}
            disabled={
              isBusy
              || !modelKey
              || !prompt.trim()
              || latestRun?.status === 'pending'
              || latestRun?.status === 'running'
            }
            className="flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-2.5 font-mono text-[13px] font-semibold uppercase tracking-wider text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {compressing
              ? '壓縮提示詞…'
              : submit.isPending
                ? '提交中…'
                : latestRun?.status === 'pending' || latestRun?.status === 'running'
                  ? '生成中…'
                  : '生成'}
            <span className="rounded-sm border border-stone-950/30 px-1 font-mono text-[10px] opacity-70">⌘+↵</span>
          </button>
        </div>
      </footer>
    </div>
  )
}

'use client'

/**
 * Image studio — lightweight, high-volume iteration surface (Higgsfield/
 * Midjourney model): an aspect-preserving masonry gallery of past image runs
 * (newest-first, in-progress = placeholder tile in the newest slot) with a
 * single bottom composer. Clicking a tile opens the shared ResultLightbox.
 *
 * References are shown as inline thumbnails in the composer (Higgsfield model):
 * the image tile IS the reference — no @image text tokens. A ＋ tile adds more
 * via a direct file picker. (Reference video/text stay in the Video studio,
 * where they actually apply.)
 */

import { useRef } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { ASPECT_RATIO_OPTIONS, MAX_REF_IMAGES, type PlaygroundController, type PlaygroundRun } from './usePlaygroundController'

interface ImageStudioProps {
  ctrl: PlaygroundController
}

export function ImageStudio({ ctrl }: ImageStudioProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const {
    prompt, setPrompt, promptRef, refImages,
    modelKey, setModelKey, activeModels, aspectRatio, setAspectRatio,
    isBusy, isGenerating, compressing, submit, costEstimate,
    imageRuns, latestRun, handleRun, resetForm, setLightboxRun,
    handleImagePick, removeRefImage,
  } = ctrl

  const showPlaceholder =
    submit.isPending || (isGenerating && latestRun?.outputType === 'image')
  const atMaxRefs = refImages.length >= MAX_REF_IMAGES

  function onPromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!isBusy && modelKey && prompt.trim() && !isGenerating) handleRun()
    }
  }

  return (
    <>
      {/* Gallery */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-6">
          <div className="mb-3 font-mono text-[12px] uppercase tracking-wider text-stone-500">
            最近生成（{imageRuns.length}）
          </div>

          {imageRuns.length === 0 && !showPlaceholder ? (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-stone-800 px-6 py-20 text-center">
              <AppIcon name="sparklesAlt" className="h-10 w-10 text-stone-700" />
              <div className="mt-4 font-mono text-[12px] uppercase tracking-wider text-stone-500">還沒有作品</div>
              <div className="mt-1 font-serif-cn text-[13px] text-stone-600">在下方輸入描述詞,按「生成」開始創作</div>
            </div>
          ) : (
            <div className="gap-3 [column-fill:_balance] columns-2 sm:columns-3 lg:columns-4">
              {showPlaceholder ? (
                <div className="mb-3 flex aspect-[3/4] break-inside-avoid items-center justify-center rounded-sm border border-amber-500/30 bg-stone-900/40">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
                    <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                      {submit.isPending ? '提交中…' : latestRun?.status === 'pending' ? '排隊中' : '生成中'}
                    </div>
                  </div>
                </div>
              ) : null}

              {imageRuns.map((run) => (
                <ImageTile key={run.id} run={run} onOpen={() => setLightboxRun(run)} />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Composer */}
      <footer className="border-t border-stone-800 bg-stone-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl">
          <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-800/50 to-stone-950/40 p-3 shadow-xl">
            {/* Reference thumbnails (Higgsfield-style: the image IS the reference) */}
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              {refImages.map((ref, idx) => (
                <div
                  key={ref.key}
                  className="group relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-stone-700"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.signedUrl} alt={`參考 ${idx + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeRefImage(idx)}
                    title="移除參考圖"
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-stone-950/80 text-[12px] text-stone-200 opacity-0 transition-opacity hover:bg-rose-500/90 hover:text-white group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isBusy || atMaxRefs}
                title={atMaxRefs ? `參考圖最多 ${MAX_REF_IMAGES} 張` : '加入參考圖'}
                className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-stone-700 text-stone-500 transition-colors hover:border-violet-500/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon name="image" className="h-5 w-5" />
                <span className="font-mono text-[9px] uppercase tracking-wider">參考</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleImagePick}
              />

              {refImages.length > 0 ? (
                <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-stone-600">
                  {refImages.length}/{MAX_REF_IMAGES} 參考圖
                </span>
              ) : null}
            </div>

            {/* Prompt + generate */}
            <div className="flex items-end gap-2">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onPromptKeyDown}
                rows={2}
                placeholder="描述你想生成的畫面... 譬如「賽博龐克城市夜景, 巨型廣告牌特寫, 雨夜霓虹倒映」"
                className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-stone-800 bg-stone-950/60 p-3 text-[14px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40"
              />

              <button
                type="button"
                onClick={() => handleRun()}
                disabled={isBusy || !modelKey || !prompt.trim() || isGenerating}
                className="flex h-11 flex-shrink-0 items-center gap-2 rounded-lg bg-amber-500 px-6 font-mono text-[13px] font-semibold uppercase tracking-wider text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {compressing ? '壓縮提示詞…' : submit.isPending ? '提交中…' : isGenerating ? '生成中…' : '生成'}
                <span className="rounded-sm border border-stone-950/30 px-1 font-mono text-[10px] opacity-70">⌘+↵</span>
              </button>
            </div>

            {/* Controls */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-stone-500">
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                <select
                  value={modelKey}
                  onChange={(e) => setModelKey(e.target.value)}
                  disabled={isBusy || activeModels.length === 0}
                  className="max-w-[240px] truncate rounded-sm border border-stone-800 bg-stone-900 px-2 py-1 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40 disabled:opacity-50"
                >
                  {activeModels.length === 0 ? <option value="">尚無啟用的圖片模型 — 請到 /profile 啟用</option> : null}
                  {activeModels.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
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
                  {ASPECT_RATIO_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                </select>
              </label>

              <button
                type="button"
                onClick={resetForm}
                disabled={isBusy}
                className="rounded-sm border border-stone-800 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-stone-500 hover:border-stone-600 hover:text-stone-300 disabled:opacity-40"
              >
                重置
              </button>

              <div className="ml-auto text-right" title={costEstimate.data?.detail ?? '尚無計費資訊'}>
                <span className="font-mono text-[10px] uppercase tracking-wider text-stone-600">估算成本 </span>
                <span className="font-mono text-[13px] text-amber-300">
                  {typeof costEstimate.data?.amountUsd === 'number'
                    ? `≈ $${costEstimate.data.amountUsd.toFixed(costEstimate.data.amountUsd < 1 ? 4 : 2)}`
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}

/** One gallery tile — aspect-preserving, click to open the lightbox. */
function ImageTile({ run, onOpen }: { run: PlaygroundRun; onOpen: () => void }) {
  const url = run.resultUrls?.[0]
  return (
    <button
      type="button"
      onClick={onOpen}
      title={run.prompt.slice(0, 80)}
      className="group mb-3 block w-full break-inside-avoid overflow-hidden rounded-sm border border-stone-800 bg-stone-900 transition-all hover:border-violet-500/50"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="result" loading="lazy" className="w-full object-cover transition-opacity group-hover:opacity-90" />
      ) : (
        <div className="flex aspect-[3/4] items-center justify-center font-mono text-[11px] text-stone-500">
          {run.status === 'failed' ? '✕ 失敗' : '…'}
        </div>
      )}
    </button>
  )
}

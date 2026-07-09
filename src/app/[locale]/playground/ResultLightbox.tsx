'use client'

/**
 * Result detail lightbox — full-screen modal opened when a gallery tile is
 * clicked (Image studio). Right rail models the Higgsfield detail layout:
 *   header (identity + close)
 *   → scrollable body: PROMPT (+copy, expand/collapse) + collapsible DETAILS
 *   → pinned action stack: primary 圖轉影片 (i2v) + 重新生成 / 作為參考
 *      + icon row (下載 / 分享 / 更多→帶回修改·換模型重生).
 * Layout borrowed from Higgsfield; KuiperAI keeps its amber-on-stone identity
 * (not Higgsfield's lime). Every action maps to a real capability — no stubs.
 */

import { useEffect, useState } from 'react'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { playgroundDownloadHref, type PlaygroundController } from './usePlaygroundController'

interface ResultLightboxProps {
  ctrl: PlaygroundController
}

export function ResultLightbox({ ctrl }: ResultLightboxProps) {
  const run = ctrl.lightboxRun
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  const close = () => ctrl.setLightboxRun(null)

  // ESC closes; reset per-run local UI whenever the open run changes.
  useEffect(() => {
    if (!run) return
    setPromptExpanded(false)
    setMoreOpen(false)
    setLinkCopied(false)
    setDims(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ctrl.setLightboxRun(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, ctrl])

  if (!run) return null

  const url = run.resultUrls?.[0] ?? null
  const isImage = run.outputType === 'image'
  const modelLabel = ctrl.activeModels.find((m) => m.value === run.modelKey)?.label ?? run.modelKey ?? '—'
  const otherModels = ctrl.activeModels.filter((m) => m.value !== run.modelKey).slice(0, 6)
  const promptLong = (run.prompt?.length ?? 0) > 120
  const statusText =
    run.status === 'succeeded' ? '已完成' : run.status === 'failed' ? '失敗' : run.status === 'running' ? '生成中' : '排隊中'

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      alert('複製連結失敗:瀏覽器不允許存取剪貼簿')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-stone-950/90 backdrop-blur-sm">
      {/* Backdrop click closes */}
      <button type="button" aria-label="關閉" onClick={close} className="absolute inset-0 cursor-default" />

      <div className="relative z-10 m-auto flex max-h-[92vh] w-[94vw] max-w-6xl overflow-hidden rounded-lg border border-stone-800 bg-stone-950 shadow-2xl">
        {/* Media */}
        <div className="flex min-w-0 flex-1 items-center justify-center bg-black p-4">
          {url ? (
            isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt="result"
                onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className="max-h-[84vh] max-w-full object-contain"
              />
            ) : (
              <video src={url} controls autoPlay playsInline className="max-h-[84vh] max-w-full object-contain" />
            )
          ) : run.status === 'failed' ? (
            <div className="p-10 text-center">
              <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-rose-400">生成失敗</div>
              <div className="font-mono text-[11px] text-stone-500" title={run.errorMessage ?? undefined}>
                {resolveErrorDisplay({ message: run.errorMessage })?.message ?? run.errorMessage ?? '未知錯誤'}
              </div>
            </div>
          ) : (
            <div className="p-10 font-mono text-[12px] uppercase tracking-wider text-stone-500">處理中…</div>
          )}
        </div>

        {/* Right rail */}
        <div className="flex w-[360px] flex-shrink-0 flex-col bg-stone-950">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-l border-stone-800 px-4 py-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 font-mono text-[11px] font-bold text-stone-950">
              AI
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[13px] text-stone-200">{modelLabel}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
                {isImage ? '圖片' : '影片'} · {statusText}
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              title="關閉 (Esc)"
              className="flex h-7 w-7 items-center justify-center rounded-sm border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200"
            >
              ✕
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto border-l border-stone-800 px-4 py-4">
            {/* PROMPT */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500">描述詞</span>
                <button
                  type="button"
                  onClick={() => ctrl.copyPrompt(run.prompt)}
                  className="rounded-sm border border-stone-700 px-2 py-0.5 font-mono text-[10px] text-stone-400 hover:border-amber-500/60 hover:text-amber-300"
                >
                  {ctrl.promptCopied ? '✓ 已複製' : '複製'}
                </button>
              </div>
              <div
                className={`whitespace-pre-wrap break-words font-serif-cn text-[12px] leading-relaxed text-stone-400 ${
                  promptExpanded ? 'max-h-[45vh] overflow-y-auto' : 'max-h-28 overflow-hidden'
                }`}
              >
                {run.prompt || '（此筆無描述詞紀錄）'}
              </div>
              {promptLong ? (
                <button
                  type="button"
                  onClick={() => setPromptExpanded((v) => !v)}
                  className="mt-1.5 font-mono text-[11px] text-amber-400/80 hover:text-amber-300"
                >
                  {promptExpanded ? '收起 ▲' : '展開全部 ▼'}
                </button>
              ) : null}
            </div>

            {/* DETAILS */}
            <div className="border-t border-stone-800 pt-3">
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="mb-2 flex w-full items-center justify-between font-mono text-[10px] uppercase tracking-wider text-stone-500 hover:text-stone-300"
              >
                <span>詳情</span>
                <span>{detailsOpen ? '▲' : '▼'}</span>
              </button>
              {detailsOpen ? (
                <div className="space-y-1.5 font-mono text-[11px]">
                  <Row label="模型" value={modelLabel} />
                  {isImage && dims ? <Row label="尺寸" value={`${dims.w}×${dims.h}`} /> : null}
                  <Row label="狀態" value={statusText} />
                  <Row label="建立" value={new Date(run.createdAt).toLocaleString('zh-TW', { hour12: false })} />
                </div>
              ) : null}
            </div>
          </div>

          {/* Pinned action stack */}
          <div className="relative border-l border-t border-stone-800 p-4">
            {/* More popover */}
            {moreOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setMoreOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div className="absolute bottom-full right-4 z-50 mb-2 w-[300px] rounded-lg border border-stone-800 bg-stone-900 p-3 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => ctrl.editPrompt(run.prompt)}
                    disabled={ctrl.isBusy || !run.prompt}
                    className="mb-3 w-full rounded-sm border border-stone-700 py-2 font-mono text-[12px] text-stone-300 hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    帶回輸入框修改
                  </button>
                  {otherModels.length > 0 ? (
                    <>
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-stone-600">換模型重生同一描述詞</div>
                      <div className="flex flex-wrap gap-1.5">
                        {otherModels.map((m) => (
                          <button
                            type="button"
                            key={m.value}
                            onClick={() => {
                              setMoreOpen(false)
                              ctrl.handleRun(m.value, run.prompt)
                            }}
                            disabled={ctrl.isBusy || !run.prompt}
                            className="rounded-sm border border-stone-700 bg-stone-900/40 px-2 py-1 font-mono text-[10px] text-stone-300 hover:border-violet-400/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
                            title={`用 ${m.label} 重跑`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}

            {/* Primary: image → video (i2v) */}
            {isImage && url ? (
              <button
                type="button"
                onClick={() => ctrl.applyRunAsReference(run, { asVideo: true })}
                disabled={ctrl.isBusy}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-2.5 font-mono text-[13px] font-semibold uppercase tracking-wider text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ▶ 圖轉影片
              </button>
            ) : null}

            {/* Recreate + Reference */}
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => ctrl.handleRun(run.modelKey, run.prompt)}
                disabled={ctrl.isBusy || !run.prompt}
                className="rounded-lg border border-stone-700 py-2 font-mono text-[12px] text-stone-300 hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                重新生成
              </button>
              <button
                type="button"
                onClick={() => ctrl.applyRunAsReference(run)}
                disabled={ctrl.isBusy || !url}
                className="rounded-lg border border-stone-700 py-2 font-mono text-[12px] text-stone-300 hover:border-violet-400/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                作為參考
              </button>
            </div>

            {/* Icon row */}
            <div className="flex items-center gap-2">
              {url ? (
                <a
                  href={playgroundDownloadHref(url, `kuiperai-${run.id}`)}
                  download
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-800 py-2 font-mono text-[11px] uppercase tracking-wider text-stone-400 hover:border-stone-600 hover:text-stone-200"
                >
                  ↓ 下載
                </a>
              ) : null}
              {url ? (
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-800 py-2 font-mono text-[11px] uppercase tracking-wider text-stone-400 hover:border-stone-600 hover:text-stone-200"
                >
                  {linkCopied ? '✓ 已複製' : '⤴ 分享'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                title="更多"
                className={`flex h-9 w-11 flex-shrink-0 items-center justify-center rounded-lg border font-mono text-[14px] ${
                  moreOpen ? 'border-amber-500/60 text-amber-300' : 'border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                }`}
              >
                ⋯
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-stone-600">{label}</span>
      <span className="truncate text-stone-300" title={value}>
        {value}
      </span>
    </div>
  )
}

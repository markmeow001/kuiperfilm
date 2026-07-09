'use client'

/**
 * Result detail lightbox — full-screen modal opened when a gallery tile is
 * clicked (Image studio). Mirrors the Higgsfield/Midjourney detail pattern:
 * large media on the left, a right rail with the prompt (+copy), run details,
 * and per-result actions (download / edit-and-rerun / cross-model rerun).
 * Keeps KuiperAI's amber-on-stone identity (borrowed layout, not colours).
 */

import { useEffect } from 'react'
import { resolveErrorDisplay } from '@/lib/errors/display'
import type { PlaygroundController } from './usePlaygroundController'

interface ResultLightboxProps {
  ctrl: PlaygroundController
}

export function ResultLightbox({ ctrl }: ResultLightboxProps) {
  const run = ctrl.lightboxRun
  const close = () => ctrl.setLightboxRun(null)

  // ESC to close.
  useEffect(() => {
    if (!run) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ctrl.setLightboxRun(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, ctrl])

  if (!run) return null

  const url = run.resultUrls?.[0] ?? null
  const otherModels = ctrl.activeModels.filter((m) => m.value !== run.modelKey).slice(0, 4)

  return (
    <div className="fixed inset-0 z-50 flex bg-stone-950/90 backdrop-blur-sm">
      {/* Backdrop click closes */}
      <button type="button" aria-label="關閉" onClick={close} className="absolute inset-0 cursor-default" />

      <div className="relative z-10 m-auto flex max-h-[92vh] w-[92vw] max-w-6xl overflow-hidden rounded-lg border border-stone-800 bg-stone-950 shadow-2xl">
        {/* Media */}
        <div className="flex min-w-0 flex-1 items-center justify-center bg-black p-4">
          {url ? (
            run.outputType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="result" className="max-h-[84vh] max-w-full object-contain" />
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
        <div className="flex w-[320px] flex-shrink-0 flex-col overflow-y-auto border-l border-stone-800 bg-stone-950 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
              {run.outputType === 'image' ? '圖片' : '影片'}詳情
            </span>
            <button
              type="button"
              onClick={close}
              className="flex h-6 w-6 items-center justify-center rounded-sm border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200"
              title="關閉 (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Prompt + copy */}
          <div className="mb-4 rounded-sm border border-stone-800 bg-stone-900/40 p-3">
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
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-serif-cn text-[12px] leading-relaxed text-stone-400">
              {run.prompt || '（此筆無描述詞紀錄）'}
            </div>
          </div>

          {/* Details */}
          <div className="mb-4 space-y-1.5 font-mono text-[11px] text-stone-500">
            <div className="flex justify-between gap-2">
              <span className="text-stone-600">模型</span>
              <span className="truncate text-stone-300">{run.modelKey || '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-stone-600">狀態</span>
              <span className="text-stone-300">
                {run.status === 'succeeded' ? '已完成' : run.status === 'failed' ? '失敗' : run.status === 'running' ? '生成中' : '排隊中'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-stone-600">建立</span>
              <span className="text-stone-300">{new Date(run.createdAt).toLocaleString('zh-TW', { hour12: false })}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-auto space-y-2">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="flex w-full items-center justify-center gap-2 rounded-sm border border-stone-700 py-2 font-mono text-[12px] uppercase tracking-wider text-stone-300 hover:border-amber-500/60 hover:text-amber-300"
              >
                ↓ 下載
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => ctrl.editPrompt(run.prompt)}
              disabled={ctrl.isBusy || !run.prompt}
              className="w-full rounded-sm bg-amber-500 py-2 font-mono text-[12px] font-semibold uppercase tracking-wider text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              帶回輸入框修改
            </button>

            {otherModels.length > 0 ? (
              <div className="pt-1">
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-stone-600">換模型重生同一 prompt</div>
                <div className="flex flex-wrap gap-1.5">
                  {otherModels.map((m) => (
                    <button
                      type="button"
                      key={m.value}
                      onClick={() => {
                        ctrl.setPrompt(run.prompt)
                        ctrl.setLightboxRun(null)
                        ctrl.handleRun(m.value)
                      }}
                      disabled={ctrl.isBusy || !run.prompt}
                      className="rounded-sm border border-stone-700 bg-stone-900/40 px-2 py-1 font-mono text-[10px] text-stone-300 hover:border-violet-400/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
                      title={`用 ${m.label} 重跑`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

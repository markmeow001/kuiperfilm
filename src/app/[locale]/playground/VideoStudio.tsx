'use client'

/**
 * Video studio — heavier, review-focused 3-column layout (Higgsfield model),
 * because video generation is param-rich, slow and expensive:
 *   LEFT   params column  — prompt + references + model + duration/resolution
 *                           + aspect + cost + Generate
 *   CENTRE stage          — the selected/active video, large; history strip below
 *   RIGHT  detail rail     — the staged run's model / prompt(+copy) / actions
 * Keeps KuiperAI's amber-on-stone identity.
 */

import { AppIcon } from '@/components/ui/icons'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { ElementBindingsPanel } from './ElementBindingsPanel'
import { KLING_O3_ASPECT_RATIO_VALUES } from './useKlingElements'
import { ReferencePanel } from './ReferencePanel'
import { ASPECT_RATIO_OPTIONS, playgroundDownloadHref, type PlaygroundController, type PlaygroundRun } from './usePlaygroundController'

interface VideoStudioProps {
  ctrl: PlaygroundController
}

export function VideoStudio({ ctrl }: VideoStudioProps) {
  const {
    prompt, setPrompt, promptRef,
    modelKey, setModelKey, activeModels, aspectRatio, setAspectRatio,
    durationSec, setDurationSec, resolution, setResolution, resolutionOptions, showResolutionPicker,
    isBusy, isGenerating, compressing, submit, costEstimate,
    videoRuns, latestRun, stageRun, setStageRun, handleRun, resetForm,
  } = ctrl

  function onPromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!isBusy && modelKey && prompt.trim() && !isGenerating) handleRun()
    }
  }

  // The staged run — its live status comes from latestRun when it's the same id.
  const staged: PlaygroundRun | null =
    stageRun && latestRun && stageRun.id === latestRun.id ? latestRun : stageRun
  const stageBusy = submit.isPending && !staged
  const stageUrl = staged?.resultUrls?.[0] ?? null
  const stageGenerating = staged?.status === 'pending' || staged?.status === 'running'

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── LEFT: params ── */}
      {/* 2026-07-10 — column widens on large screens + the prompt textarea
          grew (rows 5→9) and is user-resizable; at rows=5 long prompts were
          unreadably cramped on common resolutions (user report). */}
      <div className="flex w-[340px] flex-shrink-0 flex-col overflow-y-auto border-r border-stone-800 p-4 xl:w-[400px] 2xl:w-[440px]">
        <div className="mb-3 font-mono text-[12px] uppercase tracking-wider text-stone-500">生成設定</div>

        <textarea
          ref={promptRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onPromptKeyDown}
          rows={9}
          placeholder="描述你想生成的影片場景與動作... 用 @image1 引用參考素材"
          className="mb-4 min-h-[140px] w-full resize-y rounded-lg border border-stone-800 bg-stone-950/60 p-3 text-[14px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40"
        />

        <div className="mb-4">
          <ReferencePanel ctrl={ctrl} />
        </div>

        {ctrl.isKlingO3Model ? (
          <div className="mb-4">
            <ElementBindingsPanel ctrl={ctrl} />
          </div>
        ) : null}

        {/* Model */}
        <label className="mb-3 block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-stone-500">模型</span>
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            disabled={isBusy || activeModels.length === 0}
            className="w-full truncate rounded-sm border border-stone-800 bg-stone-900 px-2 py-1.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40 disabled:opacity-50"
          >
            {activeModels.length === 0 ? <option value="">尚無啟用的影片模型 — 請到 /profile 啟用</option> : null}
            {activeModels.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
          </select>
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-stone-500">比例</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              disabled={isBusy}
              className="w-full rounded-sm border border-stone-800 bg-stone-900 px-2 py-1.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
            >
              {/* Kling O3 schema enum is 16:9/9:16/1:1 only — offering 4:3
                  etc. produced a provider 400. (2026-07-10 review HIGH-2) */}
              {(ctrl.isKlingO3Model
                ? ASPECT_RATIO_OPTIONS.filter((opt) => (KLING_O3_ASPECT_RATIO_VALUES as readonly string[]).includes(opt.value))
                : ASPECT_RATIO_OPTIONS
              ).map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-stone-500">時長</span>
            <select
              value={durationSec}
              onChange={(e) => setDurationSec(Number.parseInt(e.target.value, 10) || 5)}
              disabled={isBusy}
              className="w-full rounded-sm border border-stone-800 bg-stone-900 px-2 py-1.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
            >
              {Array.from({ length: 11 }, (_, i) => 5 + i).map((sec) => (<option key={sec} value={sec}>{sec}s</option>))}
            </select>
          </label>
        </div>

        {showResolutionPicker ? (
          <label className="mb-3 block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-stone-500">解析度</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              disabled={isBusy}
              className="w-full rounded-sm border border-stone-800 bg-stone-900 px-2 py-1.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
            >
              {resolutionOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
            </select>
          </label>
        ) : null}

        <div className="mt-auto space-y-2 pt-3">
          <div className="flex items-center justify-between" title={costEstimate.data?.detail ?? '尚無計費資訊'}>
            <span className="font-mono text-[10px] uppercase tracking-wider text-stone-600">估算成本</span>
            <span className="font-mono text-[13px] text-amber-300">
              {typeof costEstimate.data?.amountUsd === 'number'
                ? `≈ $${costEstimate.data.amountUsd.toFixed(costEstimate.data.amountUsd < 1 ? 4 : 2)}`
                : '—'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetForm}
              disabled={isBusy}
              className="rounded-sm border border-stone-800 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-stone-500 hover:border-stone-600 hover:text-stone-300 disabled:opacity-40"
            >
              重置
            </button>
            <button
              type="button"
              onClick={() => handleRun()}
              disabled={isBusy || !modelKey || !prompt.trim() || isGenerating}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 py-2 font-mono text-[13px] font-semibold uppercase tracking-wider text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {compressing ? '壓縮…' : submit.isPending ? '提交中…' : isGenerating ? '生成中…' : '生成'}
              <span className="rounded-sm border border-stone-950/30 px-1 font-mono text-[10px] opacity-70">⌘+↵</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── CENTRE: stage + history ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-3xl items-center justify-center">
            {stageBusy || stageGenerating ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-md border border-stone-800 bg-stone-900/40 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
                  <div className="font-mono text-[13px] uppercase tracking-wider text-amber-300">
                    {stageBusy ? '提交中…' : staged?.status === 'pending' ? '排隊中' : '生成中'}
                  </div>
                  <div className="max-w-md px-6 font-serif-cn text-[12px] leading-relaxed text-stone-400">
                    影片生成大約需要 1-3 分鐘，可保持此頁面開啟。完成後會自動顯示。
                  </div>
                </div>
              </div>
            ) : staged?.status === 'failed' ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-md border border-stone-800 bg-stone-900/40 p-8 text-center">
                <div>
                  <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-rose-400">生成失敗</div>
                  <div className="font-mono text-[11px] text-stone-500" title={staged.errorMessage ?? undefined}>
                    {resolveErrorDisplay({ message: staged.errorMessage })?.message ?? staged.errorMessage ?? '未知錯誤'}
                  </div>
                </div>
              </div>
            ) : stageUrl ? (
              <video src={stageUrl} controls playsInline className="max-h-[62vh] w-full rounded-md object-contain" />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center rounded-md border border-dashed border-stone-800 text-center">
                <AppIcon name="play" className="h-10 w-10 text-stone-700" />
                <div className="mt-3 font-mono text-[12px] uppercase tracking-wider text-stone-500">左側設定後按「生成」</div>
              </div>
            )}
          </div>
        </div>

        {/* History strip */}
        <div className="mt-4">
          <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-stone-500">最近生成（{videoRuns.length}）</div>
          {videoRuns.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {videoRuns.map((run) => {
                const u = run.resultUrls?.[0]
                const active = staged?.id === run.id
                return (
                  <button
                    type="button"
                    key={run.id}
                    onClick={() => setStageRun(run)}
                    title={run.prompt.slice(0, 80)}
                    className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-sm border bg-stone-900 transition-all ${
                      active ? 'border-amber-500/60' : 'border-stone-800 hover:border-violet-500/40'
                    }`}
                  >
                    {u ? (
                      <>
                        <video src={u} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[12px] text-white/80">▶</div>
                      </>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-stone-500">
                        {run.status === 'failed' ? '✕' : '▶'}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-stone-800 px-3 py-3 font-mono text-[10px] uppercase tracking-wider text-stone-600">尚無影片</div>
          )}
        </div>
      </div>

      {/* ── RIGHT: detail rail ── */}
      <div className="flex w-[300px] flex-shrink-0 flex-col overflow-y-auto border-l border-stone-800 p-4">
        <div className="mb-3 font-mono text-[12px] uppercase tracking-wider text-stone-500">影片詳情</div>
        {staged ? (
          <>
            <div className="mb-4 rounded-sm border border-stone-800 bg-stone-900/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500">描述詞</span>
                <button
                  type="button"
                  onClick={() => ctrl.copyPrompt(staged.prompt)}
                  className="rounded-sm border border-stone-700 px-2 py-0.5 font-mono text-[10px] text-stone-400 hover:border-amber-500/60 hover:text-amber-300"
                >
                  {ctrl.promptCopied ? '✓ 已複製' : '複製'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-serif-cn text-[12px] leading-relaxed text-stone-400">
                {staged.prompt || '（此筆無描述詞紀錄）'}
              </div>
            </div>

            <div className="mb-4 space-y-1.5 font-mono text-[11px] text-stone-500">
              <div className="flex justify-between gap-2"><span className="text-stone-600">模型</span><span className="truncate text-stone-300">{staged.modelKey || '—'}</span></div>
              <div className="flex justify-between gap-2"><span className="text-stone-600">狀態</span><span className="text-stone-300">{staged.status === 'succeeded' ? '已完成' : staged.status === 'failed' ? '失敗' : staged.status === 'running' ? '生成中' : '排隊中'}</span></div>
              <div className="flex justify-between gap-2"><span className="text-stone-600">建立</span><span className="text-stone-300">{new Date(staged.createdAt).toLocaleString('zh-TW', { hour12: false })}</span></div>
            </div>

            <div className="mt-auto space-y-2">
              {stageUrl ? (
                <a href={playgroundDownloadHref(stageUrl, `kuiperai-${staged.id}`)} download className="flex w-full items-center justify-center gap-2 rounded-sm border border-stone-700 py-2 font-mono text-[12px] uppercase tracking-wider text-stone-300 hover:border-amber-500/60 hover:text-amber-300">↓ 下載</a>
              ) : null}
              <button
                type="button"
                onClick={() => ctrl.editPrompt(staged.prompt)}
                disabled={isBusy || !staged.prompt}
                className="w-full rounded-sm bg-amber-500 py-2 font-mono text-[12px] font-semibold uppercase tracking-wider text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                帶回設定修改
              </button>
            </div>
          </>
        ) : (
          <div className="font-mono text-[11px] text-stone-600">選一支影片查看詳情</div>
        )}
      </div>
    </div>
  )
}

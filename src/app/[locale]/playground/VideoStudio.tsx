'use client'

/**
 * Video studio — heavier, review-focused 3-column layout (Higgsfield model),
 * because video generation is param-rich, slow and expensive:
 *   LEFT   params column  — prompt + references + model + duration/resolution
 *                           + aspect + cost + Generate
 *   CENTRE stage          — the selected/active video, large; history strip below
 *   RIGHT  detail rail     — the staged run's model / prompt(+copy) / actions
 * Uses the shared Kuiper production surface while preserving the
 * parameter-heavy three-column workflow.
 */

import { useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { ElementsModal } from './ElementsModal'
import { KLING_O3_ASPECT_RATIO_VALUES } from './useKlingElements'
import { PromptComposer, type AtMenuCandidate } from './PromptComposer'
import { FramesMediaModule, RefVideoSlot, SeedanceMediaModule } from './VideoMediaModules'
import { ASPECT_RATIO_OPTIONS, playgroundDownloadHref, type PlaygroundController, type PlaygroundRun } from './usePlaygroundController'

interface VideoStudioProps {
  ctrl: PlaygroundController
}

export function VideoStudio({ ctrl }: VideoStudioProps) {
  const {
    prompt,
    modelKey, setModelKey, activeModels, aspectRatio, setAspectRatio,
    durationSec, setDurationSec, resolution, setResolution, resolutionOptions, showResolutionPicker,
    soundOn, setSoundOn,
    isBusy, isGenerating, compressing, submit, costEstimate,
    videoRuns, latestRun, stageRun, setStageRun, handleRun, resetForm,
  } = ctrl

  // Bound subject names in BINDING ORDER — Kling: 主體 cards first, then
  // NAMED reference images (mirrors mergeNamedRefImagesIntoElements);
  // non-Kling video: named images bind via the 參考圖對應 map. Drives the
  // in-prompt highlight so users see exactly what will bind on submit.
  const boundNames = useMemo(() => {
    const named = ctrl.refImages.filter((r) => r.name?.trim()).map((r) => (r.name as string).trim())
    return ctrl.isKlingO3Model
      ? [...ctrl.elements.map((el) => el.name.trim()).filter(Boolean), ...named]
      : named
  }, [ctrl.refImages, ctrl.elements, ctrl.isKlingO3Model])
  // @-menu candidates per family: subjects insert their NAME (the typed @
  // gets swallowed on submit); seedance also offers positional tokens.
  const atCandidates = useMemo<AtMenuCandidate[]>(() => {
    if (ctrl.modelFamily === 'kling-o3') {
      return boundNames.map((name, i) => ({ label: name, insert: name, colorIndex: i }))
    }
    if (ctrl.modelFamily === 'seedance') {
      const named = boundNames.map((name, i) => ({ label: name, insert: name, colorIndex: i as number | null }))
      const imageTokens = ctrl.refImages.map((_, i) => ({ label: `@image${i + 1}`, insert: `image${i + 1}`, colorIndex: null }))
      const videoToken = ctrl.refVideo ? [{ label: '@video1', insert: 'video1', colorIndex: null }] : []
      return [...named, ...imageTokens, ...videoToken]
    }
    return []
  }, [ctrl.modelFamily, boundNames, ctrl.refImages, ctrl.refVideo])
  const [elementsOpen, setElementsOpen] = useState(false)

  // The staged run — its live status comes from latestRun when it's the same id.
  const staged: PlaygroundRun | null =
    stageRun && latestRun && stageRun.id === latestRun.id ? latestRun : stageRun
  const stageBusy = submit.isPending && !staged
  const stageUrl = staged?.resultUrls?.[0] ?? null
  const stageGenerating = staged?.status === 'pending' || staged?.status === 'running'

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-canvas">
      {/* ── LEFT: params ── */}
      {/* 2026-07-10 — column widens on large screens + the prompt textarea
          grew (rows 5→9) and is user-resizable; at rows=5 long prompts were
          unreadably cramped on common resolutions (user report). */}
      <div className="flex w-[340px] flex-shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-raised/70 p-4 xl:w-[400px] 2xl:w-[440px]">
        <div className="mb-3 font-mono text-[10px] tracking-[0.16em] text-text-tertiary">生成設定</div>

        <PromptComposer
          ctrl={ctrl}
          candidates={atCandidates}
          boundNames={boundNames}
          onSubmitShortcut={() => {
            if (!isBusy && modelKey && prompt.trim() && !isGenerating) handleRun()
          }}
        />

        {/* ── per-family media module ── */}
        {ctrl.modelFamily === 'kling-o3' ? (
          <div className="mb-4 space-y-3">
            <button
              type="button"
              onClick={() => setElementsOpen(true)}
              className="flex w-full items-center justify-between rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2 hover:border-primary-500/40"
            >
              <span className="flex items-center gap-2 font-mono text-[12px] text-stone-300">
                <span className="text-primary-400">@</span> Elements
                <span className="text-stone-500">主體綁定</span>
              </span>
              <span className="font-mono text-[11px] text-primary-300">{ctrl.elements.length}/6</span>
            </button>
            {ctrl.elements.length === 0 ? (
              <div className="font-serif-cn text-[11px] leading-relaxed text-stone-600">
                人物 / 場景各建一個主體，prompt 打 @ 或直接打名字即可綁定
              </div>
            ) : null}
            <RefVideoSlot ctrl={ctrl} />
          </div>
        ) : ctrl.modelFamily === 'seedance' ? (
          <div className="mb-4">
            <SeedanceMediaModule ctrl={ctrl} />
          </div>
        ) : (
          <div className="mb-4">
            <FramesMediaModule ctrl={ctrl} />
          </div>
        )}

        {/* Model */}
        <label className="mb-3 block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-stone-500">模型</span>
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            disabled={isBusy || activeModels.length === 0}
            className="w-full truncate rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-text-secondary outline-none focus:border-primary-500/40 disabled:opacity-50"
          >
            {activeModels.length === 0 ? <option value="">尚無啟用的影片模型 — 請到 /profile 啟用</option> : null}
            {activeModels.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
          </select>
        </label>

        {/* ── compact chips row: 時長 / 比例 / 解析度 / 🔊 ── */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <select
            value={durationSec}
            onChange={(e) => setDurationSec(Number.parseInt(e.target.value, 10) || 5)}
            disabled={isBusy}
            title="時長"
            className="rounded-xl border border-white/[0.09] bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-text-secondary outline-none hover:border-white/[0.16] focus:border-primary-500/40"
          >
            {Array.from({ length: 11 }, (_, i) => 5 + i).map((sec) => (<option key={sec} value={sec}>{sec}s</option>))}
          </select>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            disabled={isBusy}
            title="比例"
            className="rounded-xl border border-white/[0.09] bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-text-secondary outline-none hover:border-white/[0.16] focus:border-primary-500/40"
          >
            {/* Kling O3 schema enum is 16:9/9:16/1:1 only (2026-07-10 HIGH-2) */}
            {(ctrl.isKlingO3Model
              ? ASPECT_RATIO_OPTIONS.filter((opt) => (KLING_O3_ASPECT_RATIO_VALUES as readonly string[]).includes(opt.value))
              : ASPECT_RATIO_OPTIONS
            ).map((opt) => (<option key={opt.value} value={opt.value}>{opt.value}</option>))}
          </select>
          {showResolutionPicker ? (
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              disabled={isBusy}
              title="解析度"
              className="rounded-xl border border-white/[0.09] bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-text-secondary outline-none hover:border-white/[0.16] focus:border-primary-500/40"
            >
              {resolutionOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={() => setSoundOn(!soundOn)}
            disabled={isBusy}
            title={soundOn ? '音效：開（點擊關閉）' : '音效：關（點擊開啟）'}
            className={`rounded-md border px-2 py-1.5 font-mono text-[12px] transition-colors ${
              soundOn
                ? 'border-primary-500/50 bg-primary-500/10 text-primary-300'
                : 'border-white/[0.09] text-text-tertiary hover:text-text-primary'
            }`}
          >
            🔊 {soundOn ? 'On' : 'Off'}
          </button>
        </div>

        <div className="mt-auto space-y-2 pt-3">
          <div className="flex items-center justify-between" title={costEstimate.data?.detail ?? '尚無計費資訊'}>
            <span className="font-mono text-[10px] uppercase tracking-wider text-stone-600">估算成本</span>
            <span className="font-mono text-[11px] text-editorial-400">
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
              className="rounded-xl border border-white/[0.09] px-3 py-2 font-mono text-[10px] tracking-wider text-text-tertiary hover:border-white/[0.16] hover:text-text-primary disabled:opacity-40"
            >
              重置
            </button>
            <button
              type="button"
              onClick={() => handleRun()}
              disabled={isBusy || !modelKey || !prompt.trim() || isGenerating}
              className="kuiper-primary-button flex flex-1 items-center justify-center gap-2 rounded-xl py-2 font-mono text-[11px] font-semibold tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
            >
              {compressing ? '壓縮…' : submit.isPending ? '提交中…' : isGenerating ? '生成中…' : '生成'}
              <span className="rounded-sm border border-stone-950/30 px-1 font-mono text-[10px] opacity-70">⌘+↵</span>
            </button>
          </div>
        </div>
      </div>

      <ElementsModal ctrl={ctrl} open={elementsOpen} onClose={() => setElementsOpen(false)} />

      {/* ── CENTRE: stage + history ── */}
      <div className="kuiper-canvas-grid flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-3xl items-center justify-center">
            {stageBusy || stageGenerating ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-white/[0.08] bg-raised text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500/25 border-t-primary-400" />
                  <div className="font-mono text-[11px] tracking-wider text-primary-300">
                    {stageBusy ? '提交中…' : staged?.status === 'pending' ? '排隊中' : '生成中'}
                  </div>
                  <div className="max-w-md px-6 font-serif-cn text-[12px] leading-relaxed text-stone-400">
                    影片生成大約需要 1-3 分鐘，可保持此頁面開啟。完成後會自動顯示。
                  </div>
                </div>
              </div>
            ) : staged?.status === 'failed' ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-white/[0.08] bg-raised p-8 text-center">
                <div>
                  <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-rose-400">生成失敗</div>
                  <div className="font-mono text-[11px] text-stone-500" title={staged.errorMessage ?? undefined}>
                    {resolveErrorDisplay({ message: staged.errorMessage })?.message ?? staged.errorMessage ?? '未知錯誤'}
                  </div>
                </div>
              </div>
            ) : stageUrl ? (
              <video src={stageUrl} controls playsInline className="max-h-[62vh] w-full rounded-2xl border border-white/[0.08] bg-black object-contain" />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-raised/60 text-center">
                <AppIcon name="play" className="h-10 w-10 text-text-tertiary" />
                <div className="mt-3 font-mono text-[10px] tracking-wider text-text-tertiary">左側設定後按「生成」</div>
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
                    className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border bg-raised transition-all ${
                      active ? 'border-primary-500/60' : 'border-white/[0.08] hover:border-accent-500/40'
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
            <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-3 font-mono text-[10px] tracking-wider text-text-tertiary">尚無影片</div>
          )}
        </div>
      </div>

      {/* ── RIGHT: detail rail ── */}
      <div className="flex w-[300px] flex-shrink-0 flex-col overflow-y-auto border-l border-white/[0.07] bg-raised/70 p-4">
        <div className="mb-3 font-mono text-[10px] tracking-[0.16em] text-text-tertiary">影片詳情</div>
        {staged ? (
          <>
            <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500">描述詞</span>
                <button
                  type="button"
                  onClick={() => ctrl.copyPrompt(staged.prompt)}
                  className="rounded-lg border border-white/[0.09] px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:border-primary-500/50 hover:text-primary-300"
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
                <a href={playgroundDownloadHref(stageUrl, `kuiperai-${staged.id}`)} download className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] py-2 font-mono text-[11px] tracking-wider text-text-secondary hover:border-primary-500/50 hover:text-primary-300">↓ 下載</a>
              ) : null}
              <button
                type="button"
                onClick={() => ctrl.editPrompt(staged.prompt)}
                disabled={isBusy || !staged.prompt}
                className="kuiper-primary-button w-full rounded-xl py-2 font-mono text-[11px] font-semibold tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
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

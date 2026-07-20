'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { MaskAnalysisProgress } from './live-composite-types'

export type AiMaskEngine = 'rvm' | 'selfie'

export interface AiMaskSettings {
  engine: AiMaskEngine
  interval: number
  threshold: number
  edgeSoftness: number
  /** 深度淨化：以深度圖在關鍵影格 commit 時排除與人物不同距離的誤判。 */
  depthCleanup: boolean
}

interface AiMaskPanelProps {
  canAnalyze: boolean
  currentTime: number
  progress: MaskAnalysisProgress
  onAnalyzeCurrent: (settings: AiMaskSettings) => void
  onAnalyzeClip: (settings: AiMaskSettings) => void
  onCancel: () => void
}

export function AiMaskPanel({
  canAnalyze,
  currentTime,
  progress,
  onAnalyzeCurrent,
  onAnalyzeClip,
  onCancel,
}: AiMaskPanelProps) {
  const [engine, setEngine] = useState<AiMaskEngine>('rvm')
  const [interval, setIntervalValue] = useState(1)
  const [threshold, setThreshold] = useState(0.5)
  const [edgeSoftness, setEdgeSoftness] = useState(0.12)
  const [depthCleanup, setDepthCleanup] = useState(true)
  const busy = progress.status === 'loading-model' || progress.status === 'analyzing'
  const settings: AiMaskSettings = { engine, interval, threshold, edgeSoftness, depthCleanup }
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0

  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">AI 人物遮罩</div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">本機運算</span>
      </div>

      <div className="mt-3 space-y-3">
        <label className="block text-xs text-stone-500">
          引擎
          <select
            aria-label="AI 遮罩引擎"
            value={engine}
            disabled={busy}
            onChange={(event) => setEngine(event.target.value as AiMaskEngine)}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-stone-300"
          >
            <option value="rvm">RVM（推薦・逐幀時序）</option>
            <option value="selfie">Selfie Segmenter（舊版・單幀）</option>
          </select>
        </label>

        <label className="block text-xs text-stone-500">
          取樣間隔
          <select
            aria-label="AI 遮罩取樣間隔"
            value={interval}
            disabled={busy}
            onChange={(event) => setIntervalValue(Number(event.target.value))}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-stone-300"
          >
            <option value={0.25}>0.25 秒（精細追蹤）</option>
            <option value={0.5}>0.5 秒（較細緻）</option>
            <option value={1}>1 秒（建議）</option>
            <option value={2}>2 秒（較快速）</option>
          </select>
        </label>

        <label className="block text-xs text-stone-500">
          人物信心門檻 <span className="float-right font-mono text-stone-300">{threshold.toFixed(2)}</span>
          <input
            aria-label="人物信心門檻"
            type="range"
            min={0.2}
            max={0.8}
            step={0.05}
            value={threshold}
            disabled={busy}
            onChange={(event) => setThreshold(Number(event.target.value))}
            className="mt-2 w-full accent-violet-400"
          />
        </label>

        {engine === 'rvm' ? (
          <p className="text-[11px] leading-5 text-stone-600">
            RVM 模式：門檻是透明度下限——低於門檻的像素會被去除，高於門檻保留模型原生的柔和邊緣（頭髮絲、動態模糊）；邊緣柔化只在門檻附近再加羽化。
          </p>
        ) : null}

        <label className="block text-xs text-stone-500">
          邊緣柔化 <span className="float-right font-mono text-stone-300">{edgeSoftness.toFixed(2)}</span>
          <input
            aria-label="AI 遮罩邊緣柔化"
            type="range"
            min={0}
            max={0.25}
            step={0.01}
            value={edgeSoftness}
            disabled={busy}
            onChange={(event) => setEdgeSoftness(Number(event.target.value))}
            className="mt-2 w-full accent-violet-400"
          />
        </label>

        <label className="flex items-start gap-2 text-xs text-stone-400">
          <input
            aria-label="深度淨化"
            type="checkbox"
            checked={depthCleanup}
            disabled={busy}
            onChange={(event) => setDepthCleanup(event.target.checked)}
            className="mt-0.5 accent-violet-400"
          />
          <span>
            深度淨化
            <span className="mt-0.5 block text-[11px] leading-5 text-stone-600">
              以深度圖排除與人物不同距離的誤判（建築/遠景）；深度帶不可靠時該影格自動跳過不裁切
            </span>
          </span>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canAnalyze || busy}
          onClick={() => onAnalyzeCurrent(settings)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-violet-400/30 px-2 py-2 text-xs text-violet-200 hover:bg-violet-400/10 disabled:opacity-30"
        >
          <AppIcon name="scanLine" className="h-3.5 w-3.5" />目前影格 {currentTime.toFixed(1)}s
        </button>
        <button
          type="button"
          disabled={!canAnalyze || busy}
          onClick={() => onAnalyzeClip(settings)}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-violet-400 px-2 py-2 text-xs font-medium text-stone-950 hover:bg-violet-300 disabled:opacity-30"
        >
          <AppIcon name="sparkles" className="h-3.5 w-3.5" />掃描整段影片
        </button>
      </div>

      {busy ? (
        <div className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] p-3">
          <div className="flex items-center justify-between text-xs text-violet-200">
            <span>{progress.message}</span>
            <span className="font-mono">{percentage}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-violet-400 transition-[width]" style={{ width: `${percentage}%` }} />
          </div>
          <button type="button" onClick={onCancel} className="mt-2 text-xs text-stone-500 hover:text-white">分析完目前影格後取消</button>
        </div>
      ) : progress.message ? (
        <p role={progress.status === 'failed' ? 'alert' : 'status'} className={`mt-3 text-xs leading-5 ${progress.status === 'failed' ? 'text-red-300' : 'text-stone-500'}`}>
          {progress.message}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] leading-5 text-stone-600">影片不會上傳；模型（含深度淨化的深度分析）都在瀏覽器內運算。RVM 會從頭到尾逐幀掃描一次以保持時間穩定；深度淨化只在每個關鍵影格運算一次；0.25 秒模式適合快速動作，分析影格仍受本機安全上限保護。完成後可用保留／移除畫筆修邊。</p>
    </section>
  )
}

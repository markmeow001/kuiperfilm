'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { MaskAnalysisProgress } from './live-composite-types'

export interface AiMaskSettings {
  interval: number
  threshold: number
  edgeSoftness: number
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
  const [interval, setIntervalValue] = useState(1)
  const [threshold, setThreshold] = useState(0.5)
  const [edgeSoftness, setEdgeSoftness] = useState(0.12)
  const busy = progress.status === 'loading-model' || progress.status === 'analyzing'
  const settings = { interval, threshold, edgeSoftness }
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0

  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">AI 人物遮罩</div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">本機運算</span>
      </div>

      <div className="mt-3 space-y-3">
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

      <p className="mt-2 text-[11px] leading-5 text-stone-600">影片不會上傳；模型在瀏覽器內取樣人物輪廓。0.25 秒模式適合快速動作，分析影格仍受本機安全上限保護。完成後可用保留／移除畫筆修邊。</p>
    </section>
  )
}

'use client'

import { AppIcon } from '@/components/ui/icons'
import {
  computeExpressionPeak,
  detectFaceProblemTimecodes,
  type FacePerformanceTrack,
} from './lib/face-performance'
import type { MaskAnalysisProgress } from './live-composite-types'

interface FacePerformancePanelProps {
  canAnalyze: boolean
  progress: MaskAnalysisProgress
  track: FacePerformanceTrack | null
  onAnalyze: () => void
  onCancel: () => void
  onClear: () => void
}

function formatTimecodes(times: number[], cap = 6): string {
  const shown = times.slice(0, cap).map((time) => `${time.toFixed(2)}s`).join('、')
  return times.length > cap ? `${shown}⋯（共 ${times.length} 處）` : shown
}

export function FacePerformancePanel({ canAnalyze, progress, track, onAnalyze, onCancel, onClear }: FacePerformancePanelProps) {
  const busy = progress.status === 'loading-model' || progress.status === 'analyzing'
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
  const detectedCount = track ? track.samples.filter((sample) => sample.faceBox !== null).length : 0
  const missingTimes = track ? track.samples.filter((sample) => sample.faceBox === null).map((sample) => sample.time) : []
  const problemTimes = track ? detectFaceProblemTimecodes(track) : []
  const jawPeak = track ? computeExpressionPeak(track, ['jawOpen']) : null
  const smilePeak = track ? computeExpressionPeak(track, ['mouthSmileLeft', 'mouthSmileRight']) : null

  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">臉部表演分析</div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">本機運算</span>
      </div>

      <p className="mt-2 text-[11px] leading-5 text-stone-600">在瀏覽器內擷取臉部位置與表情變化，用於穩定臉部裁切、表情比較與問題時間碼；資料不會送往生成服務。</p>

      <button
        type="button"
        disabled={!canAnalyze || busy}
        onClick={onAnalyze}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-400 px-2 py-2 text-xs font-medium text-stone-950 hover:bg-teal-300 disabled:opacity-30"
      >
        <AppIcon name="sparkles" className="h-3.5 w-3.5" />分析臉部表演
      </button>

      {busy ? (
        <div className="mt-3 rounded-lg border border-teal-400/20 bg-teal-400/[0.06] p-3">
          <div className="flex items-center justify-between text-xs text-teal-200">
            <span>{progress.message}</span>
            <span className="font-mono">{percentage}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-teal-400 transition-[width]" style={{ width: `${percentage}%` }} />
          </div>
          <button type="button" onClick={onCancel} className="mt-2 text-xs text-stone-500 hover:text-white">取消臉部分析</button>
        </div>
      ) : progress.message ? (
        <p role={progress.status === 'failed' ? 'alert' : 'status'} className={`mt-3 text-xs leading-5 ${progress.status === 'failed' ? 'text-red-300' : 'text-stone-500'}`}>
          {progress.message}
        </p>
      ) : null}

      {track && !busy ? (
        <div className="mt-3 space-y-1.5 rounded-lg bg-black/30 p-3 text-[11px] leading-5 text-stone-500">
          <div className="flex justify-between">
            <span>偵測影格</span>
            <span className="font-mono text-stone-300">{detectedCount} / {track.samples.length}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="shrink-0">漏檢時間碼</span>
            <span className={`text-right font-mono ${missingTimes.length ? 'text-amber-300' : 'text-emerald-300'}`}>{missingTimes.length ? formatTimecodes(missingTimes) : '無'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="shrink-0">問題時間碼</span>
            <span className={`text-right font-mono ${problemTimes.length ? 'text-amber-300' : 'text-emerald-300'}`}>{problemTimes.length ? formatTimecodes(problemTimes) : '無'}</span>
          </div>
          {jawPeak ? (
            <div className="flex justify-between">
              <span>嘴巴張最開</span>
              <span className="font-mono text-stone-300">{jawPeak.time.toFixed(2)}s（{jawPeak.value.toFixed(2)}）</span>
            </div>
          ) : null}
          {smilePeak ? (
            <div className="flex justify-between">
              <span>笑容最明顯</span>
              <span className="font-mono text-stone-300">{smilePeak.time.toFixed(2)}s（{smilePeak.value.toFixed(2)}）</span>
            </div>
          ) : null}
          <button type="button" disabled={!canAnalyze} onClick={onClear} className="text-stone-600 hover:text-red-300 disabled:opacity-40">清除臉部表演資料</button>
        </div>
      ) : null}
    </section>
  )
}

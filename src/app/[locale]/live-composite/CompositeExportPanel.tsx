'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { CompositeExportProgress } from './live-composite-types'

interface CompositeExportPanelProps {
  canExport: boolean
  progress: CompositeExportProgress
  onExportMask: () => void
  onExportFrame: () => void
  onExportVideo: (includeAudio: boolean) => void
  onCancelVideo: () => void
}

export function CompositeExportPanel({
  canExport,
  progress,
  onExportMask,
  onExportFrame,
  onExportVideo,
  onCancelVideo,
}: CompositeExportPanelProps) {
  const [includeAudio, setIncludeAudio] = useState(true)
  const isExporting = progress.status === 'preparing' || progress.status === 'recording'
  const progressPercent = progress.duration > 0
    ? Math.min(100, Math.round((progress.currentTime / progress.duration) * 100))
    : 0

  return (
    <div className="mt-auto border-t border-white/10 px-4 py-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-stone-500">輸出</div>
      <div className="space-y-2">
        <button type="button" disabled={!canExport || isExporting} onClick={onExportMask} className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-stone-300 hover:bg-white/[0.06] disabled:opacity-30">
          <AppIcon name="scanLine" className="h-4 w-4" />下載遮罩 PNG
        </button>
        <button type="button" disabled={!canExport || isExporting} onClick={onExportFrame} className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-stone-300 hover:bg-white/[0.06] disabled:opacity-30">
          <AppIcon name="image" className="h-4 w-4" />下載目前合成影格
        </button>

        <label className="flex items-center gap-2 px-1 py-1 text-xs text-stone-400">
          <input
            type="checkbox"
            checked={includeAudio}
            disabled={isExporting}
            onChange={(event) => setIncludeAudio(event.target.checked)}
            className="accent-cyan-400"
          />
          保留實拍影片原音
        </label>

        {isExporting ? (
          <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] p-3">
            <div className="flex items-center justify-between text-xs text-cyan-100">
              <span>{progress.message}</span>
              <span className="font-mono">{progressPercent}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-cyan-400 transition-[width]" style={{ width: `${progressPercent}%` }} />
            </div>
            <button type="button" onClick={onCancelVideo} className="mt-3 w-full rounded-md border border-white/10 px-3 py-1.5 text-xs text-stone-300 hover:bg-white/[0.06]">
              取消輸出
            </button>
          </div>
        ) : (
          <button type="button" disabled={!canExport} onClick={() => onExportVideo(includeAudio)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-medium text-stone-950 hover:bg-cyan-300 disabled:opacity-30">
            <AppIcon name="download" className="h-4 w-4" />輸出完整合成影片
          </button>
        )}

        {progress.status === 'completed' || progress.status === 'failed' ? (
          <p role="status" className={`text-xs leading-5 ${progress.status === 'failed' ? 'text-red-300' : 'text-emerald-300'}`}>
            {progress.message}
          </p>
        ) : null}
        <p className="text-[11px] leading-4 text-stone-600">本機即時錄製，輸出時間約等於影片長度；影片不會上傳伺服器。</p>
      </div>
    </div>
  )
}

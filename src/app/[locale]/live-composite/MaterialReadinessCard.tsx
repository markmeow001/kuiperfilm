'use client'

import { useMemo } from 'react'
import type { FacePerformanceTrack } from './lib/face-performance'
import {
  assessMaterialReadiness,
  buildReferenceMappingPreview,
  type MaterialReadinessStatus,
  type MaterialReadinessVerdict,
} from './lib/material-readiness'
import type { VideoMetadata } from './live-composite-types'

interface MaterialReadinessCardProps {
  metadata: VideoMetadata | null
  /** null＝瀏覽器無法偵測音訊軌。 */
  videoHasAudio: boolean | null
  faceTrack: FacePerformanceTrack | null
}

const STATUS_PRESENTATION: Record<MaterialReadinessStatus, { marker: string; className: string }> = {
  pass: { marker: '✓', className: 'text-emerald-300' },
  warn: { marker: '⚠', className: 'text-amber-300' },
  fail: { marker: '✗', className: 'text-red-300' },
  unknown: { marker: '?', className: 'text-stone-500' },
}

const VERDICT_PRESENTATION: Record<MaterialReadinessVerdict, { label: string; className: string }> = {
  ready: { label: '符合規格', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' },
  warn: { label: '需注意', className: 'border-amber-400/20 bg-amber-400/10 text-amber-300' },
  fail: { label: '不符合規格', className: 'border-red-400/20 bg-red-400/10 text-red-300' },
}

export function MaterialReadinessCard({ metadata, videoHasAudio, faceTrack }: MaterialReadinessCardProps) {
  const report = useMemo(() => {
    if (!metadata) return null
    return assessMaterialReadiness({
      durationSec: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      hasAudio: videoHasAudio,
      faceTrack,
    })
  }, [metadata, videoHasAudio, faceTrack])

  const mappingPreview = useMemo(
    () => (metadata ? buildReferenceMappingPreview(metadata.duration) : []),
    [metadata],
  )

  if (!metadata || !report) return null

  const verdict = VERDICT_PRESENTATION[report.verdict]

  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">表演素材體檢報告</div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${verdict.className}`}>{verdict.label}</span>
      </div>

      <p className="mt-2 text-[11px] leading-5 text-stone-500">{report.summary}</p>

      <ul className="mt-3 space-y-2 rounded-lg bg-black/30 p-3">
        {report.rows.map((row) => {
          const presentation = STATUS_PRESENTATION[row.status]
          return (
            <li key={row.key} className="flex gap-2 text-[11px] leading-5">
              <span aria-hidden className={`w-4 shrink-0 text-center font-mono ${presentation.className}`}>
                {presentation.marker}
              </span>
              <div className="min-w-0">
                <span className={`font-medium ${presentation.className}`}>{row.label}</span>
                <span className="ml-2 text-stone-400">{row.detail}</span>
              </div>
            </li>
          )
        })}
      </ul>

      <details className="mt-3 rounded-lg border border-white/10">
        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-stone-500 hover:text-stone-300">
          參考素材順序（規劃預覽）▾
        </summary>
        <ul className="space-y-1 border-t border-white/10 px-3 py-2 text-[11px] leading-5 text-stone-500">
          {mappingPreview.map((row) => (
            <li key={row.token} className="flex justify-between gap-3">
              <span className="shrink-0 font-mono text-stone-400">{row.token}</span>
              <span className="min-w-0 text-right">
                {row.role}
                <span className={`ml-1 ${row.note === '本素材' ? 'text-cyan-300' : 'text-stone-600'}`}>（{row.note}）</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

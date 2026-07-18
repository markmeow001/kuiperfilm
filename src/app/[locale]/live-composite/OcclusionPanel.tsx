'use client'

import { AppIcon } from '@/components/ui/icons'

interface OcclusionPanelProps {
  disabled: boolean
  picking: boolean
  busy: boolean
  message: string | null
  keyframeCount: number
  onStartPicking: () => void
  onCancelPicking: () => void
}

export function OcclusionPanel({
  disabled,
  picking,
  busy,
  message,
  keyframeCount,
  onStartPicking,
  onCancelPicking,
}: OcclusionPanelProps) {
  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-300">場景深度遮擋</div>
        <span className="font-mono text-[11px] text-stone-600">{keyframeCount} KF</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-stone-500">點選桌子、門框或其他前景物件，AI 會建立獨立遮擋遮罩；再用上方筆刷補畫或擦除。</p>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={picking ? onCancelPicking : onStartPicking}
        className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-40 ${picking ? 'border-amber-400/60 bg-amber-400/15 text-amber-100' : 'border-amber-400/25 bg-amber-400/[0.06] text-amber-200 hover:bg-amber-400/10'}`}
      >
        <AppIcon name={picking ? 'close' : 'scanLine'} className="h-4 w-4" />
        {busy ? '正在辨識物件…' : picking ? '取消點選物件' : 'AI 點選前景物件'}
      </button>
      {picking ? <div className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/[0.05] px-2.5 py-2 text-[11px] leading-5 text-amber-200">請直接點一下畫面中要擋住虛擬角色的物件。</div> : null}
      {message ? <div role="status" className="mt-2 text-[11px] leading-5 text-stone-400">{message}</div> : null}
    </section>
  )
}

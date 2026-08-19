'use client'

import type { VirtualCharacterLayer } from './live-composite-types'

interface CharacterMotionPanelProps {
  layer: VirtualCharacterLayer
  disabled: boolean
  busy: boolean
  message: string | null
  onChange: (patch: Partial<VirtualCharacterLayer>) => void
  onAnalyzeCurrent: () => void
  onAnalyzeClip: () => void
}

export function CharacterMotionPanel({ layer, disabled, busy, message, onChange, onAnalyzeCurrent, onAnalyzeClip }: CharacterMotionPanelProps) {
  const keyframes = layer.motionKeyframes ?? []
  const lowConfidence = keyframes.filter((keyframe) => keyframe.confidence < 0.55).length
  return (
    <details className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <summary className="flex min-h-11 cursor-pointer items-center rounded-md text-xs font-medium text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">骨架參考動作</summary>
      <div className="mt-3 space-y-3 text-[11px] text-stone-500">
        <p className="leading-5">從實拍人物的肩膀與髖部擷取位移、身體比例與傾斜，驅動整個透明角色圖層。單張圖片不會自動產生四肢變形。</p>
        <label className="flex min-h-11 items-center justify-between rounded-md border border-white/10 px-3 py-2 focus-within:ring-2 focus-within:ring-cyan-300/70"><span>啟用動作驅動</span><input type="checkbox" checked={Boolean(layer.motionEnabled)} disabled={disabled || keyframes.length === 0} onChange={(event) => onChange({ motionEnabled: event.target.checked })} className="h-4 w-4 accent-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" /></label>
        <div className="grid grid-cols-2 gap-2"><button type="button" disabled={disabled || busy} onClick={onAnalyzeCurrent} className="min-h-11 rounded-lg border border-cyan-300/25 px-2 py-2 text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:opacity-40">擷取目前姿勢</button><button type="button" disabled={disabled || busy} onClick={onAnalyzeClip} className="min-h-11 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2 py-2 text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:opacity-40">分析整段動作</button></div>
        <div className="flex justify-between"><span>動作關鍵影格 {keyframes.length}</span><span className={lowConfidence ? 'text-amber-300' : 'text-emerald-300'}>低信心 {lowConfidence}</span></div>
        {message ? <p role="status" className="rounded-md bg-black/20 px-2 py-1.5 text-stone-300">{message}</p> : null}
        {keyframes.length ? <button type="button" disabled={disabled || busy} onClick={() => onChange({ motionEnabled: false, motionKeyframes: [] })} className="min-h-11 rounded-md px-2 text-stone-500 hover:bg-red-300/[0.06] hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">清除動作資料</button> : null}
      </div>
    </details>
  )
}

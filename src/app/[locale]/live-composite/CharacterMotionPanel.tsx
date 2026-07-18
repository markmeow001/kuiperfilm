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
    <details className="rounded-lg border border-fuchsia-400/15 bg-fuchsia-400/[0.03] p-3">
      <summary className="cursor-pointer text-xs font-medium text-fuchsia-200">骨架參考動作</summary>
      <div className="mt-3 space-y-3 text-[11px] text-stone-500">
        <p className="leading-5">從實拍人物的肩膀與髖部擷取位移、身體比例與傾斜，驅動整個透明角色圖層。單張圖片不會自動產生四肢變形。</p>
        <label className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2"><span>啟用動作驅動</span><input type="checkbox" checked={Boolean(layer.motionEnabled)} disabled={disabled || keyframes.length === 0} onChange={(event) => onChange({ motionEnabled: event.target.checked })} className="accent-fuchsia-400" /></label>
        <div className="grid grid-cols-2 gap-2"><button type="button" disabled={disabled || busy} onClick={onAnalyzeCurrent} className="rounded-lg border border-fuchsia-400/25 px-2 py-2 text-fuchsia-200 disabled:opacity-40">擷取目前姿勢</button><button type="button" disabled={disabled || busy} onClick={onAnalyzeClip} className="rounded-lg border border-fuchsia-400/25 bg-fuchsia-400/10 px-2 py-2 text-fuchsia-100 disabled:opacity-40">分析整段動作</button></div>
        <div className="flex justify-between"><span>動作關鍵影格 {keyframes.length}</span><span className={lowConfidence ? 'text-amber-300' : 'text-emerald-300'}>低信心 {lowConfidence}</span></div>
        {message ? <p role="status" className="rounded-md bg-black/20 px-2 py-1.5 text-stone-300">{message}</p> : null}
        {keyframes.length ? <button type="button" disabled={disabled || busy} onClick={() => onChange({ motionEnabled: false, motionKeyframes: [] })} className="text-stone-600 hover:text-red-300">清除動作資料</button> : null}
      </div>
    </details>
  )
}

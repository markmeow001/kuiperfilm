'use client'

import { AppIcon } from '@/components/ui/icons'
import { useMemo } from 'react'
import { trackingDiagnostics, trackingFailureRanges } from './lib/virtual-character'
import type { MaskKeyframe, VirtualCharacterLayer, VirtualCharacterTrackingKeyframe } from './live-composite-types'
import { CharacterAppearancePanel } from './CharacterAppearancePanel'
import { CharacterMotionPanel } from './CharacterMotionPanel'

interface VirtualCharacterPanelProps {
  layer: VirtualCharacterLayer | null
  keyframes: MaskKeyframe[]
  currentTime: number
  duration: number
  disabled: boolean
  onSelect: (file: File) => void
  onChange: (patch: Partial<VirtualCharacterLayer>) => void
  onRemove: () => void
  onAutoMatch: () => void
  motionBusy: boolean
  motionMessage: string | null
  onAnalyzeMotionCurrent: () => void
  onAnalyzeMotionClip: () => void
}

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  disabled: boolean
  onChange: (value: number) => void
}

function RangeControl({ label, value, min, max, step, suffix = '', disabled, onChange }: RangeControlProps) {
  return (
    <label className="block text-xs text-stone-500">
      <span className="mb-1 flex justify-between"><span>{label}</span><span className="font-mono text-stone-300">{value.toFixed(step < 0.1 ? 2 : 0)}{suffix}</span></span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-violet-400" />
    </label>
  )
}

export function VirtualCharacterPanel({ layer, keyframes, currentTime, duration, disabled, onSelect, onChange, onRemove, onAutoMatch, motionBusy, motionMessage, onAnalyzeMotionCurrent, onAnalyzeMotionClip }: VirtualCharacterPanelProps) {
  const diagnostics = useMemo(() => trackingDiagnostics(keyframes), [keyframes])
  const failures = useMemo(() => trackingFailureRanges(keyframes), [keyframes])
  const currentDiagnostic = diagnostics.reduce<(typeof diagnostics)[number] | null>((nearest, diagnostic) => (
    !nearest || Math.abs(diagnostic.time - currentTime) < Math.abs(nearest.time - currentTime) ? diagnostic : nearest
  ), null)
  const trackingKeyframes = layer?.trackingKeyframes ?? []
  const currentCorrection = trackingKeyframes.find((keyframe) => Math.abs(keyframe.time - currentTime) < 0.05)
  const updateCorrections = (next: VirtualCharacterTrackingKeyframe[]) => onChange({
    trackingKeyframes: [...next].sort((a, b) => a.time - b.time),
  })
  const addCorrection = () => updateCorrections([
    ...trackingKeyframes.filter((keyframe) => Math.abs(keyframe.time - currentTime) >= 0.05),
    { id: crypto.randomUUID(), time: currentTime, offsetX: 0, offsetY: 0 },
  ])
  const patchCorrection = (patch: Partial<VirtualCharacterTrackingKeyframe>) => {
    if (!currentCorrection) return
    updateCorrections(trackingKeyframes.map((keyframe) => keyframe.id === currentCorrection.id ? { ...keyframe, ...patch } : keyframe))
  }
  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-violet-300">虛擬角色</div>
        {layer ? <button type="button" disabled={disabled} onClick={onRemove} className="text-xs text-stone-500 hover:text-red-300 disabled:opacity-40">移除</button> : null}
      </div>
      {!layer ? (
        <label className={`mt-3 flex h-10 items-center justify-center gap-2 rounded-lg border border-violet-400/25 bg-violet-400/[0.06] px-3 text-sm ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer text-violet-200 hover:bg-violet-400/10'}`}>
          <AppIcon name="user" className="h-4 w-4" />上傳透明角色素材
          <input type="file" accept="image/png,image/webp,image/gif,video/webm,video/quicktime,video/mp4" disabled={disabled} className="sr-only" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onSelect(file)
          }} />
        </label>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.05] p-3">
            <div className="truncate text-sm text-stone-200">{layer.assetName}</div>
            <div className="mt-1 text-[11px] text-stone-500">{layer.assetType === 'video' ? '透明影片' : '透明圖片'} · 可直接輸出至 Canvas</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={disabled} onClick={() => onChange({ anchor: 'screen' })} className={`rounded-lg border px-2 py-2 text-xs ${layer.anchor === 'screen' ? 'border-violet-400/50 bg-violet-400/15 text-violet-200' : 'border-white/10 text-stone-500'}`}>指定畫面位置</button>
            <button type="button" disabled={disabled} onClick={() => onChange({ anchor: 'person' })} className={`rounded-lg border px-2 py-2 text-xs ${layer.anchor === 'person' ? 'border-violet-400/50 bg-violet-400/15 text-violet-200' : 'border-white/10 text-stone-500'}`}>AI 人物追蹤</button>
          </div>

          {layer.anchor === 'screen' ? (
            <>
              <RangeControl label="水平位置" value={layer.x} min={-0.5} max={1.5} step={0.01} disabled={disabled} onChange={(x) => onChange({ x })} />
              <RangeControl label="垂直位置" value={layer.y} min={-0.5} max={1.5} step={0.01} disabled={disabled} onChange={(y) => onChange({ y })} />
            </>
          ) : (
            <>
              <RangeControl label="人物水平偏移" value={layer.offsetX} min={-1} max={1} step={0.01} disabled={disabled} onChange={(offsetX) => onChange({ offsetX })} />
              <RangeControl label="人物垂直偏移" value={layer.offsetY} min={-1} max={1} step={0.01} disabled={disabled} onChange={(offsetY) => onChange({ offsetY })} />
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] leading-5 text-stone-500">
                <div className="flex items-center justify-between">
                  <span>目前追蹤品質</span>
                  <span className={currentDiagnostic?.status === 'good' ? 'text-emerald-300' : currentDiagnostic?.status === 'warning' ? 'text-amber-300' : 'text-red-300'}>
                    {currentDiagnostic ? `${Math.round(currentDiagnostic.confidence * 100)}%` : '無遮罩'}
                  </span>
                </div>
                <div>需檢查區段：{failures.length === 0 ? '無' : failures.slice(0, 3).map((range) => `${range.startTime.toFixed(1)}–${range.endTime.toFixed(1)}s`).join('、')}</div>
                <div>校正關鍵影格：{trackingKeyframes.length}</div>
              </div>
              {!currentCorrection ? (
                <button type="button" disabled={disabled} onClick={addCorrection} className="w-full rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs text-violet-200 disabled:opacity-40">在 {currentTime.toFixed(2)}s 加入追蹤校正</button>
              ) : (
                <div className="space-y-3 rounded-lg border border-violet-400/25 bg-violet-400/[0.05] p-3">
                  <div className="flex items-center justify-between text-xs text-violet-200"><span>{currentCorrection.time.toFixed(2)}s 校正</span><button type="button" disabled={disabled} onClick={() => updateCorrections(trackingKeyframes.filter((keyframe) => keyframe.id !== currentCorrection.id))} className="text-stone-500 hover:text-red-300">刪除</button></div>
                  <RangeControl label="校正 X" value={currentCorrection.offsetX} min={-1} max={1} step={0.01} disabled={disabled} onChange={(offsetX) => patchCorrection({ offsetX })} />
                  <RangeControl label="校正 Y" value={currentCorrection.offsetY} min={-1} max={1} step={0.01} disabled={disabled} onChange={(offsetY) => patchCorrection({ offsetY })} />
                </div>
              )}
              <p className="text-[11px] leading-5 text-stone-600">追蹤以人物遮罩中心為基準，校正值會在相鄰關鍵影格間平滑插值；無人物遮罩時回到指定畫面位置。</p>
            </>
          )}

          <RangeControl label="角色大小" value={layer.scale * 100} min={5} max={150} step={1} suffix="%" disabled={disabled} onChange={(scale) => onChange({ scale: scale / 100 })} />
          <RangeControl label="旋轉" value={layer.rotation} min={-180} max={180} step={1} suffix="°" disabled={disabled} onChange={(rotation) => onChange({ rotation })} />
          <RangeControl label="不透明度" value={layer.opacity * 100} min={0} max={100} step={1} suffix="%" disabled={disabled} onChange={(opacity) => onChange({ opacity: opacity / 100 })} />
          <CharacterAppearancePanel value={layer.appearance} disabled={disabled} onAutoMatch={onAutoMatch} onChange={(appearance) => onChange({ appearance })} />
          <CharacterMotionPanel layer={layer} disabled={disabled} busy={motionBusy} message={motionMessage} onChange={onChange} onAnalyzeCurrent={onAnalyzeMotionCurrent} onAnalyzeClip={onAnalyzeMotionClip} />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-stone-500">開始秒數<input type="number" min={0} max={duration} step={0.1} value={layer.startTime} disabled={disabled} onChange={(event) => onChange({ startTime: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-stone-200" /></label>
            <label className="text-xs text-stone-500">結束秒數<input type="number" min={0} max={duration} step={0.1} value={layer.endTime} disabled={disabled} onChange={(event) => onChange({ endTime: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-stone-200" /></label>
          </div>

          <label className="flex items-center justify-between text-xs text-stone-400">遮擋層級
            <select value={layer.depth} disabled={disabled} onChange={(event) => onChange({ depth: event.target.value === 'in-front' ? 'in-front' : 'behind-person' })} className="rounded-md border border-white/10 bg-stone-900 px-2 py-1.5 text-stone-200">
              <option value="behind-person">人物後方</option><option value="in-front">人物前方</option>
            </select>
          </label>
          {layer.assetType === 'video' ? <label className="flex items-center gap-2 text-xs text-stone-400"><input type="checkbox" checked={layer.loop} disabled={disabled} onChange={(event) => onChange({ loop: event.target.checked })} className="accent-violet-400" />循環播放角色影片</label> : null}
        </div>
      )}
    </section>
  )
}

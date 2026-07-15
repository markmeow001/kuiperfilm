'use client'

/**
 * 摄像机检查器（右侧面板）— 名称/切换/位置/注视/FOV/荷兰角/视角预设 + 发送。
 * 从 DirectorStage 抽出（千行拆分），逻辑不变。
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { SliderRow } from './SliderRow'
import { Vec3Field } from './Vec3Field'
import { CAMERA_PRESETS } from './camera-presets'
import { FOCAL_LENGTH_PRESETS_MM, focalLengthToFov, fovToFocalLength } from './camera-lens'
import type { StageCamera, StageMannequin, StageProp } from './stage-types'

export interface CameraPanelProps {
  camera: StageCamera
  cameraId: string
  cameras: StageCamera[]
  mannequins: StageMannequin[]
  props: StageProp[]
  saving?: boolean
  onCommit: (id: string, patch: Partial<StageCamera>) => void
  onSwitch: (cameraId: string) => void
  onView: (cameraId: string) => void
  onSend: (cameraId: string) => void
  onApplyPreset: (cameraId: string, preset: (typeof CAMERA_PRESETS)[number]) => void
  onApplyFraming: (cameraId: string, distance: number, fov: number) => void
}

const FRAMING_PRESETS = [
  { label: '全身', distance: 6.5, fov: 50 },
  { label: '半身', distance: 3, fov: 38 },
  { label: '近景', distance: 2, fov: 34 },
  { label: '特写', distance: 1.4, fov: 32 },
] as const

export function CameraPanel({ camera, cameraId, cameras, mannequins, props, saving, onCommit, onSwitch, onView, onSend, onApplyPreset, onApplyFraming }: CameraPanelProps) {
  const focalLengthMm = Math.round(fovToFocalLength(camera.fov))
  return (
    <div className="absolute right-4 top-16 bottom-16 flex w-64 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
        <span className="font-mono text-[12px]" style={{ color: CANVAS_TOKENS.accent }}>摄像机 · {camera.label}</span>
        <button type="button" onClick={() => onSend(cameraId)} disabled={saving} className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}>发送</button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <button type="button" onClick={() => onView(cameraId)} className="w-full rounded-md py-2 font-mono text-[12px] font-semibold" style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}>◉ 进入该摄像机视角</button>
        <label className="block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>名称</span>
          <input value={camera.label} onChange={(e) => onCommit(cameraId, { label: e.target.value })} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
        </label>
        <label className="block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>切换机位</span>
          <select value={cameraId} onChange={(e) => onSwitch(e.target.value)} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <Vec3Field label="位置" value={camera.position} onChange={(v) => onCommit(cameraId, { position: v })} />
        <label className="block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>注视目标</span>
          <select
            value={camera.lookAtObjectId ?? 'manual'}
            onChange={(e) => onCommit(cameraId, { lookAtObjectId: e.target.value === 'manual' ? null : e.target.value })}
            className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          >
            <option value="manual">手动坐标</option>
            {mannequins.map((m) => <option key={m.id} value={m.id}>追踪：{m.label}</option>)}
            {props.map((prop) => <option key={prop.id} value={prop.id}>追踪道具：{prop.label}</option>)}
          </select>
        </label>
        {camera.lookAtObjectId ? null : (
          <Vec3Field label="注视坐标" value={camera.target} onChange={(v) => onCommit(cameraId, { target: v })} />
        )}
        <SliderRow label="FOV" value={camera.fov} min={8} max={100} unit="°" onChange={(v) => onCommit(cameraId, { fov: v })} />
        <div className="pt-1">
          <div className="mb-1 flex items-center justify-between px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
            <span>全画幅焦段</span><span style={{ color: CANVAS_TOKENS.accent }}>{focalLengthMm}mm</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {FOCAL_LENGTH_PRESETS_MM.map((mm) => (
              <button key={mm} type="button" onClick={() => onCommit(cameraId, { fov: focalLengthToFov(mm) })} className="rounded py-1 font-mono text-[10px] transition-colors hover:opacity-80" style={{ color: Math.abs(focalLengthMm - mm) <= 1 ? CANVAS_TOKENS.accentText : CANVAS_TOKENS.text.primary, background: Math.abs(focalLengthMm - mm) <= 1 ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover }}>{mm}mm</button>
            ))}
          </div>
        </div>
        <SliderRow label="荷兰角" value={camera.roll ?? 0} min={-45} max={45} unit="°" onChange={(v) => onCommit(cameraId, { roll: v })} />
        <div className="pt-1">
          <div className="mb-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>主体构图</div>
          <div className="grid grid-cols-4 gap-1">
            {FRAMING_PRESETS.map(({ label, distance, fov }) => <button key={label} type="button" onClick={() => onApplyFraming(cameraId, distance, fov)} className="rounded py-1 text-[10px] hover:opacity-80" style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}>{label}</button>)}
          </div>
        </div>
        <div className="pt-1">
          <div className="mb-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>机位视角预设</div>
          <div className="grid grid-cols-2 gap-1">
            {CAMERA_PRESETS.map((preset) => (
              <button key={preset.name} type="button" onClick={() => onApplyPreset(cameraId, preset)} className="rounded py-1 text-[11px] transition-colors hover:opacity-80" style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}>{preset.name}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

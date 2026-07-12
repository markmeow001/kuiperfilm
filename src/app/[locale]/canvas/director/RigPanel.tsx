'use client'

/**
 * 人偶检查器（右侧面板）— transform 模式、素体类型、姿势预设、逐关节 rig
 * slider。从 DirectorStage 抽出（千行拆分），逻辑不变。
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { SliderRow } from './SliderRow'
import { POSE_PRESETS, REST_POSE, RIG_SLIDER_GROUPS, type Joint, type Pose } from './pose-presets'
import { BODY_TYPES, type BodyType, type StageMannequin, type TransformMode } from './stage-types'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

export interface RigPanelProps {
  mannequin: StageMannequin
  mode: TransformMode
  onMode: (m: TransformMode) => void
  onCommit: (id: string, patch: Partial<StageMannequin>) => void
  onApplyPose: (id: string, pose: Pose) => void
  onSetJointAxis: (id: string, joint: Joint, axis: 0 | 1 | 2, rad: number) => void
}

export function RigPanel({ mannequin, mode, onMode, onCommit, onApplyPose, onSetJointAxis }: RigPanelProps) {
  return (
    <div className="absolute right-4 top-16 bottom-16 flex w-64 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
        <span className="font-mono text-[12px]" style={{ color: mannequin.color }}>{mannequin.label}</span>
        <button type="button" onClick={() => onApplyPose(mannequin.id, REST_POSE)} className="rounded px-2 py-0.5 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>重置姿势</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {/* transform mode + body type */}
        <div className="mb-2 flex gap-1">
          {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
            <button key={m} type="button" onClick={() => onMode(m)} className="flex-1 rounded py-1 text-[11px]" style={{ color: mode === m ? CANVAS_TOKENS.accentText : CANVAS_TOKENS.text.secondary, background: mode === m ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover }}>
              {m === 'translate' ? '移动' : m === 'rotate' ? '旋转' : '缩放'}
            </button>
          ))}
        </div>
        <label className="mb-2 block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>素体类型</span>
          <select value={mannequin.bodyType ?? 'male'} onChange={(e) => onCommit(mannequin.id, { bodyType: e.target.value as BodyType })} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            {BODY_TYPES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
        <div className="mb-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>预设姿势</div>
        <div className="mb-3 grid grid-cols-3 gap-1">
          {POSE_PRESETS.map((preset) => (
            <button key={preset.name} type="button" onClick={() => onApplyPose(mannequin.id, preset.pose)} className="rounded py-1 text-[11px] transition-colors hover:opacity-80" style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}>{preset.name}</button>
          ))}
        </div>
        {RIG_SLIDER_GROUPS.map((g) => (
          <div key={g.group} className="mb-2">
            <div className="mb-0.5 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{g.group}</div>
            {g.rows.map((row) => (
              <SliderRow key={`${row.joint}-${row.axis}`} label={row.label} value={(mannequin.pose ?? REST_POSE).joints[row.joint][row.axis] * RAD2DEG} min={-180} max={180} onChange={(deg) => onSetJointAxis(mannequin.id, row.joint, row.axis, deg * DEG2RAD)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

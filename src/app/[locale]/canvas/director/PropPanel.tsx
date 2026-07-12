'use client'

/**
 * 道具检查器（右侧面板，选中道具时显示）— 名称/类型/颜色 + transform 模式。
 * 位置/旋转/缩放走 3D gizmo（与人偶同通道），这里只管属性。
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { PROP_KINDS, type PropKind, type StageProp, type TransformMode } from './stage-types'

export interface PropPanelProps {
  prop: StageProp
  mode: TransformMode
  onMode: (m: TransformMode) => void
  onPatch: (id: string, patch: Partial<StageProp>) => void
}

export function PropPanel({ prop, mode, onMode, onPatch }: PropPanelProps) {
  return (
    <div className="absolute right-4 top-16 flex w-64 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
        <span className="font-mono text-[12px]" style={{ color: prop.color }}>道具 · {prop.label}</span>
      </div>
      <div className="space-y-2 p-2">
        <div className="flex gap-1">
          {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
            <button key={m} type="button" onClick={() => onMode(m)} className="flex-1 rounded py-1 text-[11px]" style={{ color: mode === m ? CANVAS_TOKENS.accentText : CANVAS_TOKENS.text.secondary, background: mode === m ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover }}>
              {m === 'translate' ? '移动' : m === 'rotate' ? '旋转' : '缩放'}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>名称</span>
          <input value={prop.label} onChange={(e) => onPatch(prop.id, { label: e.target.value })} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
        </label>
        <label className="block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>类型</span>
          <select value={prop.kind} onChange={(e) => onPatch(prop.id, { kind: e.target.value as PropKind })} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            {PROP_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
          <span>颜色</span>
          <input type="color" value={prop.color} onChange={(e) => onPatch(prop.id, { color: e.target.value })} className="h-6 w-10 rounded" />
        </label>
      </div>
    </div>
  )
}

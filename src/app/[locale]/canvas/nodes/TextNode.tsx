'use client'

/**
 * Text node — a free-form prompt / script holder. Feeds downstream image/video
 * nodes conceptually (M1: visual only; wiring its text into a connected node's
 * prompt is a follow-up). No generation of its own.
 */
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'

export function TextNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const meta = NODE_META.text
  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={260} noTarget>
      <div className="p-3">
        <textarea
          value={d.prompt}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          placeholder="脚本 / 提示词 / 旁白…"
          rows={4}
          className="nodrag w-full resize-none rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none"
          style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
        />
      </div>
    </NodeShell>
  )
}

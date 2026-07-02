'use client'

/**
 * 分组 container node (成组 G / 解组 ⇧G) — LibTV-style tinted rect that holds
 * child nodes. Children carry parentId + extent:'parent' (React Flow subflow);
 * dragging the group moves them together. The container renders BEHIND its
 * children (parents precede children in the nodes array).
 */
import type { NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'

export function GroupNode({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <div
      className="h-full w-full"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1.5px dashed ${selected ? CANVAS_TOKENS.selectedRing : CANVAS_TOKENS.hairline}`,
        borderRadius: CANVAS_TOKENS.radius.lg,
      }}
    >
      <div className="px-2.5 py-1.5 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
        {d.title || '分组'}
      </div>
    </div>
  )
}

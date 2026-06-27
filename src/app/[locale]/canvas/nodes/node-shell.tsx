'use client'

/**
 * Shared visual chrome for canvas nodes — LibTV card look (token-driven) +
 * left(target)/right(source) React Flow handles. Keeps the per-type node
 * components focused on their config/body, not on borders and ports.
 */
import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'

interface NodeShellProps {
  accent: string
  label: string
  hint?: string
  selected?: boolean
  /** Editable title controls rendered in the header (optional). */
  titleSlot?: ReactNode
  children: ReactNode
  /** Hide the left target handle (e.g. pure source nodes). */
  noTarget?: boolean
  /** Hide the right source handle. */
  noSource?: boolean
  width?: number
}

// Larger hit area (16px) so the port is easy to grab; paired with the
// ReactFlow connectionRadius so near-misses still snap to it.
const handleStyle = (color: string) => ({
  width: 16,
  height: 16,
  background: color,
  border: `3px solid ${CANVAS_TOKENS.bg.card}`,
})

export function NodeShell({
  accent,
  label,
  hint,
  selected,
  titleSlot,
  children,
  noTarget,
  noSource,
  width = 280,
}: NodeShellProps) {
  return (
    <div
      style={{
        width,
        background: CANVAS_TOKENS.bg.card,
        borderRadius: CANVAS_TOKENS.radius.lg,
        border: `1.5px solid ${selected ? CANVAS_TOKENS.accent : CANVAS_TOKENS.hairline}`,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        color: CANVAS_TOKENS.text.primary,
      }}
    >
      {!noTarget && <Handle type="target" position={Position.Left} style={handleStyle(CANVAS_TOKENS.text.muted)} />}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: accent, fontSize: 13 }}>◆</span>
          {titleSlot ?? (
            <span className="truncate font-mono text-[12px] tracking-wide" style={{ color: accent }}>
              {label}
            </span>
          )}
        </div>
        {hint && (
          <span className="ml-2 shrink-0 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
            {hint}
          </span>
        )}
      </div>
      {children}
      {!noSource && <Handle type="source" position={Position.Right} style={handleStyle(accent)} />}
    </div>
  )
}

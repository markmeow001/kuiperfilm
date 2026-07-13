'use client'

/**
 * Shared visual chrome for canvas nodes — LibTV card look (token-driven) +
 * left(target)/right(source) React Flow handles. Keeps the per-type node
 * components focused on their config/body, not on borders and ports.
 *
 * LibTV layout (2026-07-01 measured spec): the type header sits OUTSIDE the
 * card, as a 20px muted row above it; the card itself is a neutral #262626
 * rounded-12 surface with a hairline border, and selection is an inset 2px
 * #A8A8A8 ring (not an accent border). Handles are circular "+" ports.
 */
import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { CANVAS_SOURCE_HANDLE, CANVAS_TARGET_HANDLE } from '../lib/canvas-connections'

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

// Circular "+" port, LibTV-style: dark disc + hairline ring + plus glyph.
// 16px disc paired with ReactFlow connectionRadius so near-misses still snap.
const handleStyle = {
  width: 16,
  height: 16,
  background: CANVAS_TOKENS.bg.panel,
  border: `1px solid ${CANVAS_TOKENS.hairline}`,
  color: CANVAS_TOKENS.text.secondary,
  fontSize: 11,
  lineHeight: '14px',
  textAlign: 'center' as const,
}

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
    <div style={{ width }}>
      {/* Type header — outside the card (LibTV 20px muted row) */}
      <div className="flex h-5 items-center justify-between px-0.5 pb-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden style={{ color: accent, fontSize: 10 }}>◆</span>
          {titleSlot ?? (
            <span className="truncate text-[12px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
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
      <div
        className="relative"
        style={{
          background: CANVAS_TOKENS.bg.card,
          borderRadius: CANVAS_TOKENS.radius.lg,
          border: `1px solid ${CANVAS_TOKENS.hairline}`,
          boxShadow: selected
            ? `inset 0 0 0 2px ${CANVAS_TOKENS.selectedRing}, ${CANVAS_TOKENS.shadow}`
            : CANVAS_TOKENS.shadow,
          color: CANVAS_TOKENS.text.primary,
        }}
      >
        {!noTarget && (
          <Handle id={CANVAS_TARGET_HANDLE} type="target" position={Position.Left} style={handleStyle}>
            <span className="pointer-events-none block" aria-hidden>＋</span>
          </Handle>
        )}
        {children}
        {!noSource && (
          <Handle id={CANVAS_SOURCE_HANDLE} type="source" position={Position.Right} style={handleStyle}>
            <span className="pointer-events-none block" aria-hidden>＋</span>
          </Handle>
        )}
      </div>
    </div>
  )
}

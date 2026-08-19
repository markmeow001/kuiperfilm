'use client'

/**
 * 描述文字里的资产名高亮（LibTV 蓝字块）。纯渲染——切分逻辑在
 * script-gen-lib.splitByEntityNames，由行为测试钉住。
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { splitByEntityNames } from './script-gen-lib'

export function EntityText({ text, names }: { text: string; names: readonly string[] }) {
  const segments = splitByEntityNames(text, names)
  if (segments.length === 0) return null
  return (
    <>
      {segments.map((segment, i) =>
        segment.entity ? (
          <span
            key={i}
            className="rounded-sm px-0.5"
            style={{ background: `${CANVAS_TOKENS.accent}26`, color: '#8FD3E8' }}
          >
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  )
}

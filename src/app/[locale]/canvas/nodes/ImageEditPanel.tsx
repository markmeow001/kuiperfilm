'use client'

import { useEffect, useState } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'

interface ImageEditPanelProps {
  aspectRatio: string
  sourcePrompt: string
  busy: 'crop' | 'outpaint' | null
  error: string | null
  onCrop: (aspectRatio: string) => Promise<void>
  onOutpaint: (aspectRatio: string, prompt: string) => Promise<void>
}

export function ImageEditPanel({ aspectRatio, sourcePrompt, busy, error, onCrop, onOutpaint }: ImageEditPanelProps) {
  const [prompt, setPrompt] = useState(sourcePrompt)
  useEffect(() => setPrompt(sourcePrompt), [sourcePrompt])

  return (
    <div className="space-y-2 rounded-lg p-2" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
      <div className="flex items-center justify-between text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
        <span>非破坏编辑</span>
        <span style={{ color: CANVAS_TOKENS.text.muted }}>结果建立为新节点</span>
      </div>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="扩图描述：补出左右环境、街道延伸、室内陈设…"
        className="nodrag nowheel w-full resize-y rounded-md px-2 py-1.5 text-[11px] outline-none"
        style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" disabled={Boolean(busy)} onClick={() => void onCrop(aspectRatio)} className="rounded-md py-1.5 text-[11px] disabled:opacity-40" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>
          {busy === 'crop' ? '裁切中…' : `裁切为 ${aspectRatio}`}
        </button>
        <button type="button" disabled={Boolean(busy) || !prompt.trim()} onClick={() => void onOutpaint(aspectRatio, prompt)} className="rounded-md py-1.5 text-[11px] disabled:opacity-40" style={{ background: CANVAS_TOKENS.accentSoft, color: CANVAS_TOKENS.accent }}>
          {busy === 'outpaint' ? '扩图生成中…' : `向外扩图到 ${aspectRatio}`}
        </button>
      </div>
      {error ? <div role="alert" className="text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
    </div>
  )
}

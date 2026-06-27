'use client'

/**
 * 导演台 node (M2a) — opens the fullscreen 3D blocking stage, captures a shot
 * POV, and stores it as the node's reference image. Acts as a ref-bearing
 * source (like character/image): wire it into a video node → its screenshot
 * becomes the i2v first frame, giving the model a real spatial/blocking
 * reference for multi-character cross-shot consistency.
 *
 * The stage is portaled to document.body so React Flow's canvas transform
 * doesn't clip/scale it. Stage state persists in data.stage so reopening
 * restores the arrangement.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'
import { DEFAULT_STAGE, type DirectorStageState } from '../director/stage-types'

// three.js + R3F + drei are heavy (~250kB). Load the stage only when a director
// node actually opens it, keeping the base canvas bundle light. ssr:false —
// the stage is pure WebGL, no server render.
const DirectorStage = dynamic(() => import('../director/DirectorStage').then((m) => m.DirectorStage), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: CANVAS_TOKENS.bg.canvas, color: CANVAS_TOKENS.text.secondary }}>
      <span className="font-mono text-[12px]">加载导演台…</span>
    </div>
  ),
})

function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, b64] = dataUrl.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

export function DirectorNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const upload = useUploadPlaygroundReference()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = NODE_META.director
  const stage = (d.stage as DirectorStageState | undefined) ?? DEFAULT_STAGE

  async function handleSend(dataUrl: string, newStage: DirectorStageState) {
    setError(null)
    try {
      const file = dataUrlToFile(dataUrl, `director-${id}.png`)
      const res = await upload.mutateAsync({ file, type: 'image' })
      // referenceKey = durable COS key (worker re-signs); resultUrl = signed URL
      // for the thumbnail. stage persists so reopening restores the arrangement.
      updateNodeData(id, { resultUrl: res.signedUrl, referenceKey: res.key, stage: newStage })
      setOpen(false)
    } catch (err) {
      setError((err as Error)?.message ?? '发送失败')
    }
  }

  return (
    <>
      <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={240} noTarget>
        <div className="p-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="nodrag relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md text-[11px]"
            style={{ background: CANVAS_TOKENS.bg.app, color: CANVAS_TOKENS.text.muted, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          >
            {d.resultUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.resultUrl} alt="导演台站位" className="h-full w-full object-cover" />
            ) : (
              <span>3D 摆位 → 截图当参考图</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="nodrag mt-2 w-full rounded-md py-1.5 font-mono text-[12px] font-semibold"
            style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}
          >
            {d.resultUrl ? '重新摆位' : '打开导演台'}
          </button>
          {error ? <div className="mt-1 text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
        </div>
      </NodeShell>

      {open
        ? createPortal(
            <DirectorStage initialState={stage} onClose={() => setOpen(false)} onSend={handleSend} saving={upload.isPending} />,
            document.body,
          )
        : null}
    </>
  )
}

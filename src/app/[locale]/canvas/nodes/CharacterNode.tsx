'use client'

/**
 * Character node (M1 minimal) — holds one reference image (uploaded via the
 * Playground upload-reference endpoint). Acts as a source feeding image/video
 * nodes. Full 角色库 (4-view + CharacterAppearance binding) is M3.
 */
import { useRef, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'

export function CharacterNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const upload = useUploadPlaygroundReference()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const meta = NODE_META.character

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      const result = await upload.mutateAsync({ file, type: 'image' })
      // referenceKey = durable COS key (worker re-signs for i2v); resultUrl =
      // signed URL for the thumbnail.
      updateNodeData(id, { resultUrl: result.signedUrl, referenceKey: result.key })
    } catch (err) {
      setError((err as Error)?.message ?? '上传失败')
    }
  }

  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={240}>
      <div className="p-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="nodrag relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md text-[11px]"
          style={{ background: CANVAS_TOKENS.bg.app, color: CANVAS_TOKENS.text.muted, border: `1px dashed ${CANVAS_TOKENS.hairline}` }}
        >
          {d.resultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.resultUrl} alt="character" className="h-full w-full object-cover" />
          ) : upload.isPending ? (
            '上传中…'
          ) : (
            '＋ 上传角色参考图'
          )}
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePick} />
        {error ? <div className="mt-1 text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
      </div>
    </NodeShell>
  )
}

'use client'

/**
 * Character node (M1 minimal) — holds one reference image, filled either by
 * uploading (Playground upload-reference endpoint) OR by wiring an upstream
 * 图片 node into it: a connected image node's generated result is copied into
 * the caller's ref namespace (use-as-reference) so it survives as a durable
 * cast reference. Acts as a source feeding image/video nodes. Full 角色库
 * (4-view + CharacterAppearance binding) is M3.
 */
import { useMemo, useRef, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'
import { SaveCanvasAssetButton } from '../lib/canvas-assets-client'

export function CharacterNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const upload = useUploadPlaygroundReference()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const meta = NODE_META.character

  // Upstream 图片 nodes wired into this character (its left/target handle) that
  // have a completed generated result → candidates to become the 角色参考图.
  const incoming = useNodeConnections({ handleType: 'target' })
  const upstreamIds = useMemo(() => incoming.map((c) => c.source), [incoming])
  const upstreamNodes = useNodesData(upstreamIds)
  const upstreamImages = useMemo(
    () =>
      upstreamNodes
        .filter((n): n is NonNullable<typeof n> => Boolean(n) && n.type === 'image')
        .map((n) => n.data as CanvasNodeData)
        .filter((dd) => Boolean(dd?.runId) && Boolean(dd?.resultUrl))
        .map((dd) => ({ runId: String(dd.runId), url: dd.resultUrl as string })),
    [upstreamNodes],
  )

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

  // Copy an upstream image node's run result into this caller's ref namespace,
  // then set it as this character's durable reference. The run-result key isn't
  // in the safe namespace, so the copy (server-side) is what makes it usable as
  // a downstream cast reference (passes the reference guard).
  async function ingestUpstream(runId: string) {
    setError(null)
    setIngesting(true)
    try {
      const res = await fetch('/api/canvas/use-as-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      })
      if (!res.ok) throw new Error('导入失败（上游图片可能还没生成完）')
      const { key, url } = (await res.json()) as { key: string; url: string }
      updateNodeData(id, { resultUrl: url, referenceKey: key })
    } catch (err) {
      setError((err as Error)?.message ?? '导入失败')
    } finally {
      setIngesting(false)
    }
  }

  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} locked={Boolean(d.locked)} width={240}>
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
        {/* Wire a 图片 node into this character → import its generated image as
            the 角色参考图 (the answer to「生成图怎么变成角色图」via connection). */}
        {upstreamImages.length > 0 ? (
          <button
            type="button"
            disabled={ingesting}
            onClick={() => ingestUpstream(upstreamImages[0].runId)}
            title="把连进来的上游图片设为角色参考图"
            className="nodrag mt-2 w-full rounded-md px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          >
            {ingesting
              ? '导入中…'
              : `⬇ 用上游图片作参考${upstreamImages.length > 1 ? `（${upstreamImages.length}张·取第一条连线）` : ''}`}
          </button>
        ) : null}
        {error ? <div className="mt-1 text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
        <div className="mt-2">
          <SaveCanvasAssetButton
            source={d.referenceKey ? { kind: 'storage-key', storageKey: d.referenceKey } : null}
            defaultName={d.title || '角色'}
            allowedTypes={['character']}
          />
        </div>
      </div>
    </NodeShell>
  )
}

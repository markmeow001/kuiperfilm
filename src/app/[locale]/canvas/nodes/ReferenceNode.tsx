'use client'

/**
 * Reference node (角色 / 場景 / 道具) — holds one reference image, filled either
 * by uploading (Playground upload-reference endpoint) OR by wiring an upstream
 * 图片 node into it: a connected image node's generated result is copied into
 * the caller's ref namespace (use-as-reference) so it survives as a durable
 * reference. Acts as a source feeding script/image/video nodes.
 *
 * One implementation for all three kinds: they differ only in labels, accent
 * and which asset-library type they save into — duplicating the upload/ingest
 * machinery per kind would be three copies of the same file. The node title is
 * editable in the header (命名), because a cast list of three cards all reading
 * 「角色」 tells the user nothing about who is who.
 */
import { useMemo, useRef, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import type { CanvasAssetType } from '@/lib/canvas/canvas-assets-contract'
import { CANVAS_TOKENS, NODE_META, type CanvasNodeType } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'
import { SaveCanvasAssetButton } from '../lib/canvas-assets-client'

export type ReferenceNodeKind = Extract<CanvasNodeType, 'character' | 'scene' | 'prop'>

const KIND_ASSET_TYPE: Record<ReferenceNodeKind, CanvasAssetType> = {
  character: 'character',
  scene: 'scene',
  prop: 'prop',
}

export function makeReferenceNode(kind: ReferenceNodeKind) {
  function ReferenceNode({ id, data, selected }: NodeProps) {
    const d = data as CanvasNodeData
    const { updateNodeData } = useReactFlow()
    const upload = useUploadPlaygroundReference()
    const inputRef = useRef<HTMLInputElement | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [ingesting, setIngesting] = useState(false)
    const meta = NODE_META[kind]

    // Upstream 图片 nodes wired into this node (its left/target handle) that
    // have a completed generated result → candidates to become the 参考图.
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

    // Copy an upstream image node's run result into this caller's ref
    // namespace, then set it as this node's durable reference. The run-result
    // key isn't in the safe namespace, so the copy (server-side) is what makes
    // it usable as a downstream reference (passes the reference guard).
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
      <NodeShell
        accent={meta.accent}
        label={meta.label}
        hint={meta.hint}
        selected={selected}
        locked={Boolean(d.locked)}
        width={240}
        titleSlot={
          <span className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-[12px]" style={{ color: CANVAS_TOKENS.text.secondary }}>{meta.label}</span>
            <input
              value={d.title || ''}
              onChange={(e) => updateNodeData(id, { title: e.target.value })}
              placeholder={`命名，如「${kind === 'character' ? '男主·Hayes' : kind === 'scene' ? '牧场客厅' : '牧场手铐'}」`}
              maxLength={40}
              className="nodrag min-w-0 flex-1 truncate rounded bg-transparent px-1 text-[12px] outline-none focus:bg-white/5"
              style={{ color: CANVAS_TOKENS.text.primary }}
            />
          </span>
        }
      >
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
              <img src={d.resultUrl} alt={kind} className="h-full w-full object-cover" />
            ) : upload.isPending ? (
              '上传中…'
            ) : (
              `＋ 上传${meta.label}参考图`
            )}
          </button>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePick} />
          {/* Wire a 图片 node into this node → import its generated image as
              the 参考图 (the answer to「生成图怎么变成参考图」via connection). */}
          {upstreamImages.length > 0 ? (
            <button
              type="button"
              disabled={ingesting}
              onClick={() => ingestUpstream(upstreamImages[0].runId)}
              title={`把连进来的上游图片设为${meta.label}参考图`}
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
              defaultName={d.title || meta.label}
              allowedTypes={[KIND_ASSET_TYPE[kind]]}
            />
          </div>
        </div>
      </NodeShell>
    )
  }
  ReferenceNode.displayName = `ReferenceNode(${kind})`
  return ReferenceNode
}

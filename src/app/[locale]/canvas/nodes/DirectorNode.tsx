'use client'

/**
 * 导演台 node (v2 — 持久场景 + 多机位).
 *
 * Opens the 3D stage. Each camera 发送 spawns a connected IMAGE frame node:
 *  - frame.anchorKey = that camera's blocking screenshot (its own first-frame
 *    reference) → every frame from this stage shares the same 3D blocking
 *  - edges wired from the director's upstream CAST (character/image nodes) →
 *    the frame, so each frame also carries the cast's appearance refs
 * → both spatial relationship AND character identity propagate into every frame,
 * which is what makes the shots a coherent 剧 rather than disconnected one-offs.
 *
 * Wire character nodes INTO the director (its left handle) to define the cast.
 * The heavy 3D stage is lazy-loaded + portaled to document.body.
 */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import {
  useNodeConnections,
  useNodesData,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '../lib/canvas-types'
import { useCanvasGeneration } from '../lib/canvas-generation'
import { NodeShell } from './node-shell'
import { DEFAULT_STAGE, normalizeStage, type DirectorStageState } from '../director/stage-types'

const DirectorStage = dynamic(() => import('../director/DirectorStage').then((m) => m.DirectorStage), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: CANVAS_TOKENS.bg.canvas, color: CANVAS_TOKENS.text.secondary }}>
      <span className="font-mono text-[12px]">加载导演台…</span>
    </div>
  ),
})

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `n_${Date.now()}_${Math.round(Math.random() * 1e6)}`

function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, b64] = dataUrl.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

const CAST_TYPES = new Set(['character', 'image'])

export function DirectorNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const rf = useReactFlow()
  const { updateNodeData, getNode, addNodes, addEdges } = rf
  const upload = useUploadPlaygroundReference()
  const gen = useCanvasGeneration()
  const [open, setOpen] = useState(false)
  const meta = NODE_META.director

  // Cast = character/image nodes wired INTO the director.
  const incoming = useNodeConnections({ handleType: 'target' })
  const castIds = useMemo(() => incoming.map((c) => c.source), [incoming])
  const castNodes = useNodesData(castIds)
  const cast = useMemo(
    () => castNodes.filter((n): n is NonNullable<typeof n> => Boolean(n) && CAST_TYPES.has(n.type ?? '')),
    [castNodes],
  )
  const castLabels = useMemo(
    () => cast.map((n) => (typeof (n.data as CanvasNodeData)?.title === 'string' && (n.data as CanvasNodeData).title) || '角色'),
    [cast],
  )

  // Upstream image nodes with a completed result → candidate 全景球 backgrounds
  // (e.g. a 720全景图). label + runId + preview url.
  const upstreamImages = useMemo(
    () =>
      cast
        .filter((n) => n.type === 'image' && (n.data as CanvasNodeData)?.runId && (n.data as CanvasNodeData)?.resultUrl)
        .map((n) => {
          const dd = n.data as CanvasNodeData
          return { runId: String(dd.runId), label: dd.title || '图片', url: dd.resultUrl as string }
        }),
    [cast],
  )

  const stage: DirectorStageState = useMemo(() => normalizeStage(d.stage ?? DEFAULT_STAGE), [d.stage])

  // Throws on failure so the stage can surface it (the node card is hidden
  // behind the fullscreen stage during a send).
  async function handleSendShot(dataUrl: string, label: string, newStage: DirectorStageState) {
    const res = await upload.mutateAsync({ file: dataUrlToFile(dataUrl, `shot-${uid()}.png`), type: 'image' })
    const self = getNode(id)
    const base = self?.position ?? { x: 0, y: 0 }
    const sentCount = Number.isFinite(d.sentCount) ? (d.sentCount as number) : 0

    const frameId = uid()
    const frame: Node<CanvasNodeData> = {
      id: frameId,
      type: 'image',
      position: { x: base.x + 360, y: base.y + sentCount * 200 },
      data: { ...DEFAULT_NODE_DATA, title: label, anchorKey: res.key, anchorUrl: res.signedUrl },
    }
    addNodes(frame)

    // Wire the cast (appearance) into this frame so identity carries over.
    const castEdges: Edge[] = cast.map((n) => ({ id: uid(), source: n.id, target: frameId, animated: true }))
    if (castEdges.length > 0) addEdges(castEdges)

    // Persist the stage + advance the frame-spread counter.
    updateNodeData(id, { stage: newStage, sentCount: sentCount + 1 })
  }

  return (
    <>
      <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={240}>
        <div className="p-3">
          <div
            className="flex aspect-video w-full items-center justify-center rounded-md text-center text-[11px]"
            style={{ background: CANVAS_TOKENS.bg.app, color: CANVAS_TOKENS.text.muted, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          >
            <div>
              <div>3D 场景 · {stage.mannequins.length} 人偶 · {stage.cameras.length} 机位</div>
              {castLabels.length > 0 ? <div className="mt-1" style={{ color: CANVAS_TOKENS.text.secondary }}>卡司：{castLabels.join('、')}</div> : <div className="mt-1" style={{ color: CANVAS_TOKENS.text.muted }}>← 连角色节点设定卡司</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="nodrag mt-2 w-full rounded-md py-1.5 font-mono text-[12px] font-semibold"
            style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}
          >
            打开导演台
          </button>
        </div>
      </NodeShell>

      {open
        ? createPortal(
            <DirectorStage
              initialState={stage}
              castLabels={castLabels}
              onClose={() => setOpen(false)}
              onSendShot={handleSendShot}
              saving={upload.isPending}
              uploadImage={async (file) => {
                const res = await upload.mutateAsync({ file, type: 'image' })
                return { key: res.key, url: res.signedUrl }
              }}
              upstreamImages={upstreamImages}
              importBackground={async (runId) => {
                const res = await fetch('/api/canvas/use-as-background', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ runId }),
                })
                if (!res.ok) throw new Error('导入失败（图片可能还没生成完）')
                return (await res.json()) as { key: string; url: string }
              }}
              generateImage={async ({ prompt, refKey, aspectRatio }) => {
                const modelKey = gen.imageModels[0]?.value
                if (!modelKey) throw new Error('无可用图片模型，请到 /profile 启用')
                const runId = await gen.submitNode({
                  prompt,
                  outputType: 'image',
                  modelKey,
                  ...(aspectRatio ? { aspectRatio } : {}),
                  ...(refKey ? { referenceImages: [refKey] } : {}),
                })
                // poll the single-run endpoint to completion (max 5 min)
                const deadline = Date.now() + 5 * 60 * 1000
                while (Date.now() < deadline) {
                  await new Promise((r) => setTimeout(r, 3000))
                  const res = await fetch(`/api/playground/runs/${runId}`)
                  if (!res.ok) continue
                  const { run } = (await res.json()) as { run: { status: string; resultUrls: string[] | null; errorMessage: string | null } }
                  if (run.status === 'succeeded' && run.resultUrls?.[0]) return { url: run.resultUrls[0] }
                  if (run.status === 'failed') throw new Error(run.errorMessage ?? '生成失败')
                }
                throw new Error('生成超时')
              }}
            />,
            document.body,
          )
        : null}
    </>
  )
}

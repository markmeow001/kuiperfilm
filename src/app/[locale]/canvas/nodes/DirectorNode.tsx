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
import type { PrevizExportPayload } from '../director/DirectorStage'
import type { DirectorRoutePlan } from '@/lib/canvas/director-routes-schema'
import type { DirectorBlockingDraft } from '@/lib/canvas/director-blocking-schema'

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

  /**
   * previz 导出（S3）：webm → /api/canvas/previz-export（ffmpeg 转 MP4 + 抽
   * 首尾帧）→ 生成一个已绑参考视频的 video 节点（prompt 预填导演指令，
   * anchor=首帧），卡司 refs 照 handleSendShot 惯例接线。
   */
  async function handleExportPreviz(payload: PrevizExportPayload): Promise<{ videoUrl: string }> {
    const fd = new FormData()
    fd.append('file', new File([payload.blob], `previz.${payload.mimeType === 'video/mp4' ? 'mp4' : 'webm'}`, { type: payload.mimeType }))
    fd.append('meta', JSON.stringify({ aspect: payload.aspect, durationSec: payload.durationSec, crop: payload.crop }))
    const res = await fetch('/api/canvas/previz-export', { method: 'POST', body: fd })
    const json = await res.json().catch(() => null) as
      | { success?: boolean; videoKey?: string; videoUrl?: string; firstFrameKey?: string; firstFrameUrl?: string; lastFrameKey?: string; lastFrameUrl?: string; error?: { message?: string } }
      | null
    if (!res.ok || !json?.success || !json.videoKey) {
      throw new Error(json?.error?.message ?? `导出失败（${res.status}）`)
    }

    const self = getNode(id)
    const base = self?.position ?? { x: 0, y: 0 }
    const sentCount = Number.isFinite(d.sentCount) ? (d.sentCount as number) : 0
    const frameId = uid()
    // R2V 时长选项是整数秒（5-15），预演片长向上取整对齐
    const durationSec = Math.min(Math.max(Math.ceil(payload.durationSec), 5), 15)
    // 预演短于 5s 时输出被抬到 5s——导演指令里默认有「保持时长」的要求，
    // 会跟实际请求矛盾；补一句让模型按参考节奏自然延展（review MEDIUM）。
    const durationNote = payload.durationSec < durationSec - 0.01
      ? `\n（参考视频实际 ${payload.durationSec.toFixed(1)} 秒、输出 ${durationSec} 秒：以参考视频的运动节奏为基准自然延展，勿加速。）`
      : ''
    addNodes({
      id: frameId,
      type: 'video',
      position: { x: base.x + 360, y: base.y + sentCount * 200 },
      data: {
        ...DEFAULT_NODE_DATA,
        title: payload.title,
        prompt: payload.directorText + durationNote,
        genMode: 'omni',
        aspectRatio: payload.aspect,
        durationSec,
        referenceVideoKey: json.videoKey,
        referenceVideoUrl: json.videoUrl ?? null,
        anchorKey: json.firstFrameKey ?? null,
        anchorUrl: json.firstFrameUrl ?? null,
        lastFrameKey: json.lastFrameKey ?? null,
        lastFramePreview: json.lastFrameUrl ?? null,
      },
    } satisfies Node<CanvasNodeData>)
    const castEdges: Edge[] = cast.map((n) => ({ id: uid(), source: n.id, target: frameId, animated: true }))
    if (castEdges.length > 0) addEdges(castEdges)
    updateNodeData(id, { stage: payload.state, sentCount: sentCount + 1 })
    return { videoUrl: json.videoUrl ?? '' }
  }

  /**
   * AI 导演路线（S4）：提交 CANVAS_DIRECTOR_ROUTES → 轮询 /api/tasks/[id]
   * 到完成 → 返回方案列表（generateImage 的同款 await-loop 轮询）。
   */
  async function handleGenerateRoutes(description: string, castNames: string[], propNames: string[]): Promise<DirectorRoutePlan[]> {
    const res = await fetch('/api/canvas/director-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, cast: castNames, props: propNames }),
    })
    const json = await res.json().catch(() => null) as { taskId?: string; error?: { message?: string } } | null
    if (!res.ok || !json?.taskId) throw new Error(json?.error?.message ?? `提交失败（${res.status}）`)
    const deadline = Date.now() + 3 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      const poll = await fetch(`/api/tasks/${json.taskId}`)
      if (!poll.ok) continue
      const { task } = (await poll.json()) as { task?: { status: string; result?: { plans?: DirectorRoutePlan[] }; error?: { message?: string } } }
      if (task?.status === 'completed') {
        const plans = task.result?.plans ?? []
        if (plans.length === 0) throw new Error('模型没有产出可用方案，请换个描述重试')
        return plans
      }
      if (task?.status === 'failed') throw new Error(task?.error?.message ?? '方案生成失败')
    }
    throw new Error('方案生成超时，请重试')
  }

  async function handleGenerateBlocking(description: string): Promise<DirectorBlockingDraft> {
    const res = await fetch('/api/canvas/director-blocking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
    const json = await res.json().catch(() => null) as { taskId?: string; error?: { message?: string } } | null
    if (!res.ok || !json?.taskId) throw new Error(json?.error?.message ?? `提交失败（${res.status}）`)
    const deadline = Date.now() + 3 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const poll = await fetch(`/api/tasks/${json.taskId}`)
      if (!poll.ok) continue
      const { task } = (await poll.json()) as { task?: { status: string; result?: { draft?: DirectorBlockingDraft }; error?: { message?: string } } }
      if (task?.status === 'completed') {
        if (!task.result?.draft) throw new Error('模型没有产出可用排戏草稿，请换个描述重试')
        return task.result.draft
      }
      if (task?.status === 'failed') throw new Error(task.error?.message ?? '排戏草稿生成失败')
    }
    throw new Error('排戏草稿生成超时，请重试')
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
            className="nodrag mt-2 w-full rounded-lg py-1.5 text-[12px] font-semibold"
            style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
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
              onExportPreviz={handleExportPreviz}
              onPersistState={(s) => updateNodeData(id, { stage: s })}
              onGenerateRoutes={handleGenerateRoutes}
              onGenerateBlocking={handleGenerateBlocking}
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

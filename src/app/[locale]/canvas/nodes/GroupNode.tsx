'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '../lib/canvas-types'

const uid = () => crypto.randomUUID()

export function GroupNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const rf = useReactFlow<Node<CanvasNodeData>, Edge>()
  const children = rf.getNodes().filter((node) => node.parentId === id)
  const ordered = useMemo(() => {
    const byId = new Map(children.map((node) => [node.id, node]))
    const preferred = (d.orderedChildIds ?? []).map((childId) => byId.get(childId)).filter((node): node is Node<CanvasNodeData> => Boolean(node))
    const seen = new Set(preferred.map((node) => node.id))
    return [...preferred, ...children.filter((node) => !seen.has(node.id))]
  }, [children, d.orderedChildIds])
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!d.storyboardExportTaskId) return
    let cancelled = false
    const poll = async () => {
      const response = await fetch(`/api/canvas/storyboard-export?taskId=${encodeURIComponent(d.storyboardExportTaskId!)}`)
      const result = await response.json()
      if (cancelled) return
      if (result.status === 'completed') { rf.updateNodeData(id, { storyboardExportTaskId: null, storyboardExportKey: result.resultKey, storyboardExportUrl: result.resultUrl }); return }
      if (result.status === 'failed') { setError(result.error ?? '故事板导出失败'); rf.updateNodeData(id, { storyboardExportTaskId: null }); return }
      pollRef.current = setTimeout(poll, 2000)
    }
    void poll()
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current) }
  }, [d.storyboardExportTaskId, id, rf])

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction; if (target < 0 || target >= ordered.length) return
    const next = ordered.map((node) => node.id); [next[index], next[target]] = [next[target], next[index]]
    rf.updateNodeData(id, { orderedChildIds: next, storyboardExportKey: null, storyboardExportUrl: null })
  }

  const exportStoryboard = async () => {
    const images = ordered.filter((node) => node.type === 'image' && typeof node.data.runId === 'string')
    if (images.length === 0) { setError('分镜组里没有已完成的图片节点'); return }
    setError(null)
    const response = await fetch('/api/canvas/storyboard-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: images.map((node) => node.data.runId), titles: images.map((node) => node.data.title), columns: d.storyboardColumns ?? 4, showShotNumber: d.showShotNumber ?? true }) })
    const result = await response.json()
    if (!response.ok || !result.taskId) { setError(result?.error?.message ?? '提交故事板导出失败'); return }
    rf.updateNodeData(id, { storyboardExportTaskId: result.taskId, storyboardExportKey: null, storyboardExportUrl: null })
  }

  const sendVideosToComposition = () => {
    const videos = ordered.filter((node) => node.type === 'video' && node.data.runId)
    if (videos.length === 0) { setError('分镜组里没有已完成的视频节点'); return }
    const self = rf.getNode(id); if (!self) return
    const compositionId = uid()
    rf.addNodes({ id: compositionId, type: 'composition', position: { x: self.position.x + Number(self.style?.width ?? 500) + 80, y: self.position.y }, data: { ...DEFAULT_NODE_DATA, title: `${d.title || '分镜组'} · 合成`, clipOrder: videos.map((node) => node.id) } })
    rf.addEdges(videos.map((node, index) => ({ id: uid(), source: node.id, target: compositionId, data: { portType: 'video-clip', role: 'clip', order: index } })))
  }

  if (d.groupKind !== 'storyboard') return <div className="h-full w-full" style={{ background: 'rgba(255,255,255,0.04)', border: `1.5px dashed ${selected ? CANVAS_TOKENS.selectedRing : CANVAS_TOKENS.hairline}`, borderRadius: CANVAS_TOKENS.radius.lg }}><div className="px-2.5 py-1.5 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>{d.title || '分组'}</div></div>

  return <div className="h-full w-full p-2" style={{ background: 'rgba(79,210,232,0.06)', border: `1.5px dashed ${selected ? CANVAS_TOKENS.selectedRing : '#4FD2E888'}`, borderRadius: CANVAS_TOKENS.radius.lg }}>
    <div className="mb-1 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>{d.title || '分镜组'} · {ordered.length}</div>
    <div className="flex max-w-full gap-1 overflow-x-auto">{ordered.map((node, index) => <div key={node.id} className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px]" style={{ background: CANVAS_TOKENS.bg.input }}><span>{index + 1}. {node.data.title}</span><button type="button" onClick={() => move(index, -1)}>←</button><button type="button" onClick={() => move(index, 1)}>→</button></div>)}</div>
    <div className="mt-1 flex gap-1"><button type="button" onClick={exportStoryboard} disabled={Boolean(d.storyboardExportTaskId)} className="rounded px-2 py-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover }}>{d.storyboardExportTaskId ? '导出中…' : '导出 4K 故事板'}</button><button type="button" onClick={sendVideosToComposition} className="rounded px-2 py-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover }}>视频送合成</button>{d.storyboardExportUrl ? <a href={d.storyboardExportUrl} target="_blank" rel="noreferrer" className="px-1 text-[9px]">查看</a> : null}</div>
    {error ? <div className="mt-1 text-[9px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
  </div>
}

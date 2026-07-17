'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNodes, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '../lib/canvas-types'
import { completedStoryboardImages, isStoryboardExportStale, moveStoryboardChild, orderStoryboardChildren, storyboardInputsSignature } from '../lib/storyboard-group'

const uid = () => crypto.randomUUID()

export function GroupNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const rf = useReactFlow<Node<CanvasNodeData>, Edge>()
  const canvasNodes = useNodes<Node<CanvasNodeData>>()
  const children = useMemo(() => canvasNodes.filter((node) => node.parentId === id), [canvasNodes, id])
  const ordered = useMemo(() => orderStoryboardChildren(children, d.orderedChildIds ?? []), [children, d.orderedChildIds])
  const currentInputsSig = useMemo(() => storyboardInputsSignature(ordered), [ordered])
  const exportIsStale = isStoryboardExportStale(d.storyboardExportInputsSig, currentInputsSig)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!d.storyboardExportTaskId) return
    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch(`/api/canvas/storyboard-export?taskId=${encodeURIComponent(d.storyboardExportTaskId!)}`)
        const result = await response.json()
        if (!response.ok) throw new Error(result?.error?.message ?? '查询故事板导出任务失败')
        if (cancelled) return
        if (result.status === 'completed') { rf.updateNodeData(id, { storyboardExportTaskId: null, storyboardExportKey: result.resultKey, storyboardExportUrl: result.resultUrl }); return }
        if (result.status === 'failed' || result.status === 'dismissed') { setError(result.error ?? '故事板导出失败'); rf.updateNodeData(id, { storyboardExportTaskId: null }); return }
        pollRef.current = setTimeout(poll, 2000)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '查询故事板导出任务失败')
          rf.updateNodeData(id, { storyboardExportTaskId: null })
        }
      }
    }
    void poll()
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current) }
  }, [d.storyboardExportTaskId, id, rf])

  const move = (index: number, direction: -1 | 1) => {
    const next = moveStoryboardChild(ordered, index, direction)
    if (next) rf.updateNodeData(id, { orderedChildIds: next })
  }

  const exportStoryboard = async () => {
    const images = completedStoryboardImages(ordered)
    if (images.length === 0) { setError('分镜组里没有已完成的图片节点'); return }
    setError(null)
    try {
      const response = await fetch('/api/canvas/storyboard-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: images.map((node) => node.data.runId), titles: images.map((node) => node.data.title), columns: d.storyboardColumns ?? 4, showShotNumber: d.showShotNumber ?? true }) })
      const result = await response.json()
      if (!response.ok || !result.taskId) throw new Error(result?.error?.message ?? '提交故事板导出失败')
      rf.updateNodeData(id, { storyboardExportTaskId: result.taskId, storyboardExportKey: null, storyboardExportUrl: null, storyboardExportInputsSig: currentInputsSig })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交故事板导出失败')
      rf.updateNodeData(id, { storyboardExportTaskId: null })
    }
  }

  const sendVideosToComposition = () => {
    const videos = ordered.filter((node) => node.type === 'video' && node.data.runId)
    if (videos.length === 0) { setError('分镜组里没有已完成的视频节点'); return }
    const self = rf.getNode(id); if (!self) return
    const compositionId = uid()
    rf.addNodes({ id: compositionId, type: 'composition', position: { x: self.position.x + Number(self.style?.width ?? 500) + 80, y: self.position.y }, data: { ...DEFAULT_NODE_DATA, title: `${d.title || '分镜组'} · 合成` } })
    rf.addEdges(videos.map((node, index) => ({ id: uid(), source: node.id, target: compositionId, data: { portType: 'video-clip', role: 'clip', order: index } })))
  }

  if (d.groupKind !== 'storyboard') return <div className="h-full w-full" style={{ background: 'rgba(255,255,255,0.04)', border: `1.5px dashed ${selected ? CANVAS_TOKENS.selectedRing : CANVAS_TOKENS.hairline}`, borderRadius: CANVAS_TOKENS.radius.lg }}><div className="flex items-center justify-between px-2.5 py-1.5 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}><span>{d.title || '分组'}</span>{d.locked ? <span style={{ color: CANVAS_TOKENS.gold }}>● 已锁定</span> : null}</div></div>

  return <div className="h-full w-full p-2" style={{ background: 'rgba(79,210,232,0.06)', border: `1.5px dashed ${selected ? CANVAS_TOKENS.selectedRing : '#4FD2E888'}`, borderRadius: CANVAS_TOKENS.radius.lg }}>
    <div className="mb-1 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>{d.title || '分镜组'} · {ordered.length}</div>
    <div className="flex max-w-full gap-1 overflow-x-auto">{ordered.map((node, index) => <div key={node.id} className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px]" style={{ background: CANVAS_TOKENS.bg.input }}><span>{index + 1}. {node.data.title}</span><button type="button" onClick={() => move(index, -1)}>←</button><button type="button" onClick={() => move(index, 1)}>→</button></div>)}</div>
    <div className="mt-1 flex gap-1"><button type="button" onClick={exportStoryboard} disabled={Boolean(d.storyboardExportTaskId)} className="rounded px-2 py-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover }}>{d.storyboardExportTaskId ? '导出中…' : '导出 4K 故事板'}</button><button type="button" onClick={sendVideosToComposition} className="rounded px-2 py-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover }}>视频送合成</button>{d.storyboardExportUrl ? <a href={d.storyboardExportUrl} target="_blank" rel="noreferrer" className="px-1 text-[9px]">查看</a> : null}{exportIsStale ? <span className="rounded px-1 text-[9px]" style={{ color: '#FFC46B', background: '#FFC46B1A' }}>故事板已过期</span> : null}</div>
    {error ? <div className="mt-1 text-[9px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
  </div>
}

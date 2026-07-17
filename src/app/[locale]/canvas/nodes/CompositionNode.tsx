'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEdges, useNodeConnections, useNodesData, useReactFlow, type Edge, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { orderCompositionInputs, writeCompositionEdgeOrder } from '../lib/composition-order'
import { NodeShell } from './node-shell'
import { SaveCanvasAssetButton, useActiveCanvasId } from '../lib/canvas-assets-client'

export function CompositionNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const canvasId = useActiveCanvasId()
  const { updateNodeData, setEdges } = useReactFlow()
  const edges = useEdges<Edge>()
  const connections = useNodeConnections()
  const incomingIds = useMemo(() => connections.filter((connection) => connection.target === id).map((connection) => connection.source), [connections, id])
  const upstream = useNodesData(incomingIds)
  const available = useMemo(() => upstream
    .filter((node): node is NonNullable<typeof node> => Boolean(
      node && (
        (node.type === 'video' && (node.data as CanvasNodeData).runId)
        || (node.type === 'composition' && (node.data as CanvasNodeData).resultTaskId)
      ),
    ))
    .map((node) => ({ ...node, data: node.data as CanvasNodeData })), [upstream])
  const audioNodes = useMemo(() => upstream.filter((node): node is NonNullable<typeof node> => Boolean(node && node.type === 'audio' && (node.data as CanvasNodeData).audioTaskId)), [upstream])
  const voiceNode = audioNodes.find((node) => ((node.data as CanvasNodeData).audioTrackRole ?? 'voice') === 'voice')
  const musicNode = audioNodes.find((node) => (node.data as CanvasNodeData).audioTrackRole === 'music')
  const ordered = useMemo(() => {
    return orderCompositionInputs(available, edges, id)
  }, [available, edges, id])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const orderBySource = new Map(ordered.map((node, index) => [node.id, index]))
    const needsNormalization = edges.some((edge) => edge.target === id && orderBySource.has(edge.source) && edge.data?.order !== orderBySource.get(edge.source))
    if (needsNormalization) setEdges((current) => writeCompositionEdgeOrder(current, id, ordered.map((node) => node.id)))
  }, [edges, id, ordered, setEdges])

  useEffect(() => {
    if (!d.composeTaskId) return
    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch(`/api/canvas/compose?taskId=${encodeURIComponent(d.composeTaskId!)}`)
        const result = await response.json()
        if (!response.ok) throw new Error(result?.error?.message ?? '查询合成任务失败')
        if (cancelled) return
        if (result.status === 'completed') {
          updateNodeData(id, { composeTaskId: null, resultTaskId: d.composeTaskId, resultKey: result.resultKey, resultUrl: result.resultUrl, durationSec: result.durationSec })
          return
        }
        if (result.status === 'failed' || result.status === 'dismissed') {
          setError(result.error ?? '合成失败')
          updateNodeData(id, { composeTaskId: null })
          return
        }
        pollRef.current = setTimeout(poll, 2000)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '查询合成任务失败')
      }
    }
    void poll()
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current) }
  }, [d.composeTaskId, id, updateNodeData])

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const next = ordered.map((node) => node.id)
    ;[next[index], next[target]] = [next[target], next[index]]
    setEdges((current) => writeCompositionEdgeOrder(current, id, next))
  }

  const submit = async () => {
    const taskIds = ordered.map((node) => {
      const nodeData = node.data as CanvasNodeData
      return node.type === 'composition' ? nodeData.resultTaskId : nodeData.runId
    }).filter((value): value is string => typeof value === 'string' && Boolean(value))
    if (!canvasId) { setError('请先保存画布再合成'); return }
    if (taskIds.length === 0) { setError('请先连接已完成的视频节点'); return }
    setSubmitting(true); setError(null)
    try {
      const response = await fetch('/api/canvas/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        canvasId,
        taskIds,
        transition: d.transition ?? 'cut',
        crossfadeSec: d.crossfadeSec ?? 0.5,
        voiceTaskId: (voiceNode?.data as CanvasNodeData | undefined)?.audioTaskId ?? undefined,
        musicTaskId: (musicNode?.data as CanvasNodeData | undefined)?.audioTaskId ?? undefined,
        voiceVolume: d.voiceVolume ?? 1,
        musicVolume: d.musicVolume ?? 0.25,
        preserveOriginalAudio: d.preserveOriginalAudio ?? true,
      }) })
      const result = await response.json()
      if (!response.ok || !result.taskId) throw new Error(result?.error?.message ?? '提交合成失败')
      updateNodeData(id, { composeTaskId: result.taskId, resultKey: null, resultUrl: null })
    } catch (err) { setError(err instanceof Error ? err.message : '提交合成失败') } finally { setSubmitting(false) }
  }

  const busy = submitting || Boolean(d.composeTaskId)
  return <NodeShell accent={NODE_META.composition.accent} label={NODE_META.composition.label} hint={NODE_META.composition.hint} selected={selected} locked={Boolean(d.locked)} width={330} noSource={!d.resultKey}>
    <div className="space-y-2 p-3">
      <div className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>片段顺序 · {ordered.length}/10</div>
      {ordered.map((node, index) => <div key={node.id} className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: CANVAS_TOKENS.bg.input }}><span className="w-5 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{index + 1}</span><span className="min-w-0 flex-1 truncate text-[11px]">{(node.data as CanvasNodeData).title}</span><button type="button" onClick={() => move(index, -1)} disabled={index === 0}>↑</button><button type="button" onClick={() => move(index, 1)} disabled={index === ordered.length - 1}>↓</button></div>)}
      <div className="flex gap-1"><button type="button" onClick={() => updateNodeData(id, { transition: 'cut' })} className="flex-1 rounded-md py-1 text-[11px]" style={{ background: d.transition !== 'crossfade' ? CANVAS_TOKENS.bg.active : CANVAS_TOKENS.bg.input }}>硬切</button><button type="button" onClick={() => updateNodeData(id, { transition: 'crossfade' })} className="flex-1 rounded-md py-1 text-[11px]" style={{ background: d.transition === 'crossfade' ? CANVAS_TOKENS.bg.active : CANVAS_TOKENS.bg.input }}>交叉淡化</button></div>
      <div className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>音轨：{voiceNode ? '配音 ✓' : '配音 —'} · {musicNode ? '音乐 ✓' : '音乐 —'}</div>
      {voiceNode ? <label className="flex items-center gap-2 text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>配音音量<input type="range" min="0" max="2" step="0.05" value={d.voiceVolume ?? 1} onChange={(event) => updateNodeData(id, { voiceVolume: Number(event.target.value) })} className="nodrag flex-1" /><span>{Math.round((d.voiceVolume ?? 1) * 100)}%</span></label> : null}
      {musicNode ? <label className="flex items-center gap-2 text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>音乐音量<input type="range" min="0" max="2" step="0.05" value={d.musicVolume ?? 0.25} onChange={(event) => updateNodeData(id, { musicVolume: Number(event.target.value) })} className="nodrag flex-1" /><span>{Math.round((d.musicVolume ?? 0.25) * 100)}%</span></label> : null}
      <label className="flex items-center gap-2 text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}><input type="checkbox" checked={d.preserveOriginalAudio ?? true} onChange={(event) => updateNodeData(id, { preserveOriginalAudio: event.target.checked })} />保留原片音轨</label>
      {error ? <div className="text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
      <button type="button" disabled={busy || ordered.length === 0} onClick={submit} className="w-full rounded-lg py-1.5 text-[12px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}>{busy ? '合成中…' : d.resultKey ? '重新合成' : '合成视频（免点数）'}</button>
      {d.resultUrl ? <video src={d.resultUrl} controls className="w-full rounded-md" /> : null}
      <SaveCanvasAssetButton source={d.resultTaskId ? { kind: 'task', taskId: d.resultTaskId } : null} defaultName={d.title || '合成视频'} allowedTypes={['video']} />
    </div>
  </NodeShell>
}

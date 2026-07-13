'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'

export function CompositionNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const connections = useNodeConnections()
  const incomingIds = useMemo(() => connections.filter((connection) => connection.target === id).map((connection) => connection.source), [connections, id])
  const upstream = useNodesData(incomingIds)
  const available = useMemo(() => upstream.filter((node): node is NonNullable<typeof node> => Boolean(node && ((node.type === 'video' && (node.data as CanvasNodeData).runId) || (node.type === 'composition' && (node.data as CanvasNodeData).resultTaskId)))), [upstream])
  const ordered = useMemo(() => {
    const byId = new Map(available.map((node) => [node.id, node]))
    const preferred = (d.clipOrder ?? []).map((nodeId) => byId.get(nodeId)).filter((node): node is NonNullable<typeof node> => Boolean(node))
    const seen = new Set(preferred.map((node) => node.id))
    return [...preferred, ...available.filter((node) => !seen.has(node.id))]
  }, [available, d.clipOrder])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const nextIds = ordered.map((node) => node.id)
    if (JSON.stringify(nextIds) !== JSON.stringify(d.clipOrder ?? [])) updateNodeData(id, { clipOrder: nextIds })
  }, [ordered, d.clipOrder, id, updateNodeData])

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
    updateNodeData(id, { clipOrder: next })
  }

  const submit = async () => {
    const taskIds = ordered.map((node) => {
      const nodeData = node.data as CanvasNodeData
      return node.type === 'composition' ? nodeData.resultTaskId : nodeData.runId
    }).filter((value): value is string => typeof value === 'string' && Boolean(value))
    if (taskIds.length === 0) { setError('请先连接已完成的视频节点'); return }
    setSubmitting(true); setError(null)
    try {
      const response = await fetch('/api/canvas/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds, transition: d.transition ?? 'cut', crossfadeSec: d.crossfadeSec ?? 0.5 }) })
      const result = await response.json()
      if (!response.ok || !result.taskId) throw new Error(result?.error?.message ?? '提交合成失败')
      updateNodeData(id, { composeTaskId: result.taskId, resultKey: null, resultUrl: null })
    } catch (err) { setError(err instanceof Error ? err.message : '提交合成失败') } finally { setSubmitting(false) }
  }

  const busy = submitting || Boolean(d.composeTaskId)
  return <NodeShell accent={NODE_META.composition.accent} label={NODE_META.composition.label} hint={NODE_META.composition.hint} selected={selected} width={330} noSource={!d.resultKey}>
    <div className="space-y-2 p-3">
      <div className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>片段顺序 · {ordered.length}/10</div>
      {ordered.map((node, index) => <div key={node.id} className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: CANVAS_TOKENS.bg.input }}><span className="w-5 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{index + 1}</span><span className="min-w-0 flex-1 truncate text-[11px]">{(node.data as CanvasNodeData).title}</span><button type="button" onClick={() => move(index, -1)} disabled={index === 0}>↑</button><button type="button" onClick={() => move(index, 1)} disabled={index === ordered.length - 1}>↓</button></div>)}
      <div className="flex gap-1"><button type="button" onClick={() => updateNodeData(id, { transition: 'cut' })} className="flex-1 rounded-md py-1 text-[11px]" style={{ background: d.transition !== 'crossfade' ? CANVAS_TOKENS.bg.active : CANVAS_TOKENS.bg.input }}>硬切</button><button type="button" onClick={() => updateNodeData(id, { transition: 'crossfade' })} className="flex-1 rounded-md py-1 text-[11px]" style={{ background: d.transition === 'crossfade' ? CANVAS_TOKENS.bg.active : CANVAS_TOKENS.bg.input }}>交叉淡化</button></div>
      {error ? <div className="text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
      <button type="button" disabled={busy || ordered.length === 0} onClick={submit} className="w-full rounded-lg py-1.5 text-[12px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}>{busy ? '合成中…' : d.resultKey ? '重新合成' : '合成视频（免点数）'}</button>
      {d.resultUrl ? <video src={d.resultUrl} controls className="w-full rounded-md" /> : null}
    </div>
  </NodeShell>
}

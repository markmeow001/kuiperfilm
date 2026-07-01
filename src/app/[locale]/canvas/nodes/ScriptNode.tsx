'use client'

/**
 * Script node — paste (or wire in) a 剧本/story, generate a storyboard shot list
 * via the LLM (CANVAS_STORYBOARD task), then fan the shots out into image nodes.
 *
 * Generation rides the task spine: POST /api/canvas/storyboard → taskId, then
 * poll GET /api/tasks/[taskId] until the worker writes result.shots. No direct
 * LLM call from the client (CLAUDE.md §3).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import { type CanvasNodeData, type CanvasStoryboardShot, DEFAULT_NODE_DATA } from '../lib/canvas-types'
import { pickUpstreamText } from '../lib/canvas-refs'
import { NodeShell } from './node-shell'

type Phase = 'idle' | 'submitting' | 'running' | 'done' | 'failed'

export function ScriptNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData, addNodes, getNode } = useReactFlow()
  const [phase, setPhase] = useState<Phase>(d.shots && d.shots.length > 0 ? 'done' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Wired-in text node (LibTV: connect a Text node holding the full screenplay).
  const connections = useNodeConnections()
  const incoming = useMemo(() => connections.filter((c) => c.target === id).map((c) => c.source), [connections, id])
  const upstream = useNodesData(incoming)
  const upstreamText = useMemo(() => pickUpstreamText(upstream), [upstream])

  const script = (upstreamText || d.prompt || '').trim()
  const shots = d.shots ?? []

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
  }, [])

  // Poll the task until it completes, then store the shots.
  useEffect(() => {
    const taskId = d.storyboardTaskId
    if (!taskId) return
    let cancelled = false
    setPhase('running')
    const tick = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`)
        if (!res.ok) throw new Error(`任务查询失败 (${res.status})`)
        const json = await res.json()
        const task = json?.task
        if (cancelled) return
        if (task?.status === 'completed') {
          const resultShots = (task.result?.shots ?? []) as CanvasStoryboardShot[]
          updateNodeData(id, { shots: resultShots, storyboardTaskId: null })
          setPhase('done')
          return
        }
        if (task?.status === 'failed') {
          setError(task?.error?.message ?? '分镜生成失败')
          updateNodeData(id, { storyboardTaskId: null })
          setPhase('failed')
          return
        }
        pollRef.current = setTimeout(tick, 1500)
      } catch (err) {
        if (cancelled) return
        setError((err as Error)?.message ?? '分镜生成失败')
        setPhase('failed')
      }
    }
    tick()
    return () => { cancelled = true; stopPoll() }
  }, [d.storyboardTaskId, id, updateNodeData, stopPoll])

  async function handleGenerate() {
    if (!script) { setError('请输入或连入剧本'); return }
    setError(null)
    setPhase('submitting')
    try {
      const res = await fetch('/api/canvas/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      })
      const json = await res.json()
      if (!res.ok || !json?.taskId) {
        throw new Error(json?.error?.message ?? json?.error ?? '提交失败')
      }
      updateNodeData(id, { storyboardTaskId: json.taskId, shots: null })
    } catch (err) {
      setError((err as Error)?.message ?? '提交失败')
      setPhase('failed')
    }
  }

  // Fan the shots out into a row of image nodes below this one.
  function handleFanOut() {
    if (shots.length === 0) return
    const self = getNode(id)
    const baseX = self?.position.x ?? 0
    const baseY = (self?.position.y ?? 0) + 360
    const COL_W = 300
    addNodes(
      shots.map((s, i) => {
        const framed = s.shotSize ? `${s.description}（${s.shotSize}）` : s.description
        return {
          id: `n_${Date.now()}_${i}`,
          type: 'image' as const,
          position: { x: baseX + i * COL_W, y: baseY },
          data: {
            ...DEFAULT_NODE_DATA,
            title: `镜 ${s.shotNumber}`,
            prompt: framed,
          },
        }
      }),
    )
  }

  const meta = NODE_META.script
  const busy = phase === 'submitting' || phase === 'running'

  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={320}>
      <div className="space-y-2 p-3">
        {upstreamText ? (
          <div className="rounded-md px-2 py-1 text-[10px]" style={{ background: `${meta.accent}18`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${meta.accent}33` }}>
            剧本 ← 上游：{upstreamText.length > 40 ? upstreamText.slice(0, 40) + '…' : upstreamText}
          </div>
        ) : (
          <textarea
            value={d.prompt}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            placeholder="粘贴剧本 / 故事梗概，或连入一个「文本」节点…"
            rows={5}
            className="nodrag w-full resize-none rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          />
        )}

        {error ? <div className="text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy || !script}
          className="nodrag w-full rounded-md py-1.5 font-mono text-[12px] font-semibold tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: meta.accent, color: '#241A06' }}
        >
          {phase === 'submitting' ? '提交中…' : phase === 'running' ? '拆分镜中…' : shots.length > 0 ? '重新生成分镜' : '生成分镜'}
        </button>

        {shots.length > 0 ? (
          <>
            <div className="max-h-[220px] space-y-1 overflow-y-auto nowheel">
              {shots.map((s) => (
                <div key={s.shotNumber} className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono" style={{ color: meta.accent }}>#{s.shotNumber}</span>
                    {s.shotSize ? <span className="rounded px-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.muted }}>{s.shotSize}</span> : null}
                    {s.cameraMove ? <span className="rounded px-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.muted }}>{s.cameraMove}</span> : null}
                    {typeof s.durationSec === 'number' ? <span className="text-[9px]" style={{ color: CANVAS_TOKENS.text.muted }}>{s.durationSec}s</span> : null}
                  </div>
                  <div className="mt-0.5 leading-snug" style={{ color: CANVAS_TOKENS.text.primary }}>{s.description}</div>
                  {s.dialogue ? <div className="mt-0.5 text-[10px] italic" style={{ color: CANVAS_TOKENS.text.secondary }}>「{s.dialogue}」</div> : null}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleFanOut}
              className="nodrag w-full rounded-md py-1.5 text-[12px] font-semibold"
              style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}
            >
              批量生成分镜（{shots.length} 个图片节点）
            </button>
          </>
        ) : null}
      </div>
    </NodeShell>
  )
}

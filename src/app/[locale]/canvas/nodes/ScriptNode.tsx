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
      // Old index-based selection is meaningless against the new shot list.
      setPicked(null)
    } catch (err) {
      setError((err as Error)?.message ?? '提交失败')
      setPhase('failed')
    }
  }

  // ── Shot-table editing (LibTV script v2 layer 1): edit / delete / reorder /
  // add — always via a NEW array into node data (immutability rule). ──
  // Batch-range selection: which shots the fan-out buttons act on (default all).
  const [picked, setPicked] = useState<Set<number> | null>(null)

  const setShots = (next: CanvasStoryboardShot[]) => updateNodeData(id, { shots: next })
  const editShot = (i: number, patch: Partial<CanvasStoryboardShot>) =>
    setShots(shots.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  // picked stores INDICES, so every structural edit must remap it in the same
  // action — otherwise a delete/reorder silently shifts the selection onto
  // different shots and batch-generate spends money on the wrong ones.
  const deleteShot = (i: number) => {
    setShots(shots.filter((_, j) => j !== i))
    setPicked((p) => {
      if (p === null) return null
      const next = new Set<number>()
      p.forEach((k) => { if (k < i) next.add(k); else if (k > i) next.add(k - 1) })
      return next
    })
  }
  const moveShot = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= shots.length) return
    const next = [...shots]
    ;[next[i], next[j]] = [next[j], next[i]]
    setShots(next)
    setPicked((p) => {
      if (p === null) return null
      const swapped = new Set<number>()
      p.forEach((k) => swapped.add(k === i ? j : k === j ? i : k))
      return swapped
    })
  }
  const addShot = () =>
    setShots([
      ...shots,
      { shotNumber: (shots[shots.length - 1]?.shotNumber ?? 0) + 1, description: '', dialogue: '' },
    ])

  const isPicked = (i: number) => picked === null || picked.has(i)
  const togglePick = (i: number) => {
    const base = picked ?? new Set(shots.map((_, j) => j))
    const next = new Set(base)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setPicked(next)
  }
  const pickedShots = shots.filter((_, i) => isPicked(i))

  // Fan the picked shots out into a row of image OR video nodes below.
  function handleFanOut(target: 'image' | 'video') {
    if (pickedShots.length === 0) return
    const self = getNode(id)
    const baseX = self?.position.x ?? 0
    const baseY = (self?.position.y ?? 0) + 360
    const COL_W = target === 'image' ? 300 : 320
    addNodes(
      pickedShots.map((s, i) => {
        const framed = s.shotSize ? `${s.description}（${s.shotSize}）` : s.description
        return {
          id: `n_${Date.now()}_${target}_${i}`,
          type: target,
          position: { x: baseX + i * COL_W, y: baseY + (target === 'video' ? 40 : 0) },
          data: {
            ...DEFAULT_NODE_DATA,
            title: `镜 ${s.shotNumber}`,
            // Video shots carry the LLM's camera move + duration into the node.
            prompt: target === 'video' && s.cameraMove ? `${framed}，运镜：${s.cameraMove}` : framed,
            // genMode intentionally NOT pinned: MediaNode's heuristic picks
            // 图生 when the user later wires in refs (pinning 'text' would
            // silently drop them).
            ...(target === 'video'
              ? { durationSec: Math.min(Math.max(Math.round(s.durationSec ?? 5), 5), 15) }
              : {}),
          },
        }
      }),
    )
  }

  const meta = NODE_META.script
  const busy = phase === 'submitting' || phase === 'running'

  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={380}>
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
            <div className="flex items-center justify-between text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
              <span>勾选要批量生成的镜头（{pickedShots.length}/{shots.length}）</span>
              <button type="button" className="nodrag underline" onClick={() => setPicked(picked === null ? new Set() : null)}>
                {picked === null ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="max-h-[260px] space-y-1 overflow-y-auto nowheel">
              {shots.map((s, i) => (
                <div key={`${s.shotNumber}-${i}`} className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${isPicked(i) ? `${meta.accent}66` : CANVAS_TOKENS.hairline}` }}>
                  <div className="flex items-center gap-1.5">
                    <input type="checkbox" checked={isPicked(i)} onChange={() => togglePick(i)} className="nodrag h-3 w-3 accent-current" style={{ color: meta.accent }} />
                    <span className="font-mono" style={{ color: meta.accent }}>#{s.shotNumber}</span>
                    {s.shotSize ? <span className="rounded px-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.muted }}>{s.shotSize}</span> : null}
                    {s.cameraMove ? <span className="rounded px-1 text-[9px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.muted }}>{s.cameraMove}</span> : null}
                    {typeof s.durationSec === 'number' ? <span className="text-[9px]" style={{ color: CANVAS_TOKENS.text.muted }}>{s.durationSec}s</span> : null}
                    <span className="ml-auto flex items-center gap-1">
                      <button type="button" title="上移" onClick={() => moveShot(i, -1)} disabled={i === 0} className="nodrag disabled:opacity-25" style={{ color: CANVAS_TOKENS.text.muted }}>↑</button>
                      <button type="button" title="下移" onClick={() => moveShot(i, 1)} disabled={i === shots.length - 1} className="nodrag disabled:opacity-25" style={{ color: CANVAS_TOKENS.text.muted }}>↓</button>
                      <button type="button" title="删除镜头" onClick={() => deleteShot(i)} className="nodrag" style={{ color: '#FF8A8A' }}>×</button>
                    </span>
                  </div>
                  <textarea
                    value={s.description}
                    onChange={(e) => editShot(i, { description: e.target.value })}
                    rows={2}
                    placeholder="画面描述…"
                    className="nodrag mt-1 w-full resize-none rounded px-1.5 py-1 text-[11px] leading-snug outline-none"
                    style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                  />
                  <input
                    value={s.dialogue ?? ''}
                    onChange={(e) => editShot(i, { dialogue: e.target.value })}
                    placeholder="对白 / 旁白（可空）"
                    className="nodrag mt-1 w-full rounded px-1.5 py-0.5 text-[10px] italic outline-none"
                    style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                  />
                </div>
              ))}
            </div>
            <button type="button" onClick={addShot} className="nodrag w-full rounded-md py-1 text-[11px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
              ＋ 添加镜头
            </button>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => handleFanOut('image')}
                disabled={pickedShots.length === 0}
                className="nodrag flex-1 rounded-lg py-1.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}
              >
                生成分镜图（{pickedShots.length}）
              </button>
              <button
                type="button"
                onClick={() => handleFanOut('video')}
                disabled={pickedShots.length === 0}
                className="nodrag flex-1 rounded-lg py-1.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                生成视频（{pickedShots.length}）
              </button>
            </div>
          </>
        ) : null}
      </div>
    </NodeShell>
  )
}

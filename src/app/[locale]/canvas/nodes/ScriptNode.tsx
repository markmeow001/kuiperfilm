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
import { useNodeConnections, useNodesData, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import { type CanvasNodeData, type CanvasStoryboardShot, DEFAULT_NODE_DATA } from '../lib/canvas-types'
import { pickUpstreamReferenceUrls, pickUpstreamText } from '../lib/canvas-refs'
import { composeShotImagePrompt, composeShotVideoPrompt } from '../lib/shot-prompt'
import { useCanvasGeneration } from '../lib/canvas-generation'
import { buildStoryboardBlockingBrief } from '../lib/storyboard-director-handoff'
import { NodeShell } from './node-shell'

type Phase = 'idle' | 'submitting' | 'running' | 'done' | 'failed'

/** Upstream node types that count as bound references, with their user-facing
 *  kind labels（已绑参考 chips + fan-out filters share this single map）。 */
const REF_KIND_LABEL: Record<string, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  director: '导演台',
  image: '图片',
}

export function ScriptNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData, addNodes, addEdges, getNode } = useReactFlow()
  const gen = useCanvasGeneration()
  const [phase, setPhase] = useState<Phase>(d.shots && d.shots.length > 0 ? 'done' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Wired-in text node (LibTV: connect a Text node holding the full screenplay).
  const connections = useNodeConnections()
  const incoming = useMemo(() => connections.filter((c) => c.target === id).map((c) => c.source), [connections, id])
  const upstream = useNodesData(incoming)
  const upstreamText = useMemo(() => pickUpstreamText(upstream), [upstream])
  // 接进脚本节点的角色/场景/道具/图片/导演台上游 — 参考只绑在脚本上,
  // 批量生图与铺出的镜头节点都经由脚本读同一组参考。
  const refSourceIds = useMemo(
    () =>
      upstream
        .filter((n): n is NonNullable<typeof n> =>
          Boolean(n) && typeof n!.type === 'string' && n!.type! in REF_KIND_LABEL)
        .map((n) => n.id),
    [upstream],
  )
  const upstreamRefs = useMemo(() => pickUpstreamReferenceUrls(upstream, id), [upstream, id])
  // Human-readable labels for the bound refs so the user can see WHAT is
  // bound, not just a count. A node's own type label as its title (the old
  // default) adds nothing — only a user-given name is appended.
  const boundRefLabels = useMemo(
    () =>
      upstream
        .filter((n): n is NonNullable<typeof n> =>
          Boolean(n) && typeof n!.type === 'string' && n!.type! in REF_KIND_LABEL)
        .map((n) => {
          const kind = REF_KIND_LABEL[n.type as string]
          const title = (n.data as CanvasNodeData)?.title?.trim()
          return title && title !== kind ? `${kind}·${title}` : kind
        }),
    [upstream],
  )

  // Publish the resolved refs onto this node's data. Spawned shot nodes read
  // them through their single 脚本→镜头 edge (canvas-refs), so per-shot
  // regeneration uses exactly the refs batch generation used — without the
  // old N×M 参考→镜头 wire fan that misread as「参考绕过了脚本」.
  useEffect(() => {
    const current = Array.isArray(d.refUrls) ? d.refUrls : []
    if (current.length === upstreamRefs.length && current.every((v, i) => v === upstreamRefs[i])) return
    updateNodeData(id, { refUrls: upstreamRefs })
  }, [upstreamRefs, d.refUrls, id, updateNodeData])

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
          const resultColorTone = typeof task.result?.colorTone === 'string'
            ? task.result.colorTone.trim()
            : ''
          updateNodeData(id, {
            shots: resultShots,
            colorTone: resultColorTone || null,
            storyboardTaskId: null,
          })
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

  // Fan the picked shots out into a row of image OR video nodes below, wired
  // 脚本→镜头 only. 参考(角色/场景/道具/图片/导演台)绑在脚本上,镜头经这条
  // 边读脚本 data.refUrls(canvas-refs)——批量生成和之后的单镜重生因此拿到同
  // 一组参考。2026-07-08 曾为「区块都独立」观感补过 参考→镜头 的 N×M 连线,
  // 2026-08-19 用户反馈那让参考看起来绕过了脚本(蜘蛛网+语义误导),移除。
  // Returns spawned ids so 批量生成 can submit them right after.
  function spawnShotNodes(target: 'image' | 'video', imageModelKey?: string): string[] {
    if (pickedShots.length === 0) return []
    const self = getNode(id)
    const baseX = self?.position.x ?? 0
    const baseY = (self?.position.y ?? 0) + 360
    const COL_W = target === 'image' ? 300 : 320
    const stamp = Date.now()
    const ids = pickedShots.map((_, i) => `n_${stamp}_${target}_${i}`)
    addNodes(
      pickedShots.map((s, i) => {
        return {
          id: ids[i],
          type: target,
          position: { x: baseX + i * COL_W, y: baseY + (target === 'video' ? 40 : 0) },
          data: {
            ...DEFAULT_NODE_DATA,
            title: `镜 ${s.shotNumber}`,
            // 与批量生图同一个组装函数——镜头语言/表演/站位/色调都进 prompt。
            prompt: target === 'video'
              ? composeShotVideoPrompt(s, d.colorTone)
              : composeShotImagePrompt(s, d.colorTone),
            // Spawned image nodes inherit the script node's chosen 生图模型 so
            // 仅铺图 / 后续手动重生都用同一个模型(而非各自的默认)。
            ...(target === 'image' && imageModelKey ? { modelKey: imageModelKey } : {}),
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
    const edges: Edge[] = ids.map((nid, i) => (
      { id: `e_${stamp}_s_${i}`, source: id, target: nid, animated: true }
    ))
    if (edges.length > 0) addEdges(edges)
    return ids
  }

  function openPickedShotsInDirector() {
    if (pickedShots.length === 0) return
    // 导演台契约只吃 character/image 当卡司(canvas-connections ACCEPTS)；
    // 场景/道具是生图参考,不是 3D 排戏的演员,不接过去。
    const directorCastIds = upstream
      .filter((n): n is NonNullable<typeof n> =>
        Boolean(n) && (n!.type === 'character' || n!.type === 'image'))
      .map((n) => n.id)
    const self = getNode(id)
    const base = self?.position ?? { x: 0, y: 0 }
    const directorId = `n_${Date.now()}_director`
    const brief = buildStoryboardBlockingBrief(pickedShots)
    const node: Node<CanvasNodeData> = {
      id: directorId,
      type: 'director',
      position: { x: base.x + 580, y: base.y },
      data: {
        ...DEFAULT_NODE_DATA,
        title: `导演台 · ${pickedShots.length} 镜`,
        blockingBrief: brief,
        openDirectorOnCreate: true,
      },
    }
    addNodes(node)
    const edges: Edge[] = directorCastIds.map((sourceId, index) => ({
      id: `e_${Date.now()}_director_${index}`,
      source: sourceId,
      target: directorId,
      animated: true,
    }))
    if (edges.length > 0) addEdges(edges)
  }

  // 批量生图:铺节点 + 接线 + 逐个提交生成(LibTV「批量生分镜图」等价)。
  // 顺序提交而非并发:避免瞬间打爆队列/余额;单发失败立即停,后续镜头
  // 不再扣费。
  const [batch, setBatch] = useState<{ done: number; total: number; running: boolean; error: string | null }>(
    { done: 0, total: 0, running: false, error: null },
  )
  // Effective 生图模型: the node's chosen model if it's still enabled, else the
  // first available (picker must never render a disabled/stale model — feedback
  // 「picker 必过滤启用清单」).
  const effectiveImageModel = useMemo(() => {
    if (d.modelKey && gen.imageModels.some((m) => m.value === d.modelKey)) return d.modelKey
    return gen.imageModels[0]?.value ?? ''
  }, [d.modelKey, gen.imageModels])

  async function handleBatchGenerate() {
    if (pickedShots.length === 0 || batch.running) return
    const modelKey = effectiveImageModel
    if (!modelKey) {
      setBatch({ done: 0, total: 0, running: false, error: '无可用图片模型 — 请到 /profile 启用' })
      return
    }
    const ids = spawnShotNodes('image', modelKey)
    setBatch({ done: 0, total: ids.length, running: true, error: null })
    for (let i = 0; i < ids.length; i++) {
      const s = pickedShots[i]
      try {
        const runId = await gen.submitNode({
          prompt: composeShotImagePrompt(s, d.colorTone),
          referenceImages: upstreamRefs,
          outputType: 'image',
          modelKey,
          aspectRatio: DEFAULT_NODE_DATA.aspectRatio,
        })
        updateNodeData(ids[i], { runId, modelKey })
        setBatch((b) => ({ ...b, done: i + 1 }))
      } catch (err) {
        setBatch((b) => ({
          ...b,
          running: false,
          error: `镜 ${s.shotNumber} 提交失败：${(err as Error)?.message ?? '未知错误'}（其余已停止）`,
        }))
        return
      }
    }
    setBatch((b) => ({ ...b, running: false }))
  }

  const meta = NODE_META.script
  const busy = phase === 'submitting' || phase === 'running'

  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} locked={Boolean(d.locked)} width={520}>
      <div className="space-y-2 p-4">
        {upstreamText ? (
          <div className="rounded-md px-2 py-1.5 text-[12px]" style={{ background: `${meta.accent}18`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${meta.accent}33` }}>
            剧本 ← 上游：{upstreamText.length > 60 ? upstreamText.slice(0, 60) + '…' : upstreamText}
          </div>
        ) : (
          <textarea
            value={d.prompt}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            placeholder="粘贴剧本 / 故事梗概，或连入一个「文本」节点…"
            rows={8}
            className="nodrag nowheel w-full resize-y rounded-md px-2.5 py-2 text-[13px] leading-relaxed outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}`, minHeight: 140, maxHeight: 420 }}
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
            {/* 全片统一色调 — LLM 拆分镜时产出,可手改;批量生图拼进每镜 prompt。 */}
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[12px]" style={{ color: CANVAS_TOKENS.text.muted }}>整体色调</span>
              <input
                value={d.colorTone ?? ''}
                onChange={(e) => updateNodeData(id, { colorTone: e.target.value || null })}
                placeholder="全片统一的色调与视觉风格，如：冷蓝夜色、胶片颗粒…"
                className="nodrag min-w-0 flex-1 rounded-md px-2 py-1.5 text-[12px] outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              />
            </div>
            <div className="flex items-center justify-between text-[12px]" style={{ color: CANVAS_TOKENS.text.muted }}>
              <span>勾选要批量生成的镜头（{pickedShots.length}/{shots.length}）</span>
              <button type="button" className="nodrag underline" onClick={() => setPicked(picked === null ? new Set() : null)}>
                {picked === null ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="max-h-[460px] space-y-1.5 overflow-y-auto nowheel">
              {shots.map((s, i) => (
                <div key={`${s.shotNumber}-${i}`} className="rounded-md px-2.5 py-2 text-[12px]" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${isPicked(i) ? `${meta.accent}66` : CANVAS_TOKENS.hairline}` }}>
                  <div className="flex items-center gap-1.5">
                    <input type="checkbox" checked={isPicked(i)} onChange={() => togglePick(i)} className="nodrag h-3.5 w-3.5 accent-current" style={{ color: meta.accent }} />
                    <span className="font-mono text-[12px]" style={{ color: meta.accent }}>#{s.shotNumber}</span>
                    {typeof s.durationSec === 'number' ? <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{s.durationSec}s</span> : null}
                    <span className="ml-auto flex items-center gap-1.5">
                      <button type="button" title="上移" onClick={() => moveShot(i, -1)} disabled={i === 0} className="nodrag disabled:opacity-25" style={{ color: CANVAS_TOKENS.text.muted }}>↑</button>
                      <button type="button" title="下移" onClick={() => moveShot(i, 1)} disabled={i === shots.length - 1} className="nodrag disabled:opacity-25" style={{ color: CANVAS_TOKENS.text.muted }}>↓</button>
                      <button type="button" title="删除镜头" onClick={() => deleteShot(i)} className="nodrag" style={{ color: '#FF8A8A' }}>×</button>
                    </span>
                  </div>
                  <textarea
                    value={s.description}
                    onChange={(e) => editShot(i, { description: e.target.value })}
                    rows={3}
                    placeholder="画面描述…"
                    className="nodrag nowheel mt-1.5 w-full resize-y rounded px-2 py-1.5 text-[12px] leading-relaxed outline-none"
                    style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}`, minHeight: 56 }}
                  />
                  {/* 镜头语言四件套 — 全部可编辑,生成 prompt 逐项标注拼入
                      (shot-prompt.ts,批量与单镜重生同一组装点)。 */}
                  <div className="mt-1 grid grid-cols-4 gap-1">
                    {([
                      ['shotSize', '景别', s.shotSize],
                      ['cameraMove', '运镜', s.cameraMove],
                      ['cameraAngle', '机位', s.cameraAngle],
                      ['lens', '镜头', s.lens],
                    ] as const).map(([field, label, value]) => (
                      <input
                        key={field}
                        value={value ?? ''}
                        onChange={(e) => editShot(i, { [field]: e.target.value })}
                        placeholder={label}
                        title={label}
                        className="nodrag min-w-0 rounded px-1.5 py-1 text-[11px] outline-none"
                        style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                      />
                    ))}
                  </div>
                  <input
                    value={s.performance ?? ''}
                    onChange={(e) => editShot(i, { performance: e.target.value })}
                    placeholder="人物表演与情绪（谁、什么情绪、怎么演）"
                    className="nodrag mt-1 w-full rounded px-2 py-1 text-[11px] outline-none"
                    style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                  />
                  <input
                    value={s.blocking ?? ''}
                    onChange={(e) => editShot(i, { blocking: e.target.value })}
                    placeholder="站位与调度（谁在画面哪个位置、朝向、走位）"
                    className="nodrag mt-1 w-full rounded px-2 py-1 text-[11px] outline-none"
                    style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                  />
                  <input
                    value={s.dialogue ?? ''}
                    onChange={(e) => editShot(i, { dialogue: e.target.value })}
                    placeholder="对白 / 旁白（可空）"
                    className="nodrag mt-1 w-full rounded px-2 py-1 text-[11px] italic outline-none"
                    style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                  />
                </div>
              ))}
            </div>
            <button type="button" onClick={addShot} className="nodrag w-full rounded-md py-1 text-[11px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
              ＋ 添加镜头
            </button>
            {/* 生图模型 picker — 只列已启用的模型（feedback「picker 必过滤启用清单」）。
                批量生图 + 铺出的镜头节点都用这个模型。 */}
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[12px]" style={{ color: CANVAS_TOKENS.text.muted }}>生图模型</span>
              <select
                value={effectiveImageModel}
                onChange={(e) => updateNodeData(id, { modelKey: e.target.value })}
                className="nodrag min-w-0 flex-1 truncate rounded-md px-2 py-1.5 font-mono text-[12px] outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                {gen.imageModels.length === 0 ? <option value="">无可用模型 · 去 /profile 启用</option> : null}
                {gen.imageModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {/* 参考绑定 — 始终可见的引导。把「角色/场景/道具」(或图片)节点连
                进本脚本节点,参考会自动带入每个镜头(一致性的关键)。 */}
            {refSourceIds.length > 0 ? (
              <div className="rounded-md px-2 py-1.5 text-[12px]" style={{ background: `${meta.accent}18`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${meta.accent}33` }}>
                ✅ 已绑参考（{refSourceIds.length}）：{boundRefLabels.join('、')} — 批量生图会带入每个镜头
              </div>
            ) : (
              <div className="rounded-md px-2 py-1.5 text-[12px] leading-relaxed" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.muted, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
                💡 想让人物 / 场景 / 道具一致？把「角色」「场景」「道具」节点连到本脚本节点左侧的 <span style={{ color: meta.accent }}>＋</span> 口，参考会自动带入每个镜头。<span style={{ color: '#FF8A8A' }}>没绑参考时生成的是通用画面（人物会不一致）。</span>
              </div>
            )}
            <button
              type="button"
              onClick={handleBatchGenerate}
              disabled={pickedShots.length === 0 || batch.running}
              className="nodrag w-full rounded-lg py-2 text-[13px] font-semibold disabled:opacity-40"
              style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}
            >
              {batch.running ? `批量生图中… ${batch.done}/${batch.total}` : `⚡ 批量生图（${pickedShots.length}）`}
            </button>
            <button
              type="button"
              onClick={openPickedShotsInDirector}
              disabled={pickedShots.length === 0 || batch.running}
              className="nodrag w-full rounded-lg py-2 text-[13px] font-semibold disabled:opacity-40"
              style={{ background: `${NODE_META.director.accent}22`, color: NODE_META.director.accent, border: `1px solid ${NODE_META.director.accent}66` }}
            >
              打开 3D 导演台排戏（{pickedShots.length} 镜）
            </button>
            {batch.error ? <div className="text-[12px]" style={{ color: '#FF8A8A' }}>{batch.error}</div> : null}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => spawnShotNodes('image', effectiveImageModel)}
                disabled={pickedShots.length === 0 || batch.running}
                className="nodrag flex-1 rounded-lg py-2 text-[13px] font-semibold disabled:opacity-40"
                style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                仅铺图节点（{pickedShots.length}）
              </button>
              <button
                type="button"
                onClick={() => spawnShotNodes('video')}
                disabled={pickedShots.length === 0 || batch.running}
                className="nodrag flex-1 rounded-lg py-2 text-[13px] font-semibold disabled:opacity-40"
                style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                仅铺视频节点（{pickedShots.length}）
              </button>
            </div>
          </>
        ) : null}
      </div>
    </NodeShell>
  )
}

'use client'

/**
 * Script node — LibTV「脚本生成器」：紧凑卡片（三步进度 + 打开全屏编辑器）。
 *
 * 生成链路全部走 task spine（CLAUDE.md §3，无客户端直连 LLM）：
 * - 拆分镜: POST /api/canvas/storyboard → CANVAS_STORYBOARD（shots + 资产清单
 *   + 全局风格）
 * - 合成提示词: POST /api/canvas/shot-prompts → CANVAS_SHOT_PROMPTS（每镜
 *   finalPrompt + 出场资产）
 * - 资产设定图 / 批量生图 / 批量生视频: playground run 脊柱（gen.submitNode）
 * 三步状态都存在节点 data，随画布序列化。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import {
  type CanvasNodeData,
  type CanvasScriptAsset,
  type CanvasStoryboardShot,
  DEFAULT_NODE_DATA,
} from '../lib/canvas-types'
import { pickUpstreamReferenceUrls, pickUpstreamText } from '../lib/canvas-refs'
import { useCanvasGeneration } from '../lib/canvas-generation'
import { buildStoryboardBlockingBrief } from '../lib/storyboard-director-handoff'
import { ScriptGeneratorStage, type ScriptGenStep } from '../script-gen/ScriptGeneratorStage'
import {
  newScriptAssetId,
  scriptGenProgress,
  shotEditInvalidatesPrompt,
  shotReferenceKeys,
} from '../script-gen/script-gen-lib'
import { NodeShell } from './node-shell'

type Phase = 'idle' | 'submitting' | 'running' | 'done' | 'failed'

/** Upstream node types that count as bound references, with their user-facing
 *  kind labels（已绑参考 chips + 导演台 handoff share this single map）。 */
const REF_KIND_LABEL: Record<string, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  director: '导演台',
  image: '图片',
}

/** 合成提交时的镜头快照签名——只含会进入合成输入的字段。 */
function promptsSignature(shots: readonly CanvasStoryboardShot[]): string {
  return JSON.stringify(shots.map((s) => [
    s.shotNumber, s.description, s.shotSize, s.cameraMove, s.cameraAngle,
    s.lens, s.performance, s.blocking, s.lighting, s.sfx, s.dialogue,
  ]))
}

export function ScriptNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData, addNodes, addEdges, getNode } = useReactFlow()
  const gen = useCanvasGeneration()
  const [phase, setPhase] = useState<Phase>(d.shots && d.shots.length > 0 ? 'done' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [synthError, setSynthError] = useState<string | null>(null)
  const [stage, setStage] = useState<ScriptGenStep | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connections = useNodeConnections()
  const incoming = useMemo(() => connections.filter((c) => c.target === id).map((c) => c.source), [connections, id])
  const upstream = useNodesData(incoming)
  const upstreamText = useMemo(() => pickUpstreamText(upstream), [upstream])
  const upstreamRefs = useMemo(() => pickUpstreamReferenceUrls(upstream, id), [upstream, id])

  const script = (upstreamText || d.prompt || '').trim()
  const shots = useMemo(() => d.shots ?? [], [d.shots])
  const assets = useMemo(() => d.scriptAssets ?? [], [d.scriptAssets])
  const globalStyle = d.globalStyle ?? ''
  const progress = useMemo(() => scriptGenProgress(shots, assets), [shots, assets])

  // Publish resolved refs onto node data: wired-in reference nodes + every
  // asset 设定图. Spawned shot nodes read them through their single 脚本→镜头
  // edge (canvas-refs) so per-shot regeneration keeps the cast without N×M
  // wire fans. Batch submits use the tighter per-shot entity refs.
  useEffect(() => {
    const assetKeys = assets.map((asset) => asset.imageKey).filter((key): key is string => Boolean(key))
    const next = [...upstreamRefs, ...assetKeys.filter((key) => !upstreamRefs.includes(key))]
    const current = Array.isArray(d.refUrls) ? d.refUrls : []
    if (current.length === next.length && current.every((v, i) => v === next[i])) return
    updateNodeData(id, { refUrls: next })
  }, [upstreamRefs, assets, d.refUrls, id, updateNodeData])

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
  }, [])

  // ── 拆分镜任务轮询：shots + 资产清单（按名合并，保留已生成的图）+ 全局风格 ──
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
          const resultStyle = typeof task.result?.globalStyle === 'string' ? task.result.globalStyle.trim() : ''
          const resultAssets = Array.isArray(task.result?.assets)
            ? task.result.assets as Array<{ kind: CanvasScriptAsset['kind']; name: string; description: string }>
            : []
          const prevByName = new Map((d.scriptAssets ?? []).map((asset) => [asset.name, asset]))
          const mergedAssets: CanvasScriptAsset[] = resultAssets.map((asset) => {
            const prev = prevByName.get(asset.name)
            return {
              id: prev?.id ?? newScriptAssetId(),
              kind: asset.kind,
              name: asset.name,
              description: asset.description,
              // 重新拆分镜不作废已经生成/上传过的设定图。
              imageKey: prev?.imageKey ?? null,
              imageUrl: prev?.imageUrl ?? null,
              runId: prev?.runId ?? null,
            }
          })
          updateNodeData(id, {
            shots: resultShots,
            globalStyle: resultStyle || null,
            scriptAssets: mergedAssets,
            storyboardTaskId: null,
            // 新分镜 → 旧合成任务作废。
            promptsTaskId: null,
            promptsSig: null,
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
  }, [d.storyboardTaskId, d.scriptAssets, id, updateNodeData, stopPoll])

  // ── 合成提示词任务轮询：镜头漂移则丢弃（fail-closed），否则按序写回 ──
  useEffect(() => {
    const taskId = d.promptsTaskId
    if (!taskId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`)
        if (!res.ok) throw new Error(`任务查询失败 (${res.status})`)
        const json = await res.json()
        const task = json?.task
        if (cancelled) return
        if (task?.status === 'completed') {
          const prompts = (task.result?.prompts ?? []) as Array<{ shotNumber: number; finalPrompt: string; entities: string[] }>
          const current = d.shots ?? []
          if (promptsSignature(current) !== d.promptsSig || prompts.length !== current.length) {
            setSynthError('镜头在合成期间被修改，结果已丢弃——请重新合成')
            updateNodeData(id, { promptsTaskId: null, promptsSig: null })
            return
          }
          updateNodeData(id, {
            shots: current.map((shot, i) => ({
              ...shot,
              finalPrompt: prompts[i].finalPrompt,
              entities: prompts[i].entities,
            })),
            promptsTaskId: null,
            promptsSig: null,
          })
          setSynthError(null)
          return
        }
        if (task?.status === 'failed') {
          setSynthError(task?.error?.message ?? '提示词合成失败')
          updateNodeData(id, { promptsTaskId: null, promptsSig: null })
          return
        }
        setTimeout(tick, 1500)
      } catch (err) {
        if (cancelled) return
        setSynthError((err as Error)?.message ?? '提示词合成失败')
      }
    }
    tick()
    return () => { cancelled = true }
  }, [d.promptsTaskId, d.promptsSig, d.shots, id, updateNodeData])

  // ── 资产设定图 run → durable key（use-as-reference，与 ReferenceNode 同路） ──
  const ingestingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const asset of assets) {
      if (!asset.runId || ingestingRef.current.has(asset.runId)) continue
      const run = gen.runById(asset.runId)
      if (!run) continue
      if (run.status === 'failed') {
        ingestingRef.current.add(asset.runId)
        const failedRunId = asset.runId
        updateNodeData(id, {
          scriptAssets: (d.scriptAssets ?? []).map((a) => (a.runId === failedRunId ? { ...a, runId: null } : a)),
        })
        setError(`资产「${asset.name}」生成失败${run.errorMessage ? `：${run.errorMessage}` : ''}`)
        continue
      }
      if (run.status !== 'succeeded') continue
      ingestingRef.current.add(asset.runId)
      const runId = asset.runId
      void (async () => {
        try {
          const res = await fetch('/api/canvas/use-as-reference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
          })
          if (!res.ok) throw new Error('设定图导入失败')
          const { key, url } = (await res.json()) as { key: string; url: string }
          const node = getNode(id)
          const latest = ((node?.data as CanvasNodeData | undefined)?.scriptAssets ?? [])
          updateNodeData(id, {
            scriptAssets: latest.map((a) => (a.runId === runId ? { ...a, imageKey: key, imageUrl: url, runId: null } : a)),
          })
        } catch (err) {
          ingestingRef.current.delete(runId)
          setError((err as Error)?.message ?? '设定图导入失败')
        }
      })()
    }
  }, [assets, gen, d.scriptAssets, id, updateNodeData, getNode])

  // ── mutators（一律新数组；改会影响合成输入的字段 → 该镜合成结果作废） ──
  const setShots = useCallback((next: CanvasStoryboardShot[]) => updateNodeData(id, { shots: next }), [id, updateNodeData])
  const editShot = useCallback((i: number, patch: Partial<CanvasStoryboardShot>) => {
    const invalidate = shotEditInvalidatesPrompt(patch)
    setShots(shots.map((s, j) => (
      j === i
        ? { ...s, ...patch, ...(invalidate ? { finalPrompt: undefined, entities: undefined } : {}) }
        : s
    )))
  }, [shots, setShots])
  const deleteShot = useCallback((i: number) => setShots(shots.filter((_, j) => j !== i)), [shots, setShots])
  const moveShot = useCallback((i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= shots.length) return
    const next = [...shots]
    ;[next[i], next[j]] = [next[j], next[i]]
    setShots(next)
  }, [shots, setShots])
  const addShot = useCallback(() => {
    setShots([...shots, { shotNumber: (shots[shots.length - 1]?.shotNumber ?? 0) + 1, description: '', dialogue: '' }])
  }, [shots, setShots])

  const setAssets = useCallback((next: CanvasScriptAsset[]) => updateNodeData(id, { scriptAssets: next }), [id, updateNodeData])
  const editAsset = useCallback((assetId: string, patch: Partial<CanvasScriptAsset>) => {
    setAssets(assets.map((a) => (a.id === assetId ? { ...a, ...patch } : a)))
  }, [assets, setAssets])
  const addAsset = useCallback((asset: CanvasScriptAsset) => setAssets([...assets, asset]), [assets, setAssets])
  const deleteAsset = useCallback((assetId: string) => setAssets(assets.filter((a) => a.id !== assetId)), [assets, setAssets])
  const setGlobalStyle = useCallback((value: string) => updateNodeData(id, { globalStyle: value || null }), [id, updateNodeData])

  // ── 拆分镜 ──
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
      if (!res.ok || !json?.taskId) throw new Error(json?.error?.message ?? json?.error ?? '提交失败')
      updateNodeData(id, { storyboardTaskId: json.taskId })
    } catch (err) {
      setError((err as Error)?.message ?? '提交失败')
      setPhase('failed')
    }
  }

  // ── 一键合成全部提示词 ──
  const synthesizing = Boolean(d.promptsTaskId)
  async function handleSynthesizeAll() {
    if (synthesizing || shots.length === 0) return
    setSynthError(null)
    try {
      const payloadShots = shots.map(({ finalPrompt: _fp, entities: _e, ...rest }) => rest)
      const payloadAssets = assets
        .filter((asset) => asset.name.trim() && asset.description.trim())
        .map((asset) => ({ kind: asset.kind, name: asset.name.trim(), description: asset.description.trim() }))
      const res = await fetch('/api/canvas/shot-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shots: payloadShots, assets: payloadAssets, globalStyle }),
      })
      const json = await res.json()
      if (!res.ok || !json?.taskId) throw new Error(json?.error?.message ?? json?.error ?? '提交失败')
      updateNodeData(id, { promptsTaskId: json.taskId, promptsSig: promptsSignature(shots) })
    } catch (err) {
      setSynthError((err as Error)?.message ?? '提交失败')
    }
  }

  // ── 批量生图 / 批量生视频（三步全过才解锁；prompt=finalPrompt，参考=出场资产） ──
  const effectiveImageModel = useMemo(() => {
    if (d.modelKey && gen.imageModels.some((m) => m.value === d.modelKey)) return d.modelKey
    return gen.imageModels[0]?.value ?? ''
  }, [d.modelKey, gen.imageModels])
  const effectiveVideoModel = useMemo(() => {
    if (d.videoModelKey && gen.videoModels.some((m) => m.value === d.videoModelKey)) return d.videoModelKey
    return gen.videoModels[0]?.value ?? ''
  }, [d.videoModelKey, gen.videoModels])

  const [batch, setBatch] = useState<{ done: number; total: number; running: boolean; error: string | null }>(
    { done: 0, total: 0, running: false, error: null },
  )

  async function handleBatch(target: 'image' | 'video') {
    if (!progress.batchReady || batch.running) return
    const modelKey = target === 'image' ? effectiveImageModel : effectiveVideoModel
    if (!modelKey) {
      setBatch({ done: 0, total: 0, running: false, error: `无可用${target === 'image' ? '图片' : '视频'}模型 — 请到 /profile 启用` })
      return
    }
    const self = getNode(id)
    const baseX = self?.position.x ?? 0
    const baseY = (self?.position.y ?? 0) + 420
    const COL_W = target === 'image' ? 300 : 320
    const stamp = Date.now()
    const ids = shots.map((_, i) => `n_${stamp}_${target}_${i}`)
    addNodes(shots.map((s, i) => ({
      id: ids[i],
      type: target,
      position: { x: baseX + i * COL_W, y: baseY + (target === 'video' ? 40 : 0) },
      data: {
        ...DEFAULT_NODE_DATA,
        title: `镜 ${s.shotNumber}`,
        prompt: s.finalPrompt ?? '',
        modelKey,
        ...(target === 'video'
          ? { durationSec: Math.min(Math.max(Math.round(s.durationSec ?? 5), 5), 15) }
          : {}),
      },
    })) as Node<CanvasNodeData>[])
    addEdges(ids.map((nid, i) => ({ id: `e_${stamp}_s_${i}`, source: id, target: nid, animated: true }) as Edge))

    setBatch({ done: 0, total: ids.length, running: true, error: null })
    for (let i = 0; i < ids.length; i++) {
      const s = shots[i]
      try {
        const runId = await gen.submitNode({
          prompt: s.finalPrompt ?? '',
          referenceImages: shotReferenceKeys(s, assets),
          outputType: target,
          modelKey,
          aspectRatio: DEFAULT_NODE_DATA.aspectRatio,
          ...(target === 'video'
            ? { durationSec: Math.min(Math.max(Math.round(s.durationSec ?? 5), 5), 15) }
            : {}),
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

  function openPickedShotsInDirector() {
    if (shots.length === 0) return
    // 导演台契约只吃 character/image 当卡司(canvas-connections ACCEPTS)。
    const directorCastIds = upstream
      .filter((n): n is NonNullable<typeof n> => Boolean(n) && (n!.type === 'character' || n!.type === 'image'))
      .map((n) => n.id)
    const self = getNode(id)
    const base = self?.position ?? { x: 0, y: 0 }
    const directorId = `n_${Date.now()}_director`
    addNodes({
      id: directorId,
      type: 'director',
      position: { x: base.x + 480, y: base.y },
      data: {
        ...DEFAULT_NODE_DATA,
        title: `导演台 · ${shots.length} 镜`,
        blockingBrief: buildStoryboardBlockingBrief(shots),
        openDirectorOnCreate: true,
      },
    } as Node<CanvasNodeData>)
    const edges: Edge[] = directorCastIds.map((sourceId, index) => ({
      id: `e_${Date.now()}_director_${index}`, source: sourceId, target: directorId, animated: true,
    }))
    if (edges.length > 0) addEdges(edges)
  }

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

  const meta = NODE_META.script
  const busy = phase === 'submitting' || phase === 'running'
  const hasShots = shots.length > 0

  const stepRows = [
    {
      step: 1 as const,
      label: '确认镜头',
      detail: hasShots
        ? (progress.shotsReady === shots.length ? `${shots.length}个镜头已就绪` : `${shots.length - progress.shotsReady}个镜头待核对`)
        : '待拆分镜',
    },
    {
      step: 2 as const,
      label: '准备资产',
      detail: progress.assetsTotal === 0 ? '暂无资产' : `${progress.assetsDone}/${progress.assetsTotal} 已生成`,
    },
    {
      step: 3 as const,
      label: '合成提示词',
      detail: `${progress.promptsDone}/${Math.max(shots.length, 1)} 已合成`,
    },
  ]

  return (
    <NodeShell accent={meta.accent} label="脚本生成器" hint={meta.hint} selected={selected} locked={Boolean(d.locked)} width={380}>
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
            rows={hasShots ? 3 : 7}
            className="nodrag nowheel w-full resize-y rounded-md px-2.5 py-2 text-[13px] leading-relaxed outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          />
        )}

        {error ? <div className="text-[11px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy || !script}
          className="nodrag w-full rounded-md py-1.5 font-mono text-[12px] font-semibold tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: meta.accent, color: '#241A06' }}
        >
          {phase === 'submitting' ? '提交中…' : phase === 'running' ? '拆分镜中…' : hasShots ? '↻ 重新生成' : '生成分镜'}
        </button>

        {hasShots ? (
          <>
            {/* 三步进度 — 点击直达全屏编辑器对应步骤 */}
            <div className="rounded-lg px-3 py-2.5" style={{ border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
              {stepRows.map((row) => (
                <button
                  key={row.step}
                  type="button"
                  onClick={() => setStage(row.step)}
                  className="nodrag flex w-full items-center gap-2 py-1 text-left"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
                    style={{ border: `1px solid ${CANVAS_TOKENS.hairline}`, color: CANVAS_TOKENS.text.secondary }}
                  >
                    {row.step}
                  </span>
                  <span className="text-[12px]" style={{ color: CANVAS_TOKENS.text.primary }}>{row.label}</span>
                  <span className="ml-auto text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>{row.detail}</span>
                </button>
              ))}
              <div className="pt-1 text-right text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
                {progress.completeSteps}/3 完成后可批量生视频
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStage(1)}
              className="nodrag w-full rounded-lg py-2.5 text-[13px] font-semibold"
              style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
            >
              打开脚本节点 →
            </button>

            {boundRefLabels.length > 0 ? (
              <div className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: `${meta.accent}18`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${meta.accent}33` }}>
                已绑画布参考（{boundRefLabels.length}）：{boundRefLabels.join('、')}
              </div>
            ) : null}

            {/* 批量动作 — 三步全过才解锁 */}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => handleBatch('image')}
                disabled={!progress.batchReady || batch.running}
                title={progress.batchReady ? '' : '完成三步（镜头/资产/提示词）后解锁'}
                className="nodrag flex-1 rounded-lg py-2 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}
              >
                {batch.running ? `生成中 ${batch.done}/${batch.total}` : `批量生成分镜（${shots.length}）`}
              </button>
              <button
                type="button"
                onClick={() => handleBatch('video')}
                disabled={!progress.batchReady || batch.running || !effectiveVideoModel}
                title={progress.batchReady ? '' : '完成三步（镜头/资产/提示词）后解锁'}
                className="nodrag flex-1 rounded-lg py-2 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: `${NODE_META.video.accent}22`, color: NODE_META.video.accent, border: `1px solid ${NODE_META.video.accent}66` }}
              >
                批量生视频（{shots.length}）
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>生视频模型</span>
              <select
                value={effectiveVideoModel}
                onChange={(e) => updateNodeData(id, { videoModelKey: e.target.value })}
                className="nodrag min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[11px] outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                {gen.videoModels.length === 0 ? <option value="">无可用模型 · 去 /profile 启用</option> : null}
                {gen.videoModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {batch.error ? <div className="text-[11px]" style={{ color: '#FF8A8A' }}>{batch.error}</div> : null}
            <button
              type="button"
              onClick={openPickedShotsInDirector}
              disabled={batch.running}
              className="nodrag w-full rounded-lg py-1.5 text-[12px] disabled:opacity-40"
              style={{ background: `${NODE_META.director.accent}22`, color: NODE_META.director.accent, border: `1px solid ${NODE_META.director.accent}66` }}
            >
              打开 3D 导演台排戏（{shots.length} 镜）
            </button>
          </>
        ) : null}
      </div>

      {stage !== null ? (
        <ScriptGeneratorStage
          shots={shots}
          assets={assets}
          globalStyle={globalStyle}
          progress={progress}
          gen={gen}
          imageModelKey={effectiveImageModel}
          initialStep={stage}
          synthesizing={synthesizing}
          synthError={synthError}
          onClose={() => setStage(null)}
          onEditShot={editShot}
          onDeleteShot={deleteShot}
          onMoveShot={moveShot}
          onAddShot={addShot}
          onSetGlobalStyle={setGlobalStyle}
          onEditAsset={editAsset}
          onAddAsset={addAsset}
          onDeleteAsset={deleteAsset}
          onSynthesizeAll={handleSynthesizeAll}
        />
      ) : null}
    </NodeShell>
  )
}

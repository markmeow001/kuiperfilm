'use client'

/**
 * Image / video generative node. One component, two registrations (nodeTypes
 * 'image' & 'video') parametrized by outputType. Wraps the Playground run
 * spine via useCanvasGeneration: pick model → prompt → 生成 → poll → media lands
 * in the node body. Billing/worker/polling are all inherited (no new task type).
 *
 * M1 scope = text→image / text→video. Frame-chaining (upstream image node's
 * result as the video first-frame) needs a reference-from-result backend path
 * and is the tracked next step — the edge is drawn but the frame isn't passed.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { useCanvasGeneration } from '../lib/canvas-generation'
import { pickUpstreamReferenceUrls } from '../lib/canvas-refs'
import { CAMERA_MOVES, cameraMovePhrase } from '../lib/camera-moves'
import { NodeShell } from './node-shell'

const ASPECT_OPTIONS = ['9:16', '16:9', '1:1', '4:3', '3:4', '4:5']
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p']
// video generation modes (how upstream refs are used)
const GEN_MODES: { key: 'text' | 'image' | 'omni'; label: string }[] = [
  { key: 'text', label: '文生视频' },
  { key: 'image', label: '图生视频' },
  { key: 'omni', label: '全能参考' },
]

type StatusLabel = '闲置' | '提交中' | '排队中' | '生成中' | '已完成' | '失败'

export function makeMediaNode(outputType: 'image' | 'video') {
  function MediaNode({ id, data, selected }: NodeProps) {
    const d = data as CanvasNodeData
    const { updateNodeData } = useReactFlow()
    const gen = useCanvasGeneration()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const meta = NODE_META[outputType]
    const models = outputType === 'image' ? gen.imageModels : gen.videoModels

    // Upstream image/character nodes → reference URLs. For a video node the
    // first one becomes the i2v first frame; for an image node they're
    // edit/consistency references. Reactive via React Flow's connection hooks.
    // Under ConnectionMode.Loose a connection can land on any handle, so we
    // can't filter by handleType='target' — take every edge where THIS node is
    // the target (this node receives) regardless of which handle was used.
    const connections = useNodeConnections()
    const incomingSourceIds = useMemo(
      () => connections.filter((c) => c.target === id).map((c) => c.source),
      [connections, id],
    )
    const upstream = useNodesData(incomingSourceIds)
    const upstreamRefs = useMemo(() => pickUpstreamReferenceUrls(upstream, id), [upstream, id])
    // Own input anchor (e.g. a 导演台 blocking screenshot) leads the reference
    // list — for video it's the i2v first frame; combined with upstream cast
    // refs (appearance), both blocking AND identity carry into this frame.
    const allRefs = useMemo(
      () => (d.anchorKey ? [d.anchorKey, ...upstreamRefs] : upstreamRefs),
      [d.anchorKey, upstreamRefs],
    )

    // Default the model to the first enabled one once catalogs load.
    useEffect(() => {
      if (!d.modelKey && models.length > 0) {
        updateNodeData(id, { modelKey: models[0].value })
      }
    }, [d.modelKey, models, id, updateNodeData])

    const run = gen.runById(d.runId)
    const status: StatusLabel = submitting
      ? '提交中'
      : run?.status === 'pending'
        ? '排队中'
        : run?.status === 'running'
          ? '生成中'
          : run?.status === 'succeeded'
            ? '已完成'
            : run?.status === 'failed'
              ? '失败'
              : '闲置'
    const busy = submitting || run?.status === 'pending' || run?.status === 'running'

    // Cache the result URL into node data so a reload shows it before polling.
    const resultUrl = run?.resultUrls?.[0] ?? d.resultUrl ?? null
    useEffect(() => {
      if (run?.status === 'succeeded' && run.resultUrls?.[0] && run.resultUrls[0] !== d.resultUrl) {
        updateNodeData(id, { resultUrl: run.resultUrls[0] })
      }
    }, [run, d.resultUrl, id, updateNodeData])

    const canGenerate = Boolean(d.prompt.trim()) && Boolean(d.modelKey) && !busy

    // Video generation mode gates ref usage: 文生=ignore upstream refs, 图生/全能参考=use them.
    // The director blocking anchor (d.anchorKey) is a hard blocking constraint, NOT an
    // optional ref — it's always sent (and always shown), so display matches submission.
    const genMode = outputType === 'video' ? d.genMode ?? (allRefs.length > 0 ? 'image' : 'text') : 'image'
    const refsForSubmit = outputType === 'video' && genMode === 'text'
      ? (d.anchorKey ? [d.anchorKey] : [])
      : allRefs

    async function handleGenerate() {
      if (!canGenerate) return
      setError(null)
      setSubmitting(true)
      try {
        const movePhrase = outputType === 'video' ? cameraMovePhrase(d.cameraMove) : ''
        const finalPrompt = movePhrase ? `${d.prompt.trim()}，${movePhrase}` : d.prompt.trim()
        const runId = await gen.submitNode({
          prompt: finalPrompt,
          outputType,
          modelKey: d.modelKey,
          aspectRatio: d.aspectRatio,
          // anchor (own blocking screenshot) + upstream refs (cast appearance).
          // For video, refsForSubmit[0] is the i2v first frame (gated by mode).
          ...(refsForSubmit.length > 0 ? { referenceImages: refsForSubmit } : {}),
          ...(outputType === 'video' ? { durationSec: d.durationSec ?? 5, resolution: d.resolution ?? '720p' } : {}),
        })
        updateNodeData(id, { runId, resultUrl: null })
      } catch (err) {
        setError((err as Error)?.message ?? '生成失败')
      } finally {
        setSubmitting(false)
      }
    }

    const [aw, ah] = useMemo(() => d.aspectRatio.split(':').map(Number), [d.aspectRatio])

    return (
      <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={280}>
        {/* Preview body */}
        <div className="px-3 pt-3">
          <div
            className="relative w-full overflow-hidden rounded-md"
            style={{
              aspectRatio: `${aw} / ${ah}`,
              maxHeight: 200,
              background: CANVAS_TOKENS.bg.app,
              border: `1px solid ${CANVAS_TOKENS.hairline}`,
            }}
          >
            {busy ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <div
                  className="h-7 w-7 animate-spin rounded-full border-2"
                  style={{ borderColor: `${CANVAS_TOKENS.accent}40`, borderTopColor: CANVAS_TOKENS.accent }}
                />
                <span className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
                  {status}
                </span>
              </div>
            ) : resultUrl ? (
              outputType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resultUrl} alt="result" className="h-full w-full object-contain" />
              ) : (
                <video src={resultUrl} controls playsInline className="h-full w-full object-contain" />
              )
            ) : d.anchorUrl ? (
              // blocking anchor (e.g. 导演台 站位 screenshot) shown dimmed until generated
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.anchorUrl} alt="站位锚" className="h-full w-full object-contain opacity-55" />
                <div className="absolute inset-x-0 bottom-1 text-center text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>站位锚 · 待生成</div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-center text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
                {outputType === 'image' ? '输入提示词生成图片' : '输入提示词生成视频'}
              </div>
            )}
            {allRefs.length > 0 ? (
              <div
                className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[9px]"
                style={{ background: `${CANVAS_TOKENS.bg.canvas}cc`, color: CANVAS_TOKENS.accent, border: `1px solid ${CANVAS_TOKENS.accent}55` }}
              >
                {d.anchorKey ? '站位' : outputType === 'video' ? '首帧' : '参考'}
                {upstreamRefs.length > 0 ? `+卡司(${upstreamRefs.length})` : ` ←上游(${allRefs.length})`}
              </div>
            ) : null}
          </div>
        </div>

        {/* Config */}
        <div className="space-y-2 p-3">
          {/* video: generation-mode tabs */}
          {outputType === 'video' ? (
            <div className="flex gap-1">
              {GEN_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => updateNodeData(id, { genMode: m.key })}
                  className="nodrag flex-1 rounded-md py-1 text-[11px]"
                  style={{ background: genMode === m.key ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover, color: genMode === m.key ? '#06222A' : CANVAS_TOKENS.text.secondary }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}

          <textarea
            value={d.prompt}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            placeholder={outputType === 'image' ? '描述画面…' : '描述运动 / 镜头…'}
            rows={2}
            className="nodrag w-full resize-none rounded-md px-2 py-1.5 text-[12px] outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          />

          <div className="flex items-center gap-1.5">
            <select
              value={d.modelKey}
              onChange={(e) => updateNodeData(id, { modelKey: e.target.value })}
              className="nodrag min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[11px] outline-none"
              style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
            >
              {models.length === 0 ? <option value="">无可用模型 · 去 /profile 启用</option> : null}
              {models.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select
              value={d.aspectRatio}
              onChange={(e) => updateNodeData(id, { aspectRatio: e.target.value })}
              className="nodrag rounded-md px-1.5 py-1 font-mono text-[11px] outline-none"
              style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
            >
              {ASPECT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {outputType === 'video' ? (
            <>
              <div className="flex items-center gap-1.5">
                <select
                  value={d.durationSec ?? 5}
                  onChange={(e) => updateNodeData(id, { durationSec: Number.parseInt(e.target.value, 10) || 5 })}
                  className="nodrag flex-1 rounded-md px-2 py-1 font-mono text-[11px] outline-none"
                  style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                >
                  {Array.from({ length: 11 }, (_, i) => 5 + i).map((s) => <option key={s} value={s}>{s}s</option>)}
                </select>
                <select
                  value={d.resolution ?? '720p'}
                  onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
                  className="nodrag flex-1 rounded-md px-2 py-1 font-mono text-[11px] outline-none"
                  style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                >
                  {RESOLUTION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {/* 运镜 camera-movement preset (appended to prompt) */}
              <select
                value={d.cameraMove ?? 'none'}
                onChange={(e) => updateNodeData(id, { cameraMove: e.target.value })}
                className="nodrag w-full rounded-md px-2 py-1 font-mono text-[11px] outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                {CAMERA_MOVES.map((m) => <option key={m.key} value={m.key}>运镜：{m.label}</option>)}
              </select>
            </>
          ) : null}

          {error ? (
            <div className="text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div>
          ) : null}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="nodrag w-full rounded-md py-1.5 font-mono text-[12px] font-semibold tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}
          >
            {busy ? status : '生成'}
          </button>
        </div>
      </NodeShell>
    )
  }
  MediaNode.displayName = `MediaNode(${outputType})`
  return MediaNode
}

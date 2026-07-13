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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import { type CanvasNodeData, DEFAULT_NODE_DATA } from '../lib/canvas-types'
import { useCanvasGeneration } from '../lib/canvas-generation'
import { pickUpstreamFrameUrls, pickUpstreamReferenceUrls, pickUpstreamText, resolveFirstLastFrames } from '../lib/canvas-refs'
import { CAMERA_MOVES, cameraMovePhrase } from '../lib/camera-moves'
import { IMAGE_RECIPES } from '../lib/canvas-recipes'
import { visualStyles } from '@/lib/style-library'
import { VIDEO_PROMPT_SOFT_LIMIT, compressVideoPrompt } from '@/lib/playground/video-prompt-compress'
import { variantKeyForMode, variantModeMismatch } from '@/lib/video-models/variant-for-mode'
import { NodeShell } from './node-shell'

const ASPECT_OPTIONS = ['9:16', '16:9', '2:1', '21:9', '1:1', '4:3', '3:4', '4:5']
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p']
const BATCH_OPTIONS = [1, 2, 4]
// Styles sorted for the picker (active only, by display order).
const STYLE_OPTIONS = visualStyles
  .filter((s) => s.isActive)
  .sort((a, b) => a.displayOrder - b.displayOrder)
// video generation modes (how upstream refs are used)
const GEN_MODES: { key: 'text' | 'image' | 'omni' | 'firstlast'; label: string }[] = [
  { key: 'text', label: '文生视频' },
  { key: 'image', label: '图生视频' },
  { key: 'omni', label: '全能参考' },
  { key: 'firstlast', label: '首尾帧' },
]

type StatusLabel = '闲置' | '提交中' | '排队中' | '生成中' | '已完成' | '失败'

export function makeMediaNode(outputType: 'image' | 'video') {
  function MediaNode({ id, data, selected }: NodeProps) {
    const d = data as CanvasNodeData
    const { updateNodeData, addNodes, getNode } = useReactFlow()
    const gen = useCanvasGeneration()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [recipeMenu, setRecipeMenu] = useState(false)
    const [styleMenu, setStyleMenu] = useState(false)
    const selectedStyle = useMemo(
      () => (d.styleId ? STYLE_OPTIONS.find((s) => s.id === d.styleId) ?? null : null),
      [d.styleId],
    )
    const upload = useUploadPlaygroundReference()
    const refInputRef = useRef<HTMLInputElement | null>(null)
    const lastFrameInputRef = useRef<HTMLInputElement | null>(null)
    async function handleRefUpload(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('请上传 jpg/png/webp'); return }
      try {
        const res = await upload.mutateAsync({ file, type: 'image' })
        // anchorKey = the node's own input reference (fed to generation, e.g. 720全景)
        updateNodeData(id, { anchorKey: res.key, anchorUrl: res.signedUrl })
      } catch (err) {
        setError((err as Error)?.message ?? '参考图上传失败')
      }
    }
    async function handleLastFrameUpload(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('请上传 jpg/png/webp'); return }
      try {
        const res = await upload.mutateAsync({ file, type: 'image' })
        updateNodeData(id, { lastFrameKey: res.key, lastFramePreview: res.signedUrl })
      } catch (err) {
        setError((err as Error)?.message ?? '尾帧上传失败')
      }
    }

    const meta = NODE_META[outputType]
    const models = outputType === 'image' ? gen.imageModels : gen.videoModels

    // Per-model spec from the capability catalog (CLAUDE.md: no hardcoded
    // model capabilities) — aspect ratios and, for image models that declare
    // them (Grok 1k/2k, Nano Pro 1k/2k/4k), a resolution picker. Falls back
    // to the global lists when the model declares nothing.
    const selectedModel = useMemo(() => models.find((m) => m.value === d.modelKey) ?? null, [models, d.modelKey])
    const modelAspects = outputType === 'image' ? selectedModel?.capabilities?.image?.aspectRatioOptions : undefined
    const aspectOptions = useMemo(() => {
      const base = modelAspects && modelAspects.length > 0 ? modelAspects : ASPECT_OPTIONS
      // Keep the current value selectable even when the model doesn't declare
      // it (e.g. 720全景's 2:1 on GPT — the generator maps it to the closest).
      return base.includes(d.aspectRatio) ? base : [d.aspectRatio, ...base]
    }, [modelAspects, d.aspectRatio])
    const imageResolutions = outputType === 'image'
      ? selectedModel?.capabilities?.image?.resolutionOptions ?? null
      : null
    // Single effective value used by BOTH the select and the submission, so
    // what the user sees is exactly what gets sent (d.resolution defaults to
    // the video '720p', which image models don't understand).
    const effectiveImageResolution = imageResolutions && imageResolutions.length > 0
      ? (d.resolution && imageResolutions.includes(d.resolution) ? d.resolution : imageResolutions[0])
      : null

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
    const upstreamFrames = useMemo(() => pickUpstreamFrameUrls(upstream), [upstream])
    // Upstream 文本/脚本 nodes drive this shot's prompt (script → 分镜 chain).
    const upstreamText = useMemo(() => pickUpstreamText(upstream), [upstream])
    // Own input anchor (e.g. a 导演台 blocking screenshot) leads the reference
    // list — for video it's the i2v first frame; combined with upstream cast
    // refs (appearance), both blocking AND identity carry into this frame.
    const allRefs = useMemo(
      () => (d.anchorKey ? [d.anchorKey, ...upstreamRefs] : upstreamRefs),
      [d.anchorKey, upstreamRefs],
    )
    // Live input signature vs the one captured at last generate → 「输入已更新」
    // badge (LibTV) when upstream output/text drifted after this node produced.
    // Query strings are stripped: under COS storage the refs are signed URLs
    // whose signature rotates on every fetch — hashing the raw URL would keep
    // the badge lit forever. JSON.stringify avoids delimiter collisions.
    const inputsSig = useMemo(
      () => JSON.stringify([upstreamText, ...allRefs.map((r) => r.split('?')[0])]),
      [upstreamText, allRefs],
    )
    const inputsChanged = Boolean(d.resultUrl) && d.inputsSig != null && d.inputsSig !== inputsSig

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
        updateNodeData(id, {
          resultUrl: run.resultUrls[0],
          // 视频结果带回尾帧 URL,供下游连线做首尾帧续镜(canvas-refs 采集)。
          ...(run.tailFrameUrl ? { tailFrameUrl: run.tailFrameUrl } : {}),
        })
      }
    }, [run, d.resultUrl, id, updateNodeData])

    // Effective prompt = upstream script text + this node's own prompt.
    const basePrompt = [upstreamText, d.prompt.trim()].filter(Boolean).join('\n')
    const canGenerate = Boolean(basePrompt) && Boolean(d.modelKey) && !busy

    // Video generation mode gates ref usage: 文生=ignore upstream refs, 图生/全能参考=use them.
    // The director blocking anchor (d.anchorKey) is a hard blocking constraint, NOT an
    // optional ref — it's always sent (and always shown), so display matches submission.
    // 预演参考视频（导演台导出）→ 默认 omni（R2V）端点。
    const genMode = outputType === 'video' ? d.genMode ?? (d.referenceVideoKey ? 'omni' : allRefs.length > 0 ? 'image' : 'text') : 'image'
    const { firstFrame: connectedFirstFrame, lastFrame: connectedLastFrame } = resolveFirstLastFrames({
      anchorKey: d.anchorKey,
      lastFrameKey: d.lastFrameKey,
      upstreamFrames,
    })
    const refsForSubmit = outputType === 'video' && genMode === 'text'
      ? (d.anchorKey ? [d.anchorKey] : [])
      : outputType === 'video' && genMode === 'firstlast'
        ? (connectedFirstFrame ? [connectedFirstFrame] : [])
        : allRefs

    async function handleGenerate() {
      if (!canGenerate) return
      // Pre-submit gate: a model with no img2img variant (z-image) hard-fails
      // on refs worker-side — catch it here and skip the freeze/rollback trip.
      if (
        outputType === 'image' &&
        refsForSubmit.length > 0 &&
        selectedModel?.capabilities?.image?.supportReferenceImage === false
      ) {
        setError('该模型不支持参考图/图生图：请断开上游图片、移除参考图，或换用 Grok Imagine 等支持编辑的模型')
        return
      }
      if (outputType === 'video' && genMode === 'firstlast') {
        if (refsForSubmit.length === 0) { setError('首尾帧：请先连入或设定首帧图'); return }
        if (!connectedLastFrame) { setError('首尾帧：请连接第二张图片或上传尾帧图'); return }
      }
      setError(null)
      setSubmitting(true)
      try {
        // Style injection: the playground spine has no style field, so we fold
        // the selected style's anchor (prefix) + modifiers (suffix) into the
        // prompt text — same shape injectStyleProfile() uses server-side.
        const styled = selectedStyle
          ? [selectedStyle.styleAnchor, basePrompt, selectedStyle.visualModifiers].filter(Boolean).join('\n')
          : basePrompt
        const movePhrase = outputType === 'video' ? cameraMovePhrase(d.cameraMove) : ''
        let finalPrompt = movePhrase ? `${styled}，${movePhrase}` : styled
        // Video: over-long prompts get diluted by Seedance-class models —
        // auto-compress via the CANVAS_TEXT task (billed as a text task).
        // Image: hard guard mirroring the server cap.
        if (outputType === 'video' && finalPrompt.length > VIDEO_PROMPT_SOFT_LIMIT) {
          finalPrompt = await compressVideoPrompt(finalPrompt)
        } else if (finalPrompt.length > 4000) {
          setError(`提示词过长（${finalPrompt.length}/4000），请精简上游脚本或本节点描述`)
          setSubmitting(false)
          return
        }
        // Video mode tabs must reach the matching ENDPOINT variant — a t2v/
        // i2v/r2v-suffixed key is swapped to the sibling implementing the
        // selected mode (图生视频 = first frame needs the i2v endpoint; on an
        // r2v key the image would only be a style/identity reference).
        const effectiveModelKey = outputType === 'video'
          ? variantKeyForMode(d.modelKey, genMode, models.map((m) => m.value))
          : d.modelKey
        const submission = {
          prompt: finalPrompt,
          outputType,
          modelKey: effectiveModelKey,
          aspectRatio: d.aspectRatio,
          // anchor (own blocking screenshot) + upstream refs (cast appearance).
          // For video, refsForSubmit[0] is the i2v first frame (gated by mode).
          ...(refsForSubmit.length > 0 ? { referenceImages: refsForSubmit } : {}),
          // 首尾帧: send the tail frame; first frame = referenceImages[0].
          ...(outputType === 'video' && genMode === 'firstlast' && connectedLastFrame
            ? { lastFrameUrl: connectedLastFrame }
            : {}),
          // 导演台预演参考视频（R2V 机位运动+人物调度锚）。
          ...(outputType === 'video' && d.referenceVideoKey
            ? { referenceVideos: [d.referenceVideoKey] }
            : {}),
          ...(outputType === 'video' ? { durationSec: d.durationSec ?? 5, resolution: d.resolution ?? '720p' } : {}),
          ...(outputType === 'image' && effectiveImageResolution
            ? { resolution: effectiveImageResolution }
            : {}),
        }
        // Batch (image only): fan out N playground runs — the spine hardcodes
        // generationCount=1, so N runs = N variants. Run #1 stays on this node;
        // extras spawn sibling frame nodes to the right so the user sees a row.
        const batch = outputType === 'image' ? Math.min(Math.max(d.batchCount ?? 1, 1), 4) : 1
        const runIds = await Promise.all(Array.from({ length: batch }, () => gen.submitNode(submission)))
        updateNodeData(id, { runId: runIds[0], resultUrl: null, inputsSig })
        if (runIds.length > 1) {
          const self = getNode(id)
          const baseX = self?.position.x ?? 0
          const baseY = self?.position.y ?? 0
          addNodes(
            runIds.slice(1).map((rid, i) => ({
              id: `n_${Date.now()}_${i}_${Math.round(baseX)}`,
              type: 'image' as const,
              position: { x: baseX + (i + 1) * (nodeWidth + 32), y: baseY },
              data: {
                ...DEFAULT_NODE_DATA,
                title: `${meta.label} · 变体 ${i + 2}`,
                // finalPrompt already has the style folded in — leave styleId
                // null on the sibling so a re-generate won't double-inject it.
                prompt: finalPrompt,
                modelKey: d.modelKey,
                aspectRatio: d.aspectRatio,
                styleId: null,
                runId: rid,
              },
            })),
          )
        }
      } catch (err) {
        setError((err as Error)?.message ?? '生成失败')
      } finally {
        setSubmitting(false)
      }
    }

    const [aw, ah] = useMemo(() => d.aspectRatio.split(':').map(Number), [d.aspectRatio])
    // Node width adapts to the aspect ratio — wide for 2:1/16:9, narrow+tall for
    // 9:16 — so the preview reflects the real output shape (not a fixed box).
    const nodeWidth = useMemo(() => {
      const ratio = aw && ah ? aw / ah : 1
      const previewH = 190
      const previewW = Math.min(Math.max(previewH * ratio, 150), 460)
      return Math.round(Math.min(Math.max(previewW + 24, 250), 484))
    }, [aw, ah])

    return (
      <div className="relative">
      <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={nodeWidth}>
        {/* Preview body — the card itself is preview-only (LibTV) */}
        <div className="p-3">
          <div
            className="relative w-full overflow-hidden rounded-md"
            style={{
              aspectRatio: `${aw} / ${ah}`,
              maxHeight: 300,
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
                <div className="absolute inset-x-0 bottom-1 text-center text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>参考图 · 待生成</div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-center text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
                {outputType === 'image' ? '输入提示词生成图片' : '输入提示词生成视频'}
              </div>
            )}
            {inputsChanged && !busy ? (
              <div
                className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px]"
                style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}
              >
                输入已更新
              </div>
            ) : null}
            {run?.status === 'failed' ? (
              <div className="absolute inset-x-0 bottom-1 text-center text-[10px]" style={{ color: '#FF8A8A' }}>
                生成失败 · 点选节点查看
              </div>
            ) : null}
            {allRefs.length > 0 ? (
              <div
                className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[9px]"
                style={{ background: `${CANVAS_TOKENS.bg.canvas}cc`, color: CANVAS_TOKENS.accent, border: `1px solid ${CANVAS_TOKENS.accent}55` }}
              >
                {d.anchorKey ? '参考' : outputType === 'video' ? '首帧' : '参考'}
                {upstreamRefs.length > 0 ? `+卡司(${upstreamRefs.length})` : ` ←上游(${allRefs.length})`}
              </div>
            ) : null}
          </div>
        </div>

      </NodeShell>

      {/* Floating config panel — LibTV node-floating-ui: appears below the
          card while the node is selected. Part of the node's DOM, so clicking
          inside keeps the selection (and RF elevates selected nodes above
          neighbors). */}
      {selected ? (
        <div
          className="nodrag absolute left-0 top-full z-20 mt-2 space-y-2 rounded-xl p-3"
          style={{
            // 面板最窄 420:340 时中文描述词一行只有十几个字,阅读体验差
            //(2026-07-08 用户反馈)。
            width: Math.max(nodeWidth, 420),
            background: CANVAS_TOKENS.bg.panel,
            border: `1px solid ${CANVAS_TOKENS.hairline}`,
            boxShadow: CANVAS_TOKENS.shadowPopover,
          }}
        >
          {/* image: 预设配方 menu (LibTV-style recipes, incl. 720全景) */}
          {outputType === 'image' ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setRecipeMenu((v) => !v)}
                className="nodrag flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px]"
                style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                <span>✨ 预设配方</span>
                <span style={{ color: CANVAS_TOKENS.text.muted }}>{recipeMenu ? '▾' : '▸'}</span>
              </button>
              {recipeMenu ? (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setRecipeMenu(false)} />
                  {/* Wide 2-column layout (LibTV-style) — everything visible, no scroll */}
                  <div className="nowheel nodrag absolute left-0 top-full z-50 mt-1 grid w-[440px] grid-cols-2 gap-x-4 gap-y-1 rounded-xl p-3" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}>
                    {([['分镜叙事', '质感调节'], ['空间与机位', '设定图']] as const).map((colGroups, ci) => (
                      <div key={ci} className="space-y-2">
                        {colGroups.map((g) => (
                          <div key={g}>
                            <div className="mb-0.5 px-1 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>{g}</div>
                            {IMAGE_RECIPES.filter((r) => r.group === g).map((r) => (
                              <button
                                key={r.key}
                                type="button"
                                onClick={() => {
                                  updateNodeData(id, { prompt: r.prompt, ...(r.aspectRatio ? { aspectRatio: r.aspectRatio } : {}) })
                                  setRecipeMenu(false)
                                }}
                                className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-white/8"
                                style={{ color: r.key === 'pano720' ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.primary, background: r.key === 'pano720' ? `${CANVAS_TOKENS.accent}14` : 'transparent' }}
                              >
                                {r.label}
                                {r.key === 'pano720' ? <span className="ml-1 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>生成全景场景图</span> : null}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {/* video: generation-mode tabs */}
          {outputType === 'video' ? (
            <div className="flex gap-1">
              {GEN_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => updateNodeData(id, { genMode: m.key })}
                  className="nodrag flex-1 rounded-md py-1 text-[11px]"
                  style={{ background: genMode === m.key ? CANVAS_TOKENS.bg.active : 'transparent', color: genMode === m.key ? CANVAS_TOKENS.text.primary : CANVAS_TOKENS.text.secondary, border: `1px solid ${genMode === m.key ? CANVAS_TOKENS.hairline : 'transparent'}` }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Mode ↔ endpoint feedback: variant-suffixed models (Seedance t2v/
              i2v/r2v) swap endpoints per mode — say so, or warn when the
              needed sibling isn't enabled. */}
          {outputType === 'video' ? (() => {
            const keys = models.map((m) => m.value)
            const eff = variantKeyForMode(d.modelKey, genMode, keys)
            if (eff !== d.modelKey) {
              const label = models.find((m) => m.value === eff)?.label ?? eff
              return <div className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>模式已匹配端点：{label}</div>
            }
            if (variantModeMismatch(d.modelKey, genMode)) {
              const want = genMode === 'text' ? 'T2V' : genMode === 'omni' ? 'R2V' : 'I2V'
              return <div className="text-[10px]" style={{ color: '#F4C44E' }}>该模式需要 {want} 端点变体，请在 /profile 启用后生效（当前将按所选模型语义执行）</div>
            }
            return null
          })() : null}

          {/* 预演参考视频（导演台导出）badge + 移除 */}
          {outputType === 'video' && d.referenceVideoKey ? (
            <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[10px]" style={{ background: `${CANVAS_TOKENS.accent}14`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.accent}33` }}>
              <span style={{ color: CANVAS_TOKENS.accent }}>🎬 预演参考视频已绑定（跟随机位运动+调度）</span>
              {/* genMode 一并清空：否则节点留在 omni(R2V) 却没参考视频，生成莫名失败 */}
              <button type="button" onClick={() => updateNodeData(id, { referenceVideoKey: null, referenceVideoUrl: null, genMode: undefined })} className="nodrag shrink-0" style={{ color: '#FF8A8A' }}>移除</button>
            </div>
          ) : null}

          {/* 首尾帧: last-frame upload (first frame comes from the upstream ref) */}
          {outputType === 'video' && genMode === 'firstlast' ? (
            <>
            {/* 自动配对的顺序语义必须讲明白：帧序 = 连线先后，不是画面左右
                （review 2026-07-13 MEDIUM：两张图静默对调首尾帧用户毫无感知） */}
            <div className="rounded-md px-2 py-1 text-[10px]" style={{ background: `${CANVAS_TOKENS.accent}10`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.accent}30` }}>
              首帧：{d.anchorKey ? '本节点参考图' : connectedFirstFrame ? '第 1 条连线的图' : '未设定'} ·
              尾帧：{d.lastFrameKey ? '已上传的尾帧图' : connectedLastFrame ? (d.anchorKey ? '第 1 条连线的图' : '第 2 条连线的图') : '未设定'}
              <span style={{ color: CANVAS_TOKENS.text.muted }}>（按连线先后顺序，非画面位置；顺序不对就断线重连）</span>
            </div>
            <div className="flex items-center gap-1.5">
              {d.lastFramePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.lastFramePreview} alt="尾帧" className="h-8 w-8 rounded object-cover" style={{ border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
              ) : null}
              <button
                type="button"
                onClick={() => lastFrameInputRef.current?.click()}
                disabled={upload.isPending}
                className="nodrag flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                {upload.isPending ? '上传中…' : d.lastFrameKey ? '＋ 换尾帧' : '＋ 尾帧图'}
              </button>
              {d.lastFrameKey ? (
                <button type="button" onClick={() => updateNodeData(id, { lastFrameKey: null, lastFramePreview: null })} className="nodrag text-[11px]" style={{ color: '#FF8A8A' }}>移除</button>
              ) : null}
              <input ref={lastFrameInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleLastFrameUpload} />
              <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>仅 fal/Minimax/BobAPI 支持</span>
            </div>
            </>
          ) : null}

          {/* 风格 picker — inject a visual-style anchor into the prompt (both
              image & video). Reuses the shared 29-style library + thumbnails. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setStyleMenu((v) => !v)}
              className="nodrag flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px]"
              style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${selectedStyle ? `${CANVAS_TOKENS.accent}66` : CANVAS_TOKENS.hairline}` }}
            >
              <span className="flex items-center gap-1.5 truncate">
                {selectedStyle?.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedStyle.thumbnailUrl} alt="" className="h-4 w-4 rounded object-cover" />
                ) : null}
                <span className="truncate">{selectedStyle ? `风格：${selectedStyle.nameZh}` : '🎨 视觉风格'}</span>
              </span>
              <span className="flex items-center gap-1">
                {selectedStyle ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); updateNodeData(id, { styleId: null }) }}
                    className="text-[11px]"
                    style={{ color: '#FF8A8A' }}
                  >
                    清除
                  </span>
                ) : null}
                <span style={{ color: CANVAS_TOKENS.text.muted }}>{styleMenu ? '▾' : '▸'}</span>
              </span>
            </button>
            {styleMenu ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setStyleMenu(false)} />
                <div className="nowheel nodrag absolute left-0 top-full z-50 mt-1 max-h-[280px] w-[300px] overflow-y-auto rounded-xl p-2" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}>
                  <div className="grid grid-cols-3 gap-1.5">
                    {STYLE_OPTIONS.map((s) => {
                      const active = s.id === d.styleId
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { updateNodeData(id, { styleId: s.id }); setStyleMenu(false) }}
                          title={`${s.category} · ${s.nameZh}`}
                          className="group flex flex-col items-center gap-0.5 rounded-md p-1 transition-colors hover:bg-white/8"
                          style={{ border: `1px solid ${active ? CANVAS_TOKENS.accent : 'transparent'}` }}
                        >
                          <div className="relative aspect-square w-full overflow-hidden rounded" style={{ background: CANVAS_TOKENS.bg.app }}>
                            {s.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.thumbnailUrl} alt={s.nameZh} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center font-mono text-[13px]" style={{ color: CANVAS_TOKENS.text.muted }}>{s.category}</div>
                            )}
                          </div>
                          <span className="w-full truncate text-center text-[10px]" style={{ color: active ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.secondary }}>{s.nameZh}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* 参考图 upload — a reference image fed to this node's generation
              (e.g. upload a scene photo + 预设 720全景 → make a panorama from it) */}
          {outputType === 'image' ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => refInputRef.current?.click()}
                disabled={upload.isPending}
                className="nodrag flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                {upload.isPending ? '上传中…' : d.anchorKey ? '＋ 换参考图' : '＋ 参考图'}
              </button>
              {d.anchorKey ? (
                <button type="button" onClick={() => updateNodeData(id, { anchorKey: null, anchorUrl: null })} className="nodrag text-[11px]" style={{ color: '#FF8A8A' }}>移除</button>
              ) : null}
              <input ref={refInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleRefUpload} />
            </div>
          ) : null}

          {upstreamText ? (
            <div className="rounded-md px-2 py-1 text-[10px]" style={{ background: `${CANVAS_TOKENS.accent}14`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.accent}33` }}>
              脚本 ← 上游：{upstreamText.length > 48 ? upstreamText.slice(0, 48) + '…' : upstreamText}
            </div>
          ) : null}
          <textarea
            value={d.prompt}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            // LibTV「/」唤起: typing / in an empty prompt opens the recipe menu
            onKeyDown={(e) => {
              if (outputType === 'image' && e.key === '/' && !d.prompt && !e.nativeEvent.isComposing) {
                e.preventDefault()
                setRecipeMenu(true)
              }
            }}
            placeholder={outputType === 'image' ? (upstreamText ? '补充画面细节，输入 / 唤起预设配方' : '描述画面，输入 / 唤起预设配方…') : (upstreamText ? '补充运动 / 镜头（可留空）' : '描述运动 / 镜头…')}
            rows={5}
            // resize-y + nowheel:描述词可以上下拉高慢慢看,滚轮在框内滚文字
            // 而不是缩放画布(2026-07-08 用户反馈「方块太小很难看描述词」)。
            className="nodrag nowheel w-full resize-y rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}`, minHeight: 72, maxHeight: 360 }}
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
              {aspectOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {/* image resolution — only for models that declare options (catalog) */}
            {outputType === 'image' && imageResolutions && imageResolutions.length > 0 ? (
              <select
                value={effectiveImageResolution ?? imageResolutions[0]}
                onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
                title="解析度"
                className="nodrag rounded-md px-1.5 py-1 font-mono text-[11px] outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                {imageResolutions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : null}
            {/* batch count (image only): N variants per 生成 → N sibling nodes */}
            {outputType === 'image' ? (
              <select
                value={d.batchCount ?? 1}
                onChange={(e) => updateNodeData(id, { batchCount: Number.parseInt(e.target.value, 10) || 1 })}
                title="一次生成的变体数量"
                className="nodrag rounded-md px-1.5 py-1 font-mono text-[11px] outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                {BATCH_OPTIONS.map((n) => <option key={n} value={n}>×{n}</option>)}
              </select>
            ) : null}
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
          {/* Worker-side failure — the card badge says 点选节点查看, this is the
              "查看": surface the run's error message in the panel. */}
          {!error && run?.status === 'failed' ? (
            <div className="text-[10px]" style={{ color: '#FF8A8A' }}>
              生成失败：{run.errorMessage ?? '未知错误，请重试'}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="nodrag w-full rounded-lg py-1.5 text-[12px] font-semibold tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}
          >
            {busy ? status : '↑ 生成'}
          </button>
        </div>
      ) : null}
      </div>
    )
  }
  MediaNode.displayName = `MediaNode(${outputType})`
  return MediaNode
}

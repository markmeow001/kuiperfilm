'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import { isMaskStale, maskSourceSig } from '../lib/canvas-mask'
import type { CanvasMaskPath, CanvasMaskPoint, CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'

const VIEWBOX = 1000

function toSvgPath(points: CanvasMaskPoint[]): string {
  if (points.length === 0) return ''
  const coords = points.map((point) => `${point.x * VIEWBOX} ${point.y * VIEWBOX}`)
  if (coords.length === 1) coords.push(coords[0])
  return `M ${coords.join(' L ')}`
}

export function MaskNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const upload = useUploadPlaygroundReference()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const draftRef = useRef<CanvasMaskPoint[]>([])
  const [draft, setDraft] = useState<CanvasMaskPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const incoming = useNodeConnections({ handleType: 'target' })
  const upstreamIds = useMemo(() => incoming.map((connection) => connection.source), [incoming])
  const upstreamNodes = useNodesData(upstreamIds)
  const upstreamPlate = useMemo(() => {
    // Multiple image upstreams are ambiguous — the FIRST connected wins (the
    // connection hint tells users one plate per mask).
    const source = upstreamNodes.find((node) => node?.type === 'image')
    if (!source) return null
    const sourceData = source.data as CanvasNodeData
    // Pair url+key exactly: a generated result exposes only its signed URL
    // (no client-side key); an anchor-only node exposes both. Mixing the
    // result URL with the anchor's key would rewrite a DIFFERENT picture.
    if (sourceData.resultUrl) return { url: sourceData.resultUrl, key: null }
    if (sourceData.anchorUrl) return { url: sourceData.anchorUrl, key: sourceData.anchorKey ?? null }
    return null
  }, [upstreamNodes])
  const sourceUrl = upstreamPlate?.url ?? d.maskSourceUrl ?? null

  // Sync the effective plate into node data so downstream 局部重绘 consumers
  // read it directly instead of re-walking the graph (guarded: no-op renders).
  useEffect(() => {
    const plateUrl = upstreamPlate ? upstreamPlate.url : d.maskSourceUrl ?? null
    const plateKey = upstreamPlate ? upstreamPlate.key : d.maskSourceKey ?? null
    if (plateUrl !== (d.maskPlateUrl ?? null) || plateKey !== (d.maskPlateKey ?? null)) {
      updateNodeData(id, { maskPlateUrl: plateUrl, maskPlateKey: plateKey })
    }
  }, [upstreamPlate, d.maskSourceUrl, d.maskSourceKey, d.maskPlateUrl, d.maskPlateKey, id, updateNodeData])
  const sourceSig = maskSourceSig(sourceUrl)
  const paths = d.maskPaths ?? []
  const mode = d.maskMode ?? 'add'
  const brushSize = d.maskBrushSize ?? 18
  const locked = Boolean(d.locked)
  const stale = isMaskStale(paths, d.maskDrawnOnSig, sourceSig)
  const plateW = d.maskSourceWidth ?? null
  const plateH = d.maskSourceHeight ?? null
  // Drawing needs the plate's real geometry: the surface takes the plate's
  // aspect ratio so normalized strokes map onto the FULL image (a fixed 16:9
  // box would crop/distort any other ratio — the rasterizer would then paint
  // the mask on the wrong region).
  const canDraw = Boolean(sourceUrl) && Boolean(plateW && plateH) && !locked
  const svgMaskId = `canvas-mask-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`

  function handlePlateLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget
    if (!img.naturalWidth || !img.naturalHeight) return
    if (img.naturalWidth !== plateW || img.naturalHeight !== plateH) {
      updateNodeData(id, { maskSourceWidth: img.naturalWidth, maskSourceHeight: img.naturalHeight })
    }
  }

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): CanvasMaskPoint {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  function startPath(event: ReactPointerEvent<SVGSVGElement>) {
    if (!canDraw || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    draftRef.current = [point]
    setDraft([point])
  }

  function extendPath(event: ReactPointerEvent<SVGSVGElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = pointFromEvent(event)
    const next = [...draftRef.current, point]
    draftRef.current = next
    setDraft(next)
  }

  function finishPath(event: ReactPointerEvent<SVGSVGElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const points = draftRef.current
    if (points.length > 0) {
      const path: CanvasMaskPath = { mode, brushSize, points }
      updateNodeData(id, {
        maskPaths: [...paths, path],
        // Record which plate the strokes belong to at first ink.
        ...(paths.length === 0 ? { maskDrawnOnSig: sourceSig } : {}),
      })
    }
    draftRef.current = []
    setDraft([])
  }

  function cancelPath(event: ReactPointerEvent<SVGSVGElement>) {
    // Implicit capture release precedes pointercancel (palm rejection, scroll
    // takeover, app switch) — clear the draft unconditionally so a half-drawn
    // stroke doesn't linger uncommitted and uncleared.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    draftRef.current = []
    setDraft([])
  }

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || locked) return
    setError(null)
    try {
      const result = await upload.mutateAsync({ file, type: 'image' })
      updateNodeData(id, {
        maskSourceUrl: result.signedUrl,
        maskSourceKey: result.key,
        maskSourceWidth: null,
        maskSourceHeight: null,
        maskPaths: [],
        maskDrawnOnSig: null,
      })
    } catch (uploadError) {
      setError((uploadError as Error)?.message ?? '上传失败')
    }
  }

  function clearPaths() {
    updateNodeData(id, { maskPaths: [], maskDrawnOnSig: null })
  }

  const allPaths = draft.length > 0 ? [...paths, { mode, brushSize, points: draft }] : paths

  return (
    <NodeShell
      accent={NODE_META.mask.accent}
      label={NODE_META.mask.label}
      hint={NODE_META.mask.hint}
      selected={selected}
      locked={locked}
      width={340}
    >
      <div className="p-3">
        <div className="nodrag flex items-center gap-1.5 pb-2">
          <button
            type="button"
            disabled={locked}
            onClick={() => updateNodeData(id, { maskMode: 'add' })}
            className="rounded-md px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ background: mode === 'add' ? CANVAS_TOKENS.accentSoft : CANVAS_TOKENS.bg.input, color: mode === 'add' ? NODE_META.mask.accent : CANVAS_TOKENS.text.secondary }}
          >
            画入
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => updateNodeData(id, { maskMode: 'erase' })}
            className="rounded-md px-2 py-1 text-[11px] disabled:opacity-40"
            style={{ background: mode === 'erase' ? CANVAS_TOKENS.accentSoft : CANVAS_TOKENS.bg.input, color: mode === 'erase' ? NODE_META.mask.accent : CANVAS_TOKENS.text.secondary }}
          >
            擦除
          </button>
          <label className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
            笔刷
            <input
              type="range"
              min={6}
              max={48}
              disabled={locked}
              value={brushSize}
              onChange={(event) => updateNodeData(id, { maskBrushSize: Number(event.target.value) })}
              className="min-w-0 flex-1 accent-fuchsia-500 disabled:opacity-40"
            />
          </label>
        </div>

        <div
          className="relative overflow-hidden rounded-lg"
          style={{
            background: CANVAS_TOKENS.bg.app,
            border: `1px solid ${CANVAS_TOKENS.hairline}`,
            // Surface matches the plate's real aspect so strokes map onto the
            // full picture; 16:9 is only the empty-state placeholder.
            aspectRatio: plateW && plateH ? `${plateW} / ${plateH}` : '16 / 9',
          }}
        >
          {sourceUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sourceUrl}
              alt="遮罩来源画面"
              onLoad={handlePlateLoad}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <button
              type="button"
              disabled={locked}
              onClick={() => inputRef.current?.click()}
              className="nodrag absolute inset-0 z-10 flex h-full w-full items-center justify-center text-[12px] disabled:opacity-40"
              style={{ color: CANVAS_TOKENS.text.muted }}
            >
              连接图片节点，或点击上传实拍画面
            </button>
          )}
          {/* This is an editable vector drawing surface, not an icon. */}
          {/* eslint-disable-next-line no-restricted-syntax */}
          <svg
            viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="遮罩绘制区域"
            className="nodrag nopan absolute inset-0 h-full w-full touch-none"
            style={{ cursor: canDraw ? 'crosshair' : 'default' }}
            onPointerDown={startPath}
            onPointerMove={extendPath}
            onPointerUp={finishPath}
            onPointerCancel={cancelPath}
          >
            <defs>
              <mask id={svgMaskId}>
                <rect width={VIEWBOX} height={VIEWBOX} fill="black" />
                {allPaths.map((path, index) => (
                  <path
                    key={`${index}-${path.points.length}`}
                    d={toSvgPath(path.points)}
                    fill="none"
                    stroke={path.mode === 'add' ? 'white' : 'black'}
                    strokeWidth={path.brushSize * 3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </mask>
            </defs>
            <rect width={VIEWBOX} height={VIEWBOX} fill="rgba(255,46,175,0.52)" mask={`url(#${svgMaskId})`} />
          </svg>
        </div>

        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePick} />
        {stale ? (
          <div role="alert" className="nodrag mt-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[10px]" style={{ background: 'rgba(255,138,138,0.12)', color: '#FF8A8A' }}>
            <span>底图已更新，现有遮罩可能错位 — 建议清空后重新圈选</span>
            <button type="button" disabled={locked} onClick={clearPaths} className="shrink-0 rounded px-1.5 py-0.5 disabled:opacity-40" style={{ background: 'rgba(255,138,138,0.18)' }}>清空重画</button>
          </div>
        ) : null}
        <div className="nodrag mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
            {paths.length > 0 ? `${paths.length} 笔 · 自动保存` : sourceUrl && !canDraw && !locked ? '底图加载中…' : '用笔刷圈出要替换或修补的区域'}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={locked || paths.length === 0} onClick={() => updateNodeData(id, { maskPaths: paths.slice(0, -1), ...(paths.length === 1 ? { maskDrawnOnSig: null } : {}) })} className="rounded px-1.5 py-1 text-[10px] disabled:opacity-30" style={{ color: CANVAS_TOKENS.text.secondary }}>撤回一笔</button>
            <button type="button" disabled={locked || paths.length === 0} onClick={clearPaths} className="rounded px-1.5 py-1 text-[10px] disabled:opacity-30" style={{ color: '#FF8A8A' }}>清空</button>
          </div>
        </div>
        {error ? <div className="mt-1 text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
        <div className="mt-2 rounded-md px-2 py-1.5 text-[10px]" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.muted }}>
          圈选后把本节点连到图片节点，生成时即对圈选区局部重绘（GPT Image 1）。
        </div>
      </div>
    </NodeShell>
  )
}

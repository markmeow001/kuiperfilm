'use client'

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
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
  const upstreamUrl = useMemo(() => {
    const source = upstreamNodes.find((node) => node?.type === 'image')
    if (!source) return null
    const sourceData = source.data as CanvasNodeData
    return sourceData.resultUrl ?? sourceData.anchorUrl ?? null
  }, [upstreamNodes])
  const sourceUrl = upstreamUrl ?? d.maskSourceUrl ?? null
  const paths = d.maskPaths ?? []
  const mode = d.maskMode ?? 'add'
  const brushSize = d.maskBrushSize ?? 18
  const svgMaskId = `canvas-mask-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): CanvasMaskPoint {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  function startPath(event: ReactPointerEvent<SVGSVGElement>) {
    if (d.locked || event.button !== 0) return
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
      updateNodeData(id, { maskPaths: [...paths, path] })
    }
    draftRef.current = []
    setDraft([])
  }

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    try {
      const result = await upload.mutateAsync({ file, type: 'image' })
      updateNodeData(id, {
        maskSourceUrl: result.signedUrl,
        maskSourceKey: result.key,
        maskPaths: [],
      })
    } catch (uploadError) {
      setError((uploadError as Error)?.message ?? '上传失败')
    }
  }

  const allPaths = draft.length > 0 ? [...paths, { mode, brushSize, points: draft }] : paths

  return (
    <NodeShell
      accent={NODE_META.mask.accent}
      label={NODE_META.mask.label}
      hint={NODE_META.mask.hint}
      selected={selected}
      locked={Boolean(d.locked)}
      noSource
      width={340}
    >
      <div className="p-3">
        <div className="nodrag flex items-center gap-1.5 pb-2">
          <button
            type="button"
            onClick={() => updateNodeData(id, { maskMode: 'add' })}
            className="rounded-md px-2 py-1 text-[11px]"
            style={{ background: mode === 'add' ? CANVAS_TOKENS.accentSoft : CANVAS_TOKENS.bg.input, color: mode === 'add' ? NODE_META.mask.accent : CANVAS_TOKENS.text.secondary }}
          >
            画入
          </button>
          <button
            type="button"
            onClick={() => updateNodeData(id, { maskMode: 'erase' })}
            className="rounded-md px-2 py-1 text-[11px]"
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
              value={brushSize}
              onChange={(event) => updateNodeData(id, { maskBrushSize: Number(event.target.value) })}
              className="min-w-0 flex-1 accent-fuchsia-500"
            />
          </label>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-lg" style={{ background: CANVAS_TOKENS.bg.app, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
          {sourceUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sourceUrl} alt="遮罩来源画面" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="nodrag absolute inset-0 z-10 flex h-full w-full items-center justify-center text-[12px]"
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
            className="nodrag nopan absolute inset-0 h-full w-full touch-none cursor-crosshair"
            onPointerDown={startPath}
            onPointerMove={extendPath}
            onPointerUp={finishPath}
            onPointerCancel={finishPath}
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
        <div className="nodrag mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
            {paths.length > 0 ? `${paths.length} 笔 · 自动保存` : '用笔刷圈出要替换或修补的区域'}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={paths.length === 0} onClick={() => updateNodeData(id, { maskPaths: paths.slice(0, -1) })} className="rounded px-1.5 py-1 text-[10px] disabled:opacity-30" style={{ color: CANVAS_TOKENS.text.secondary }}>撤回一笔</button>
            <button type="button" disabled={paths.length === 0} onClick={() => updateNodeData(id, { maskPaths: [] })} className="rounded px-1.5 py-1 text-[10px] disabled:opacity-30" style={{ color: '#FF8A8A' }}>清空</button>
          </div>
        </div>
        {error ? <div className="mt-1 text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
        <div className="mt-2 rounded-md px-2 py-1.5 text-[10px]" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.muted }}>
          当前先保存可编辑遮罩；AI 背景修补会在下一阶段读取此遮罩与原图。
        </div>
      </div>
    </NodeShell>
  )
}

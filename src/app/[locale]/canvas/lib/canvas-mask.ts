/**
 * Mask-node helpers: stale detection + rasterization of the editable vector
 * strokes into the inpainting mask PNG the provider consumes.
 *
 * Coordinate contract: stroke points are normalized 0–1 against the FULL
 * plate (the MaskNode drawing surface matches the plate's aspect ratio, so
 * there is no crop). On screen the strokes render in a 1000×1000 SVG viewBox
 * stretched with preserveAspectRatio="none"; the rasterizer reproduces the
 * exact same stretch via ctx.scale(width/1000, height/1000), so what the user
 * painted is what the provider receives — including the non-uniform brush
 * stretch on non-square plates.
 *
 * Mask semantics (AtlasCloud openai/gpt-image-1/edit — the only bound
 * mask-edit model, schema verified 2026-07-17): the mask is a PNG whose FULLY
 * TRANSPARENT areas mark the region to regenerate. So: start fully opaque,
 * 画入 strokes erase alpha (destination-out), 擦除 strokes paint opacity back.
 */

import type { CanvasMaskPath, CanvasNodeData } from './canvas-types'

/** The SVG viewBox edge the MaskNode draws in (see MaskNode VIEWBOX). */
export const MASK_VIEWBOX = 1000
/** On-screen stroke width = brushSize × this factor, in viewBox units. */
export const MASK_BRUSH_STROKE_FACTOR = 3

/**
 * Stable signature for a plate URL: signed COS URLs rotate their query on
 * every fetch, so only the path identifies the underlying picture.
 */
export function maskSourceSig(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null
  return url.split('?')[0]
}

/** True when committed strokes were drawn over a different plate than the
 *  one currently displayed (upstream regenerated / rewired). */
export function isMaskStale(
  paths: readonly CanvasMaskPath[] | undefined,
  drawnOnSig: string | null | undefined,
  currentSig: string | null,
): boolean {
  if (!paths || paths.length === 0) return false
  if (!drawnOnSig || !currentSig) return false
  return drawnOnSig !== currentSig
}

/** True when the net stroke set can mark any region (at least one 画入). */
export function hasMaskInk(paths: readonly CanvasMaskPath[] | undefined): boolean {
  return Boolean(paths?.some((p) => p.mode === 'add' && p.points.length > 0))
}

/** What a downstream 局部重绘 consumer needs from a connected mask node. */
export interface UpstreamMask {
  paths: CanvasMaskPath[]
  plateUrl: string | null
  plateKey: string | null
  width: number | null
  height: number | null
  drawnOnSig: string | null
}

interface UpstreamNodeLike {
  type?: string | null
  data?: Record<string, unknown> | null
}

/** First connected mask node's payload (one mask per generative node). */
export function pickUpstreamMask(
  upstream: ReadonlyArray<UpstreamNodeLike | null | undefined>,
): UpstreamMask | null {
  const node = upstream.find((n) => n?.type === 'mask')
  if (!node) return null
  const d = (node.data ?? {}) as CanvasNodeData
  return {
    paths: d.maskPaths ?? [],
    plateUrl: d.maskPlateUrl ?? null,
    plateKey: d.maskPlateKey ?? null,
    width: d.maskSourceWidth ?? null,
    height: d.maskSourceHeight ?? null,
    drawnOnSig: d.maskDrawnOnSig ?? null,
  }
}

/**
 * Pre-submit gate for 局部重绘. Returns a user-facing reason the submission
 * must not proceed, or null when the mask is usable. Mirrors the server-side
 * rejections so users get the message before the freeze/rollback round-trip.
 */
export function validateMaskForSubmit(
  mask: UpstreamMask,
  modelSupportsMask: boolean,
): string | null {
  if (!modelSupportsMask) {
    return '当前模型不支持局部重绘：请切换到 GPT Image 1 (局部重繪/遮罩編輯)'
  }
  if (!mask.plateUrl && !mask.plateKey) {
    return '遮罩节点还没有底图：请给遮罩节点连入图片或上传实拍画面'
  }
  if (!hasMaskInk(mask.paths)) {
    return '遮罩为空：请在遮罩节点用画入笔刷圈出要重绘的区域'
  }
  if (!mask.width || !mask.height) {
    return '底图尺寸未就绪：请等遮罩节点的底图加载完成'
  }
  if (isMaskStale(mask.paths, mask.drawnOnSig, maskSourceSig(mask.plateUrl))) {
    return '遮罩底图已更新，现有笔画可能错位：请在遮罩节点清空后重新圈选'
  }
  return null
}

/**
 * Minimal 2D-context surface the painter needs — lets tests drive it with a
 * recording stub instead of a real canvas.
 */
export interface MaskPaintContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  globalCompositeOperation: string
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  scale(x: number, y: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  fill(): void
}

/**
 * Paint the stroke set onto a width×height surface. Caller owns canvas
 * creation/encoding; this only issues draw ops (pure w.r.t. the ctx passed).
 */
export function paintMaskPaths(
  ctx: MaskPaintContext,
  paths: readonly CanvasMaskPath[],
  width: number,
  height: number,
): void {
  // Opaque base: nothing is editable until 画入 erases alpha.
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)
  // Draw in viewBox units; the scale reproduces the SVG's non-uniform stretch.
  ctx.scale(width / MASK_VIEWBOX, height / MASK_VIEWBOX)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#000000'
  for (const path of paths) {
    if (path.points.length === 0) continue
    ctx.globalCompositeOperation = path.mode === 'add' ? 'destination-out' : 'source-over'
    const strokeWidth = path.brushSize * MASK_BRUSH_STROKE_FACTOR
    if (path.points.length === 1) {
      // A tap: canvas won't render a zero-length round-cap line — draw the dot.
      const p = path.points[0]
      ctx.beginPath()
      ctx.arc(p.x * MASK_VIEWBOX, p.y * MASK_VIEWBOX, strokeWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.lineWidth = strokeWidth
    ctx.beginPath()
    ctx.moveTo(path.points[0].x * MASK_VIEWBOX, path.points[0].y * MASK_VIEWBOX)
    for (const p of path.points.slice(1)) {
      ctx.lineTo(p.x * MASK_VIEWBOX, p.y * MASK_VIEWBOX)
    }
    ctx.stroke()
  }
}

/**
 * Rasterize the strokes to the mask PNG at the plate's natural pixel size.
 * Browser-only (creates a DOM canvas); server code never calls this — the
 * client uploads the PNG and the worker only forwards its URL.
 */
export async function rasterizeMaskToPngBlob(
  paths: readonly CanvasMaskPath[],
  width: number,
  height: number,
): Promise<Blob> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(`遮罩栅格化尺寸无效：${width}×${height}`)
  }
  if (!hasMaskInk(paths)) {
    throw new Error('遮罩为空：请先用画入笔刷圈出要重绘的区域')
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('遮罩栅格化失败：无法创建 2D 画布')
  paintMaskPaths(ctx, paths, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('遮罩栅格化失败：PNG 编码为空')
  return blob
}

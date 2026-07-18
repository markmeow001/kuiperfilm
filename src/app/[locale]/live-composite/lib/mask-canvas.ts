import { maskRasterToImageData } from './mask-analysis'
import { renderMaskStrokes } from './mask-strokes'
import type { MaskRaster, MaskStroke } from '../live-composite-types'

const rasterCanvasCache = new WeakMap<MaskRaster, HTMLCanvasElement>()

function rasterCanvas(raster: MaskRaster): HTMLCanvasElement {
  const cached = rasterCanvasCache.get(raster)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = raster.width
  canvas.height = raster.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('無法建立 AI 遮罩畫布')
  context.putImageData(maskRasterToImageData(raster), 0, 0)
  rasterCanvasCache.set(raster, canvas)
  return canvas
}

export function paintMaskCanvas(
  canvas: HTMLCanvasElement | null,
  strokes: MaskStroke[],
  raster?: MaskRaster,
  activeStroke?: MaskStroke | null,
): void {
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (raster) context.drawImage(rasterCanvas(raster), 0, 0, canvas.width, canvas.height)
  renderMaskStrokes(
    context,
    activeStroke ? [...strokes, activeStroke] : strokes,
    canvas.width,
    canvas.height,
    false,
  )
}

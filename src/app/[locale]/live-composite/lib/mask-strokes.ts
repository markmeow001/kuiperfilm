import type { MaskStroke, NormalizedPoint } from '../live-composite-types'

export interface DisplayRect {
  left: number
  top: number
  width: number
  height: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export function pointerToNormalizedPoint(clientX: number, clientY: number, rect: DisplayRect): NormalizedPoint {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('遮罩畫布尺寸無效')
  }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  }
}

export function brushPixels(size: number, width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    throw new Error('影片尺寸無效')
  }
  return Math.max(1, size * Math.min(width, height))
}

function drawStroke(context: CanvasRenderingContext2D, stroke: MaskStroke, width: number, height: number): void {
  const first = stroke.points[0]
  if (!first) return

  context.save()
  context.globalCompositeOperation = stroke.tool === 'keep' ? 'source-over' : 'destination-out'
  context.strokeStyle = '#ffffff'
  context.fillStyle = '#ffffff'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = brushPixels(stroke.size, width, height)

  if (stroke.points.length === 1) {
    context.beginPath()
    context.arc(first.x * width, first.y * height, context.lineWidth / 2, 0, Math.PI * 2)
    context.fill()
  } else {
    context.beginPath()
    context.moveTo(first.x * width, first.y * height)
    stroke.points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height))
    context.stroke()
  }
  context.restore()
}

export function renderMaskStrokes(
  context: CanvasRenderingContext2D,
  strokes: MaskStroke[],
  width: number,
  height: number,
  clear: boolean = true,
): void {
  if (clear) context.clearRect(0, 0, width, height)
  strokes.forEach((stroke) => drawStroke(context, stroke, width, height))
}

export function appendStrokePoint(stroke: MaskStroke, point: NormalizedPoint): MaskStroke {
  const previous = stroke.points.at(-1)
  if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.001) return stroke
  return { ...stroke, points: [...stroke.points, point] }
}

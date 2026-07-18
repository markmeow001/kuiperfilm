export interface PixelRect {
  left: number
  top: number
  width: number
  height: number
}

export interface OutpaintGeometry {
  width: number
  height: number
  source: PixelRect
}

export function aspectRatioValue(aspect: string): number {
  const [width, height] = aspect.split(':').map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`CANVAS_IMAGE_ASPECT_INVALID:${aspect}`)
  }
  return width / height
}

export function centerCropRect(width: number, height: number, aspect: string): PixelRect {
  const target = aspectRatioValue(aspect)
  const source = width / height
  if (source > target) {
    const cropWidth = Math.max(1, Math.round(height * target))
    return { left: Math.floor((width - cropWidth) / 2), top: 0, width: cropWidth, height }
  }
  const cropHeight = Math.max(1, Math.round(width / target))
  return { left: 0, top: Math.floor((height - cropHeight) / 2), width, height: cropHeight }
}

export function outpaintGeometry(width: number, height: number, aspect: string): OutpaintGeometry {
  const target = aspectRatioValue(aspect)
  const source = width / height
  const outputWidth = source < target ? Math.ceil(height * target) : width
  const outputHeight = source > target ? Math.ceil(width / target) : height
  return {
    width: outputWidth,
    height: outputHeight,
    source: {
      left: Math.floor((outputWidth - width) / 2),
      top: Math.floor((outputHeight - height) / 2),
      width,
      height,
    },
  }
}

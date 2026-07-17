/**
 * Live Composite — MaskRaster <-> PNG round-trip (browser-only).
 *
 * Save path: raster → white-RGB + alpha ImageData → canvas → PNG blob.
 * Load path: signed PNG URL → fetch → ImageBitmap → canvas → alpha channel.
 * The alpha channel is the single source of truth in both directions, so a
 * decoded raster feeds `paintMask` exactly like a freshly analyzed one.
 */
import { maskRasterToImageData } from './mask-analysis'
import type { MaskRaster } from '../live-composite-types'

export async function maskRasterToPngBlob(raster: MaskRaster): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = raster.width
  canvas.height = raster.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('無法建立遮罩輸出畫布')
  context.putImageData(maskRasterToImageData(raster), 0, 0)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('無法將 AI 遮罩輸出為 PNG'))
    }, 'image/png')
  })
}

export async function fetchPngAsMaskRaster(url: string): Promise<MaskRaster> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(`AI 遮罩下載失敗：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new Error(`AI 遮罩下載失敗（HTTP ${response.status}）`)
  }
  const blob = await response.blob()
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch (error) {
    throw new Error(`AI 遮罩 PNG 無法解碼：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('無法建立遮罩解碼畫布')
    context.drawImage(bitmap, 0, 0)
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const alpha = new Uint8ClampedArray(bitmap.width * bitmap.height)
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = imageData.data[index * 4 + 3]
    }
    return { width: bitmap.width, height: bitmap.height, alpha }
  } finally {
    bitmap.close()
  }
}

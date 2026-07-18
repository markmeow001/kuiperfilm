import { seekVideoGuarded } from './video-seek'

const ANALYSIS_SEEK_TIMEOUT_MS = 5_000

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('無法建立 PNG 輸出'))
    }, 'image/png')
  })
}

export function drawCover(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

export function seekVideoForAnalysis(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  return seekVideoGuarded(video, time, {
    signal,
    timeoutMs: ANALYSIS_SEEK_TIMEOUT_MS,
    createTimeoutError: (timeoutSeconds) => new Error(`影片跳轉超過 ${timeoutSeconds} 秒，無法分析指定影格`),
    createSeekFailedError: () => new Error('影片跳轉失敗，無法分析指定影格'),
    createAbortError: () => new Error('分析已中止'),
  })
}

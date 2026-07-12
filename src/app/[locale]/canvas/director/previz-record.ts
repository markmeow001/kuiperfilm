/**
 * previz 客户端录制 — canvas.captureStream + MediaRecorder。
 *
 * 录整个 WebGL 画布（DOM overlay 不入画），裁切交给服务端 ffmpeg（这里只算
 * 与 capture() 同款的 max-fit 居中裁切参数）。录制是实时的：调用方必须把
 * 播放速率锁 1.0，否则导出的片长会跟预演时长不一致。
 */
import type { PrevizCrop } from '@/lib/canvas/previz-transcode'

/** 浏览器可用的录制 mime（vp9 → vp8 → 裸 webm → mp4/Safari）。 */
export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return null
}

/** 与 DirectorStage capture() 同款的居中 max-fit 裁切区域。 */
export function computeExportCrop(canvasW: number, canvasH: number, aspect: '9:16' | '16:9'): PrevizCrop {
  const ratio = aspect === '9:16' ? 9 / 16 : 16 / 9
  let w = canvasW
  let h = canvasH
  if (ratio > canvasW / canvasH) h = Math.round(canvasW / ratio)
  else w = Math.round(canvasH * ratio)
  return { x: Math.floor((canvasW - w) / 2), y: Math.floor((canvasH - h) / 2), w, h }
}

export interface RecordedClip {
  blob: Blob
  mimeType: string
}

/**
 * 录制一段预演。start() 触发播放，isDone() 每帧轮询（播到区间尾 → true）。
 * maxMs 是防呆硬顶（isDone 永远不真时不无限录）。
 */
export function recordPrevizClip(opts: {
  canvas: HTMLCanvasElement
  start: () => void
  isDone: () => boolean
  maxMs: number
}): Promise<RecordedClip> {
  const { canvas, start, isDone, maxMs } = opts
  const mimeType = pickRecorderMime()
  if (!mimeType) return Promise.reject(new Error('当前浏览器不支持画布录制（MediaRecorder）'))

  return new Promise<RecordedClip>((resolve, reject) => {
    let stream: MediaStream
    try {
      stream = canvas.captureStream(30)
    } catch (err) {
      reject(new Error(`画布视频流创建失败：${err instanceof Error ? err.message : String(err)}`))
      return
    }
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 })
    const chunks: Blob[] = []
    let raf = 0
    let settled = false

    const cleanup = () => {
      cancelAnimationFrame(raf)
      for (const track of stream.getTracks()) track.stop()
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => {
      if (settled) return
      settled = true
      cleanup()
      if (chunks.length === 0) {
        reject(new Error('录制结果为空，请重试'))
        return
      }
      resolve({ blob: new Blob(chunks, { type: mimeType.split(';')[0] }), mimeType: mimeType.split(';')[0] })
    }
    recorder.onerror = (e) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`录制失败：${(e as ErrorEvent).error?.message ?? '未知错误'}`))
    }

    const deadline = performance.now() + maxMs
    const poll = () => {
      if (settled) return
      if (isDone() || performance.now() > deadline) {
        // 多录 2 帧再停，避免最后一帧截断
        setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, 80)
        return
      }
      raf = requestAnimationFrame(poll)
    }

    recorder.start(250) // 250ms timeslice → 崩溃也有已收 chunk
    start()
    raf = requestAnimationFrame(poll)
  })
}

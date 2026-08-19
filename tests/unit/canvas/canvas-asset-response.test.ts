import { describe, expect, it } from 'vitest'
import {
  canvasAssetMaxBytes,
  resolveCanvasAssetContentType,
} from '@/lib/canvas/canvas-asset-response'

describe('canvas asset proxy response policy', () => {
  it('[Atlas WAV 上游標示 octet-stream] -> [依 durable key 推斷 WAV 並使用音訊上限]', () => {
    const contentType = resolveCanvasAssetContentType(
      'application/octet-stream',
      'voice/playground-ref/user-1/tts-node.wav',
    )

    expect(contentType).toBe('audio/wav')
    if (!contentType) throw new Error('expected audio content type')
    expect(canvasAssetMaxBytes(contentType)).toBe(32 * 1024 * 1024)
  })

  it('[合法圖片] -> [保留圖片 MIME 與既有 15 MiB 上限]', () => {
    const contentType = resolveCanvasAssetContentType(
      'image/webp; charset=binary',
      'images/playground-ref/user-1/frame.jpg',
    )

    expect(contentType).toBe('image/webp')
    if (!contentType) throw new Error('expected image content type')
    expect(canvasAssetMaxBytes(contentType)).toBe(15 * 1024 * 1024)
  })

  it('[影片或未知內容] -> [拒絕，不把代理擴成任意檔案下載器]', () => {
    expect(resolveCanvasAssetContentType(
      'video/mp4',
      'video/playground-ref/user-1/result.mp4',
    )).toBeNull()
    expect(resolveCanvasAssetContentType(
      'text/html',
      'voice/playground-ref/user-1/no-extension',
    )).toBeNull()
  })
})

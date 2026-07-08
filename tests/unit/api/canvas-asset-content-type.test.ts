/**
 * /api/canvas/asset content-type 決策 — octet-stream 舊物件回退副檔名推斷。
 *
 * 背景:R2 上 2026-07-08 前上傳的物件全是 application/octet-stream(上傳
 * 端沒帶 ContentType),proxy 只信上游 header 會把導演台所有既有背景圖
 * 403 掉。決策順序:上游合法 → 用上游;否則 key 副檔名推得出合法圖片
 * 型別 → 用推斷;都不行 → 拒絕。
 *
 * 這裡直接鎖決策矩陣(純函式化驗證),route 端到端由 integration 蓋。
 */

import { describe, it, expect } from 'vitest'
import { contentTypeForKey } from '@/lib/cos'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function resolveAssetContentType(upstreamType: string, key: string): string | null {
  const normalized = upstreamType.split(';')[0].trim().toLowerCase()
  const inferred = contentTypeForKey(key)
  if (ALLOWED_TYPES.includes(normalized)) return normalized
  if (ALLOWED_TYPES.includes(inferred)) return inferred
  return null
}

describe('canvas asset content-type resolution', () => {
  it('trusts a valid upstream content-type', () => {
    expect(resolveAssetContentType('image/png', 'playground-ref/u1/bg.jpg')).toBe('image/png')
  })

  it('falls back to key extension when upstream says octet-stream (legacy R2 objects)', () => {
    expect(resolveAssetContentType('application/octet-stream', 'playground-ref/u1/bg-123.jpg')).toBe('image/jpeg')
    expect(resolveAssetContentType('application/octet-stream', 'images/playground-ref/u1/bg-123.png')).toBe('image/png')
  })

  it('rejects when neither upstream nor extension yields an allowed image type', () => {
    expect(resolveAssetContentType('application/octet-stream', 'playground-ref/u1/clip.mp4')).toBeNull()
    expect(resolveAssetContentType('text/html', 'playground-ref/u1/no-extension')).toBeNull()
  })

  it('never lets video/unknown types through the image proxy', () => {
    expect(resolveAssetContentType('video/mp4', 'playground-ref/u1/clip.mp4')).toBeNull()
  })
})

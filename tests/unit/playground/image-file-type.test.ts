import { describe, expect, it } from 'vitest'
import { detectSupportedImageType } from '@/lib/playground/image-file-type'

describe('detectSupportedImageType', () => {
  it('detects PNG bytes even when the browser label is wrong', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(detectSupportedImageType(png)).toEqual({ extension: 'png', mime: 'image/png' })
  })

  it('detects JPEG and WebP signatures', () => {
    expect(detectSupportedImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))
      .toEqual({ extension: 'jpg', mime: 'image/jpeg' })
    expect(detectSupportedImageType(Buffer.from('RIFF1234WEBPdata', 'ascii')))
      .toEqual({ extension: 'webp', mime: 'image/webp' })
  })

  it('rejects unsupported or spoofed image content', () => {
    expect(detectSupportedImageType(Buffer.from('not-an-image'))).toBeNull()
  })
})

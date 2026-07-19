export interface SupportedImageType {
  extension: 'jpg' | 'png' | 'webp'
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
}

/**
 * Detect the actual image format from file signatures. Browsers occasionally
 * report a PNG clipboard/export as image/jpeg; trusting that label creates an
 * object whose bytes and HTTP Content-Type disagree and can render as black.
 */
export function detectSupportedImageType(buffer: Buffer): SupportedImageType | null {
  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) {
    return { extension: 'jpg', mime: 'image/jpeg' }
  }

  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: 'png', mime: 'image/png' }
  }

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', mime: 'image/webp' }
  }

  return null
}

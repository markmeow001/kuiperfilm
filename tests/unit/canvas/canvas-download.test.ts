import { describe, expect, it } from 'vitest'
import { canvasDownloadHref } from '@/app/[locale]/canvas/lib/canvas-download'

describe('canvasDownloadHref', () => {
  it('routes through the same-origin download proxy and url-encodes the source', () => {
    const href = canvasDownloadHref('https://cos.example.com/a/b.png?sig=1')
    expect(href.startsWith('/api/playground/download?')).toBe(true)
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('url')).toBe('https://cos.example.com/a/b.png?sig=1')
    expect(params.has('filename')).toBe(false)
  })

  it('includes a trimmed filename when provided', () => {
    const params = new URLSearchParams(canvasDownloadHref('key/x.mp4', '  雨夜出租车  ').split('?')[1])
    expect(params.get('filename')).toBe('雨夜出租车')
    expect(params.get('url')).toBe('key/x.mp4')
  })

  it('omits an empty/whitespace filename', () => {
    const params = new URLSearchParams(canvasDownloadHref('key/x.mp4', '   ').split('?')[1])
    expect(params.has('filename')).toBe(false)
  })
})

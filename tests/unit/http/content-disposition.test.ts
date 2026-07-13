import { describe, expect, it } from 'vitest'
import { contentDispositionAttachment } from '@/lib/http/content-disposition'

const isLatin1 = (s: string) => [...s].every((c) => c.charCodeAt(0) <= 255)

describe('contentDispositionAttachment', () => {
  it('keeps an ASCII filename verbatim in the quoted param', () => {
    expect(contentDispositionAttachment('kuiperai-abc.png')).toBe(
      "attachment; filename=\"kuiperai-abc.png\"; filename*=UTF-8''kuiperai-abc.png",
    )
  })

  it('replaces non-ASCII (CJK) in the quoted param but preserves it via filename*', () => {
    const v = contentDispositionAttachment('图片.png')
    expect(v).toContain('filename="__.png"')
    expect(v).toContain(`filename*=UTF-8''${encodeURIComponent('图片.png')}`)
    // The whole header value MUST be Latin-1 or the Response constructor throws
    // (this is the exact bug that produced download.json).
    expect(isLatin1(v)).toBe(true)
  })

  it('escapes quotes/backslashes and falls back only when the ASCII form is empty', () => {
    expect(contentDispositionAttachment('a"b\\c.png')).toContain('filename="a_b_c.png"')
    // a lone CJK char reduces to '_' (still valid) — real name kept in filename*
    expect(contentDispositionAttachment('图')).toContain(`filename*=UTF-8''${encodeURIComponent('图')}`)
    expect(contentDispositionAttachment('')).toContain('filename="download"')
  })
})

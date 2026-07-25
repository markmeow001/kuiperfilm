import { describe, it, expect } from 'vitest'
import {
  filterAuthorizedStorageReferences,
  filterSafeReferences,
  isSafeReference,
} from '@/lib/playground/reference-guard'

const U = 'user-123'

describe('reference guard', () => {
  it('accepts the caller\'s own ref-upload keys (incl. the double-images quirk)', () => {
    expect(isSafeReference(`images/images/playground-ref/${U}/ref-1.png`, U)).toBe(true)
    expect(isSafeReference(`images/video/playground-ref/${U}/ref-1.mp4`, U)).toBe(true)
  })

  it('REJECTS another user\'s bare COS key (cross-user read / C1)', () => {
    expect(isSafeReference('images/images/playground-ref/other-user/ref-1.png', U)).toBe(false)
    expect(isSafeReference('images/some/random/key.png', U)).toBe(false)
    expect(isSafeReference('voice/playground-ref/other/x.mp3', U)).toBe(false)
  })

  it('accepts our https storage URLs (signed COS / R2) — i2v chaining keeps working', () => {
    expect(isSafeReference('https://bucket-123.cos.ap-singapore.myqcloud.com/images/playground-runs/abc-1.png?sign=xxx', U)).toBe(true)
    expect(isSafeReference('https://pub-xyz.r2.dev/images/playground-runs/abc.png', U)).toBe(true)
  })

  it('REJECTS internal / non-https URLs (SSRF / C2)', () => {
    expect(isSafeReference('http://169.254.169.254/latest/meta-data/', U)).toBe(false)
    expect(isSafeReference('http://localhost:3000/api/admin', U)).toBe(false)
    expect(isSafeReference('https://127.0.0.1/x', U)).toBe(false)
    expect(isSafeReference('https://10.0.0.5/internal', U)).toBe(false)
    expect(isSafeReference('https://192.168.1.1/x', U)).toBe(false)
    expect(isSafeReference('http://example.com/x.png', U)).toBe(false) // non-https
    expect(isSafeReference('https://[::1]/x', U)).toBe(false)
  })

  it('allows the local files endpoint, rejects traversal', () => {
    expect(isSafeReference('/api/files/images%2Fplayground-ref%2Fuser-123%2Fx.png', U)).toBe(true)
    expect(isSafeReference('/api/files/../etc/passwd', U)).toBe(false)
    expect(isSafeReference('/etc/passwd', U)).toBe(false)
  })

  it('filterSafeReferences splits safe vs rejected', () => {
    const r = filterSafeReferences([`images/images/playground-ref/${U}/ok.png`, 'images/images/playground-ref/evil/x.png'], U)
    expect(r.safe).toHaveLength(1)
    expect(r.rejected).toHaveLength(1)
  })

  it('rejects empty / non-string', () => {
    expect(isSafeReference('', U)).toBe(false)
    expect(isSafeReference('   ', U)).toBe(false)
  })

  it('storage-only guard accepts the caller upload key but rejects an external HTTPS URL', async () => {
    const ownKey = `video/playground-ref/${U}/depth.webm`
    const result = await filterAuthorizedStorageReferences([
      ownKey,
      'https://attacker.example/depth.webm',
    ], U)

    expect(result).toEqual({
      safe: [ownKey],
      rejected: ['https://attacker.example/depth.webm'],
    })
  })
})

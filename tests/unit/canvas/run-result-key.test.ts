import { describe, expect, it } from 'vitest'
import { pickRunResultKey } from '@/lib/canvas/run-result-key'

describe('pickRunResultKey', () => {
  it('picks the first bare COS key, skipping signed https URLs', () => {
    expect(pickRunResultKey({ resultUrls: ['https://cos/x.png?sig=1', 'images/playground-runs/t1/a.png'] }))
      .toBe('images/playground-runs/t1/a.png')
  })

  it('returns the bare key when it is first', () => {
    expect(pickRunResultKey({ resultUrls: ['images/playground-runs/t1/a.png'] }))
      .toBe('images/playground-runs/t1/a.png')
  })

  it('returns null when every entry is an https URL (no durable key)', () => {
    expect(pickRunResultKey({ resultUrls: ['https://cos/x.png'] })).toBeNull()
  })

  it('returns null for missing / malformed result shapes', () => {
    expect(pickRunResultKey(null)).toBeNull()
    expect(pickRunResultKey({})).toBeNull()
    expect(pickRunResultKey({ resultUrls: 'nope' })).toBeNull()
    expect(pickRunResultKey({ resultUrls: [''] })).toBeNull()
  })
})

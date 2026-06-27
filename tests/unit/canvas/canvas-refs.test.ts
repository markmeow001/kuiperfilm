import { describe, it, expect } from 'vitest'
import { pickUpstreamReferenceUrls } from '@/app/[locale]/canvas/lib/canvas-refs'

describe('pickUpstreamReferenceUrls', () => {
  it('picks resultUrls from image and character nodes in order', () => {
    const urls = pickUpstreamReferenceUrls([
      { type: 'image', data: { resultUrl: 'https://a/img.png' } },
      { type: 'character', data: { resultUrl: 'https://b/char.png' } },
    ])
    expect(urls).toEqual(['https://a/img.png', 'https://b/char.png'])
  })

  it('ignores text and video upstreams', () => {
    const urls = pickUpstreamReferenceUrls([
      { type: 'text', data: { resultUrl: 'https://x' } },
      { type: 'video', data: { resultUrl: 'https://y' } },
      { type: 'image', data: { resultUrl: 'https://keep' } },
    ])
    expect(urls).toEqual(['https://keep'])
  })

  it('skips ref-bearing nodes with no result yet', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'image', data: { resultUrl: null } },
        { type: 'image', data: {} },
        { type: 'character', data: { resultUrl: '' } },
      ]),
    ).toEqual([])
  })

  it('prefers the durable referenceKey over the (expiring) resultUrl', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'director', data: { referenceKey: 'images/playground-ref/u/abc.png', resultUrl: 'https://signed-expiring' } },
        { type: 'character', data: { referenceKey: 'images/playground-ref/u/def.png', resultUrl: 'https://x' } },
      ]),
    ).toEqual(['images/playground-ref/u/abc.png', 'images/playground-ref/u/def.png'])
  })

  it('falls back to resultUrl when no referenceKey (run-result nodes)', () => {
    expect(
      pickUpstreamReferenceUrls([{ type: 'image', data: { resultUrl: 'https://signed-fresh' } }]),
    ).toEqual(['https://signed-fresh'])
  })

  it('includes director nodes as ref-bearing', () => {
    expect(pickUpstreamReferenceUrls([{ type: 'director', data: { resultUrl: 'https://shot' } }])).toEqual(['https://shot'])
  })

  it('tolerates null/undefined entries', () => {
    expect(pickUpstreamReferenceUrls([null, undefined, { type: 'image', data: { resultUrl: 'https://ok' } }])).toEqual([
      'https://ok',
    ])
  })
})

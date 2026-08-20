import { describe, it, expect } from 'vitest'
import { pickUpstreamFrameUrls, pickUpstreamReferenceUrls, pickUpstreamText, resolveFirstLastFrames } from '@/app/[locale]/canvas/lib/canvas-refs'

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

  it('scene and prop nodes are ref-bearing like character (durable key first)', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'scene', data: { referenceKey: 'images/playground-ref/u/room.png', resultUrl: 'https://signed' } },
        { type: 'prop', data: { resultUrl: 'https://prop-only-url' } },
      ]),
    ).toEqual(['images/playground-ref/u/room.png', 'https://prop-only-url'])
  })
})

describe('pickUpstreamReferenceUrls — 脚本转接参考 (2026-08-19 参考只绑脚本)', () => {
  it('script upstream relays its data.refUrls (镜头节点只连 脚本→镜头 一条线)', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'script', data: { refUrls: ['images/playground-ref/u/hero.png', 'images/playground-ref/u/room.png'] } },
      ]),
    ).toEqual(['images/playground-ref/u/hero.png', 'images/playground-ref/u/room.png'])
  })

  it('script with empty/absent refUrls contributes nothing (不发明参考)', () => {
    expect(pickUpstreamReferenceUrls([{ type: 'script', data: { refUrls: [] } }])).toEqual([])
    expect(pickUpstreamReferenceUrls([{ type: 'script', data: {} }])).toEqual([])
  })

  it('script refUrls junk entries are dropped, not stringified', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'script', data: { refUrls: ['images/ok.png', '', 42, null] } },
      ]),
    ).toEqual(['images/ok.png'])
  })

  it('script relay composes with direct refs in connection order', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'script', data: { refUrls: ['images/from-script.png'] } },
        { type: 'image', data: { resultUrl: 'https://direct.png' } },
      ]),
    ).toEqual(['images/from-script.png', 'https://direct.png'])
  })
})

describe('pickUpstreamFrameUrls', () => {
  it('two connected images -> preserves first/last frame order', () => {
    expect(pickUpstreamFrameUrls([
      { type: 'image', data: { referenceKey: 'images/first.png' } },
      { type: 'image', data: { resultUrl: 'https://example/last.png' } },
    ])).toEqual(['images/first.png', 'https://example/last.png'])
  })

  it('character identity ref -> never becomes a blocking frame', () => {
    expect(pickUpstreamFrameUrls([
      { type: 'character', data: { referenceKey: 'images/character.png' } },
      { type: 'image', data: { referenceKey: 'images/shot.png' } },
    ])).toEqual(['images/shot.png'])
  })

  it('video -> contributes only extracted tail frame', () => {
    expect(pickUpstreamFrameUrls([
      { type: 'video', data: { resultUrl: 'https://example/clip.mp4', tailFrameUrl: 'https://example/tail.jpg' } },
    ])).toEqual(['https://example/tail.jpg'])
  })
})

describe('pickUpstreamReferenceUrls — 视频尾帧续镜链 (2026-07-08)', () => {
  it('video upstream contributes its tailFrameUrl (首尾帧接力)', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'video', data: { tailFrameUrl: 'https://pub.example/tail.jpg', resultUrl: 'https://pub.example/clip.mp4' } },
      ]),
    ).toEqual(['https://pub.example/tail.jpg'])
  })

  it('video without tailFrameUrl contributes nothing (旧结果/抽帧失败静默跳过)', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'video', data: { resultUrl: 'https://pub.example/clip.mp4' } },
      ]),
    ).toEqual([])
  })

  it('video never contributes its mp4 resultUrl as an image ref', () => {
    expect(
      pickUpstreamReferenceUrls([
        { type: 'video', data: { tailFrameUrl: '', resultUrl: 'https://pub.example/clip.mp4' } },
        { type: 'image', data: { resultUrl: 'https://pub.example/frame.png' } },
      ]),
    ).toEqual(['https://pub.example/frame.png'])
  })
})

describe('resolveFirstLastFrames — 首尾帧来源选择链（连线顺序语义）', () => {
  const F = ['edge1.png', 'edge2.png']

  it('无 anchor：第 1 条连线当首帧、第 2 条当尾帧', () => {
    expect(resolveFirstLastFrames({ upstreamFrames: F }))
      .toEqual({ firstFrame: 'edge1.png', lastFrame: 'edge2.png' })
  })

  it('有 anchor（本节点参考图）：anchor 当首帧、第 1 条连线当尾帧', () => {
    expect(resolveFirstLastFrames({ anchorKey: 'anchor.png', upstreamFrames: F }))
      .toEqual({ firstFrame: 'anchor.png', lastFrame: 'edge1.png' })
  })

  it('显式上传的尾帧永远赢过连线', () => {
    expect(resolveFirstLastFrames({ anchorKey: 'anchor.png', lastFrameKey: 'uploaded.png', upstreamFrames: F }))
      .toEqual({ firstFrame: 'anchor.png', lastFrame: 'uploaded.png' })
    expect(resolveFirstLastFrames({ lastFrameKey: 'uploaded.png', upstreamFrames: F }))
      .toEqual({ firstFrame: 'edge1.png', lastFrame: 'uploaded.png' })
  })

  it('帧不够时显式回 null（提交前 setError 挡，不静默降级）', () => {
    expect(resolveFirstLastFrames({ upstreamFrames: [] }))
      .toEqual({ firstFrame: null, lastFrame: null })
    expect(resolveFirstLastFrames({ upstreamFrames: ['only.png'] }))
      .toEqual({ firstFrame: 'only.png', lastFrame: null })
    expect(resolveFirstLastFrames({ anchorKey: 'a.png', upstreamFrames: [] }))
      .toEqual({ firstFrame: 'a.png', lastFrame: null })
  })
})


describe('pickUpstreamText — script 分镜倾倒开关 (2026-08-20 review #12)', () => {
  const upstream = [
    { type: 'text', data: { prompt: '补充画面细节' } },
    { type: 'script', data: { shots: [{ description: '镜1描述', dialogue: '对白1' }, { description: '镜2描述' }] } },
  ]

  it('[默认] -> [script 分镜文字照旧贡献（音频节点的对白来源）]', () => {
    const text = pickUpstreamText(upstream)
    expect(text).toContain('补充画面细节')
    expect(text).toContain('镜1描述')
  })

  it('[includeScriptShots:false] -> [text 节点保留，script 全剧倾倒被排除（MediaNode 用）]', () => {
    const text = pickUpstreamText(upstream, { includeScriptShots: false })
    expect(text).toBe('补充画面细节')
    expect(text).not.toContain('镜1描述')
  })
})

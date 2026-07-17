import { describe, expect, it } from 'vitest'
import { canConnectCanvasNodes, inferCanvasEdgeData } from '@/app/[locale]/canvas/lib/canvas-connections'

describe('canvas connection contract', () => {
  it.each([
    ['text', 'script'], ['text', 'image'], ['text', 'video'], ['text', 'audio'],
    ['script', 'image'], ['script', 'video'], ['script', 'audio'],
    ['character', 'image'], ['character', 'video'], ['character', 'director'],
    ['image', 'character'],
    ['image', 'image'], ['image', 'video'], ['image', 'director'],
    ['video', 'image'], ['video', 'video'],
    ['video', 'composition'],
    ['composition', 'composition'],
    ['audio', 'composition'],
    ['image', 'mask'],
    // 局部重绘 (2026-07-17): mask 输出接图片节点 — consumer 在 MediaNode
    // (upstreamMask → rasterize+upload → maskImage)。
    ['mask', 'image'],
  ] as const)('%s -> %s 在连线白名单内（consumer 存在性靠人工核对，白名单新增时必须同步核对）', (source, target) => {
    expect(canConnectCanvasNodes(source, target)).toBe(true)
  })

  it.each([
    ['audio', 'video'], ['group', 'image'], ['director', 'video'],
    ['video', 'audio'], ['script', 'director'], ['text', 'character'],
    ['image', 'composition'], ['video', 'mask'], ['mask', 'video'],
    ['mask', 'composition'], ['mask', 'character'],
  ] as const)('%s -> %s is rejected instead of drawing a fake wire', (source, target) => {
    expect(canConnectCanvasNodes(source, target)).toBe(false)
  })
})

describe('inferCanvasEdgeData', () => {
  it('firstlast image edges -> deterministic first/last roles by connection order', () => {
    expect(inferCanvasEdgeData('image', 'video', { targetMode: 'firstlast', frameIndex: 0 })).toEqual({ portType: 'frame-image', order: 0, role: 'first-frame' })
    expect(inferCanvasEdgeData('image', 'video', { targetMode: 'firstlast', frameIndex: 1 })).toEqual({ portType: 'frame-image', order: 1, role: 'last-frame' })
  })

  it('character edge -> identity reference, never a blocking frame', () => {
    expect(inferCanvasEdgeData('character', 'video', { targetMode: 'firstlast', frameIndex: 0 })).toEqual({ portType: 'identity-image', role: 'reference' })
  })

  it('image -> character edge -> reference (角色节点吃上游生成图作参考)', () => {
    expect(inferCanvasEdgeData('image', 'character')).toEqual({ portType: 'frame-image', role: 'reference' })
  })

  it('unsupported legacy pair -> explicit invalid metadata', () => {
    expect(inferCanvasEdgeData('audio', 'video')).toMatchObject({ portType: 'audio-voice', invalid: true })
  })

  it('mask -> image edge carries the mask role (局部重绘)', () => {
    expect(inferCanvasEdgeData('mask', 'image')).toEqual({ portType: 'mask-image', role: 'mask' })
  })
})

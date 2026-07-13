import { describe, expect, it } from 'vitest'
import { canConnectCanvasNodes } from '@/app/[locale]/canvas/lib/canvas-connections'

describe('canvas connection contract', () => {
  it.each([
    ['text', 'script'], ['text', 'image'], ['text', 'video'], ['text', 'audio'],
    ['script', 'image'], ['script', 'video'], ['script', 'audio'],
    ['character', 'image'], ['character', 'video'], ['character', 'director'],
    ['image', 'image'], ['image', 'video'], ['image', 'director'],
    ['video', 'image'], ['video', 'video'],
  ] as const)('%s -> %s 在连线白名单内（consumer 存在性靠人工核对，白名单新增时必须同步核对）', (source, target) => {
    expect(canConnectCanvasNodes(source, target)).toBe(true)
  })

  it.each([
    ['audio', 'video'], ['group', 'image'], ['director', 'video'],
    ['video', 'audio'], ['script', 'director'], ['text', 'character'],
  ] as const)('%s -> %s is rejected instead of drawing a fake wire', (source, target) => {
    expect(canConnectCanvasNodes(source, target)).toBe(false)
  })
})

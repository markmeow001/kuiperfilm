import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { CanvasNodeData } from '@/app/[locale]/canvas/lib/canvas-types'
import { completedStoryboardImages, isStoryboardExportStale, moveStoryboardChild, orderStoryboardChildren, storyboardInputsSignature } from '@/app/[locale]/canvas/lib/storyboard-group'

function node(id: string, type: string, runId: string | null = null): Node<CanvasNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data: { title: id, prompt: '', modelKey: '', aspectRatio: '9:16', runId } }
}

describe('storyboard group ordering and export staleness', () => {
  it('stored order with deleted and new children -> filters deleted ids then appends new children', () => {
    const children = [node('a', 'image'), node('c', 'video'), node('d', 'image')]
    expect(orderStoryboardChildren(children, ['c', 'missing', 'a']).map((item) => item.id)).toEqual(['c', 'a', 'd'])
  })

  it('move past either boundary -> rejects; valid move returns explicit full order', () => {
    const children = [node('a', 'image'), node('b', 'image'), node('c', 'image')]
    expect(moveStoryboardChild(children, 0, -1)).toBeNull()
    expect(moveStoryboardChild(children, 2, 1)).toBeNull()
    expect(moveStoryboardChild(children, 1, -1)).toEqual(['b', 'a', 'c'])
  })

  it('mixed or unfinished children -> only completed image content enters export', () => {
    const children = [node('image-ready', 'image', 'run-1'), node('video', 'video', 'run-2'), node('image-pending', 'image'), node('image-empty', 'image', '')]
    expect(completedStoryboardImages(children).map((item) => item.id)).toEqual(['image-ready'])
  })

  it('same ordered run ids -> fresh; changed run or order -> stale', () => {
    const original = [node('a', 'image', 'run-1'), node('b', 'image', 'run-2')]
    const signature = storyboardInputsSignature(original)
    expect(isStoryboardExportStale(signature, storyboardInputsSignature(original))).toBe(false)
    expect(isStoryboardExportStale(signature, storyboardInputsSignature([node('a', 'image', 'run-3'), original[1]]))).toBe(true)
    expect(isStoryboardExportStale(signature, storyboardInputsSignature([...original].reverse()))).toBe(true)
    expect(isStoryboardExportStale(null, storyboardInputsSignature(original))).toBe(false)
  })
})

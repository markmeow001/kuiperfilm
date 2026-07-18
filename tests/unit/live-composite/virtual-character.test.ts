import { describe, expect, it } from 'vitest'
import {
  characterMediaTime,
  computeCharacterTransform,
  findPersonBounds,
  isCharacterVisible,
  resolveCharacterCenter,
  resolveTrackedPersonCenter,
} from '@/app/[locale]/live-composite/lib/virtual-character'
import type { MaskRaster, VirtualCharacterLayer } from '@/app/[locale]/live-composite/live-composite-types'

function layer(overrides: Partial<VirtualCharacterLayer> = {}): VirtualCharacterLayer {
  return {
    assetType: 'image',
    assetName: 'robot.png',
    assetUrl: 'blob:robot',
    assetKey: null,
    anchor: 'screen',
    x: 0.75,
    y: 0.5,
    offsetX: 0.2,
    offsetY: -0.1,
    scale: 0.4,
    rotation: 90,
    opacity: 0.8,
    startTime: 1,
    endTime: 5,
    loop: true,
    depth: 'behind-person',
    ...overrides,
  }
}

function personMask(): MaskRaster {
  return {
    width: 4,
    height: 4,
    alpha: new Uint8ClampedArray([
      0, 0, 0, 0,
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ]),
  }
}

describe('virtual character compositing geometry', () => {
  it('extracts normalized person bounds from a mask raster', () => {
    expect(findPersonBounds(personMask())).toEqual({ left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 })
    expect(findPersonBounds({ width: 1, height: 1, alpha: new Uint8ClampedArray([0]) })).toBeNull()
    expect(findPersonBounds({ width: 2, height: 2, alpha: new Uint8ClampedArray([255]) })).toBeNull()
  })

  it('follows the person center and falls back to screen coordinates without a mask', () => {
    const tracked = layer({ anchor: 'person' })
    expect(resolveCharacterCenter(tracked, personMask())).toEqual({ x: 0.7, y: 0.4 })
    expect(resolveCharacterCenter(tracked, undefined)).toEqual({ x: 0.75, y: 0.5 })
  })

  it('smoothly interpolates tracking centers between mask keyframes', () => {
    const leftMask: MaskRaster = {
      width: 4, height: 2,
      alpha: new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 0]),
    }
    const rightMask: MaskRaster = {
      width: 4, height: 2,
      alpha: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]),
    }
    const keyframes = [
      { id: 'a', time: 0, strokes: [], baseMask: leftMask },
      { id: 'b', time: 2, strokes: [], baseMask: rightMask },
    ]
    expect(resolveTrackedPersonCenter(keyframes, 1)).toEqual({ x: 0.5, y: 0.5 })
    expect(resolveTrackedPersonCenter(keyframes, -1)).toEqual({ x: 0.125, y: 0.5 })
    expect(resolveTrackedPersonCenter([], 1)).toBeNull()
  })

  it('computes aspect-correct stage geometry and opacity', () => {
    const transform = computeCharacterTransform(layer(), undefined, 1920, 1080, 500, 1000)
    expect(transform.centerX).toBe(1440)
    expect(transform.centerY).toBe(540)
    expect(transform.height).toBe(432)
    expect(transform.width).toBe(216)
    expect(transform.rotationRadians).toBeCloseTo(Math.PI / 2)
    expect(transform.opacity).toBe(0.8)
  })

  it('applies inclusive timeline visibility and looping media time', () => {
    const character = layer()
    expect(isCharacterVisible(character, 0.99)).toBe(false)
    expect(isCharacterVisible(character, 1)).toBe(true)
    expect(isCharacterVisible(character, 5)).toBe(true)
    expect(isCharacterVisible(character, 5.01)).toBe(false)
    expect(characterMediaTime(character, 6.5, 2)).toBe(1.5)
    expect(characterMediaTime({ ...character, loop: false }, 6.5, 2)).toBeCloseTo(1.999)
  })
})

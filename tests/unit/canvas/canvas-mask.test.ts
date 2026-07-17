import { describe, expect, it } from 'vitest'
import {
  MASK_BRUSH_STROKE_FACTOR,
  MASK_VIEWBOX,
  hasMaskInk,
  isMaskStale,
  maskSourceSig,
  paintMaskPaths,
  type MaskPaintContext,
} from '@/app/[locale]/canvas/lib/canvas-mask'
import type { CanvasMaskPath } from '@/app/[locale]/canvas/lib/canvas-types'

function path(mode: 'add' | 'erase', points: Array<[number, number]>, brushSize = 18): CanvasMaskPath {
  return { mode, brushSize, points: points.map(([x, y]) => ({ x, y })) }
}

type Op =
  | { op: 'fillRect'; args: number[] }
  | { op: 'scale'; args: number[] }
  | { op: 'beginPath' }
  | { op: 'moveTo'; args: number[] }
  | { op: 'lineTo'; args: number[] }
  | { op: 'stroke'; composite: string; lineWidth: number }
  | { op: 'arc'; args: number[]; composite: string }
  | { op: 'fill'; composite: string }

function recordingCtx() {
  const ops: Op[] = []
  const ctx: MaskPaintContext = {
    fillStyle: '',
    strokeStyle: '',
    globalCompositeOperation: 'source-over',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    scale: (x, y) => ops.push({ op: 'scale', args: [x, y] }),
    fillRect: (...args) => ops.push({ op: 'fillRect', args }),
    beginPath: () => ops.push({ op: 'beginPath' }),
    moveTo: (...args) => ops.push({ op: 'moveTo', args }),
    lineTo: (...args) => ops.push({ op: 'lineTo', args }),
    stroke: () => ops.push({ op: 'stroke', composite: ctx.globalCompositeOperation, lineWidth: ctx.lineWidth }),
    arc: (...args) => ops.push({ op: 'arc', args, composite: ctx.globalCompositeOperation }),
    fill: () => ops.push({ op: 'fill', composite: ctx.globalCompositeOperation }),
  }
  return { ctx, ops }
}

describe('maskSourceSig', () => {
  it('strips the rotating signed-URL query so the same picture keeps one signature', () => {
    expect(maskSourceSig('https://cos.example/images/a.png?sign=1')).toBe('https://cos.example/images/a.png')
    expect(maskSourceSig('https://cos.example/images/a.png?sign=2')).toBe('https://cos.example/images/a.png')
  })

  it('returns null for empty / missing urls', () => {
    expect(maskSourceSig(null)).toBeNull()
    expect(maskSourceSig(undefined)).toBeNull()
    expect(maskSourceSig('')).toBeNull()
  })
})

describe('isMaskStale', () => {
  const strokes = [path('add', [[0.1, 0.1], [0.2, 0.2]])]

  it('flags strokes drawn over a different plate', () => {
    expect(isMaskStale(strokes, 'https://cos/a.png', 'https://cos/b.png')).toBe(true)
  })

  it('is not stale when the plate matches (query rotation already stripped)', () => {
    expect(isMaskStale(strokes, 'https://cos/a.png', 'https://cos/a.png')).toBe(false)
  })

  it('is never stale without strokes or without a recorded signature', () => {
    expect(isMaskStale([], 'https://cos/a.png', 'https://cos/b.png')).toBe(false)
    expect(isMaskStale(strokes, null, 'https://cos/b.png')).toBe(false)
    expect(isMaskStale(strokes, 'https://cos/a.png', null)).toBe(false)
  })
})

describe('hasMaskInk', () => {
  it('needs at least one 画入 stroke with points', () => {
    expect(hasMaskInk(undefined)).toBe(false)
    expect(hasMaskInk([])).toBe(false)
    expect(hasMaskInk([path('erase', [[0.5, 0.5]])])).toBe(false)
    expect(hasMaskInk([path('add', [])])).toBe(false)
    expect(hasMaskInk([path('add', [[0.5, 0.5]])])).toBe(true)
  })
})

describe('paintMaskPaths', () => {
  it('lays an opaque base then scales viewBox units to the plate size', () => {
    const { ctx, ops } = recordingCtx()
    paintMaskPaths(ctx, [path('add', [[0, 0], [1, 1]])], 2000, 500)
    expect(ops[0]).toEqual({ op: 'fillRect', args: [0, 0, 2000, 500] })
    expect(ops[1]).toEqual({ op: 'scale', args: [2000 / MASK_VIEWBOX, 500 / MASK_VIEWBOX] })
  })

  it('erases alpha for 画入 and restores it for 擦除, in stroke order', () => {
    const { ctx, ops } = recordingCtx()
    paintMaskPaths(
      ctx,
      [path('add', [[0, 0], [0.5, 0.5]]), path('erase', [[0.1, 0.1], [0.2, 0.2]])],
      1000,
      1000,
    )
    const strokes = ops.filter((o): o is Extract<Op, { op: 'stroke' }> => o.op === 'stroke')
    expect(strokes).toHaveLength(2)
    expect(strokes[0].composite).toBe('destination-out')
    expect(strokes[1].composite).toBe('source-over')
  })

  it('maps normalized points into viewBox units and brush size into stroke width', () => {
    const { ctx, ops } = recordingCtx()
    paintMaskPaths(ctx, [path('add', [[0.25, 0.75], [0.5, 0.5]], 20)], 1000, 1000)
    expect(ops.find((o) => o.op === 'moveTo')).toEqual({ op: 'moveTo', args: [250, 750] })
    expect(ops.find((o) => o.op === 'lineTo')).toEqual({ op: 'lineTo', args: [500, 500] })
    const stroke = ops.find((o): o is Extract<Op, { op: 'stroke' }> => o.op === 'stroke')
    expect(stroke?.lineWidth).toBe(20 * MASK_BRUSH_STROKE_FACTOR)
  })

  it('renders a single-point tap as a filled dot (canvas draws no zero-length line)', () => {
    const { ctx, ops } = recordingCtx()
    paintMaskPaths(ctx, [path('add', [[0.5, 0.5]], 10)], 1000, 1000)
    const arc = ops.find((o): o is Extract<Op, { op: 'arc' }> => o.op === 'arc')
    expect(arc).toBeDefined()
    expect(arc?.args.slice(0, 3)).toEqual([500, 500, (10 * MASK_BRUSH_STROKE_FACTOR) / 2])
    expect(arc?.composite).toBe('destination-out')
    expect(ops.some((o) => o.op === 'stroke')).toBe(false)
  })

  it('skips empty paths without emitting draw ops', () => {
    const { ctx, ops } = recordingCtx()
    paintMaskPaths(ctx, [path('add', [])], 1000, 1000)
    expect(ops.filter((o) => o.op !== 'fillRect' && o.op !== 'scale')).toHaveLength(0)
  })
})

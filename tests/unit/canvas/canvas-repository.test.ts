import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  canvas: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { getLatestCanvasForUser, upsertCanvasForUser } from '@/lib/canvas/canvas-repository'

const baseInput = {
  nodes: [{ id: 'a', type: 'image' as const, x: 0, y: 0, data: { title: 'x' } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    title: '未命名画布',
    nodes: JSON.stringify(baseInput.nodes),
    edges: '[]',
    viewport: JSON.stringify(baseInput.viewport),
    updatedAt: new Date('2026-06-27T00:00:00Z'),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getLatestCanvasForUser', () => {
  it('returns the parsed latest canvas', async () => {
    prismaMock.canvas.findFirst.mockResolvedValue(row())
    const result = await getLatestCanvasForUser('u1')
    expect(prismaMock.canvas.findFirst).toHaveBeenCalledWith({ where: { userId: 'u1' }, orderBy: { updatedAt: 'desc' } })
    expect(result?.id).toBe('c1')
    expect(result?.nodes).toEqual(baseInput.nodes)
    expect(result?.viewport).toEqual(baseInput.viewport)
  })

  it('returns null when the user has no canvas', async () => {
    prismaMock.canvas.findFirst.mockResolvedValue(null)
    expect(await getLatestCanvasForUser('u1')).toBeNull()
  })
})

describe('upsertCanvasForUser', () => {
  it('creates a new row when no id is given', async () => {
    prismaMock.canvas.create.mockResolvedValue(row())
    const result = await upsertCanvasForUser('u1', baseInput)
    expect(prismaMock.canvas.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
    )
    expect(result.id).toBe('c1')
  })

  it('updates when the id belongs to the user', async () => {
    prismaMock.canvas.findFirst.mockResolvedValue({ id: 'c1' })
    prismaMock.canvas.update.mockResolvedValue(row({ title: 'renamed' }))
    const result = await upsertCanvasForUser('u1', { ...baseInput, id: 'c1', title: 'renamed' })
    expect(prismaMock.canvas.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u1' }, select: { id: true } })
    expect(prismaMock.canvas.update).toHaveBeenCalled()
    expect(result.title).toBe('renamed')
  })

  it('throws CANVAS_NOT_FOUND (no silent create) when id is not the user\'s', async () => {
    prismaMock.canvas.findFirst.mockResolvedValue(null)
    await expect(upsertCanvasForUser('u1', { ...baseInput, id: 'someone-elses' })).rejects.toThrow('CANVAS_NOT_FOUND')
    expect(prismaMock.canvas.update).not.toHaveBeenCalled()
    expect(prismaMock.canvas.create).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  canvas: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  extractCOSKey: (value: string | null | undefined) => {
    if (!value) return null
    const normalized = value.trim()
    if (/^https?:\/\//i.test(normalized)) {
      return decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '')
    }
    return normalized.replace(/^\/+/, '')
  },
  getSignedUrl: (key: string) => `/signed/${encodeURIComponent(key)}`,
}))

import { deleteCanvasResourceForUser, getLatestCanvasForUser, listCanvasResourcesForUser, upsertCanvasForUser } from '@/lib/canvas/canvas-repository'

const baseInput = {
  kind: 'canvas' as const,
  nodes: [{ id: 'a', type: 'image' as const, x: 0, y: 0, data: { title: 'x' } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}
const TASK_OUTPUT = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    title: '未命名画布',
    kind: 'canvas',
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
    expect(prismaMock.canvas.findFirst).toHaveBeenCalledWith({ where: { userId: 'u1', kind: 'canvas' }, orderBy: { updatedAt: 'desc' } })
    expect(result?.id).toBe('c1')
    expect(result?.nodes).toEqual(baseInput.nodes)
    expect(result?.viewport).toEqual(baseInput.viewport)
  })

  it('returns null when the user has no canvas', async () => {
    prismaMock.canvas.findFirst.mockResolvedValue(null)
    expect(await getLatestCanvasForUser('u1')).toBeNull()
  })
})

describe('listCanvasResourcesForUser', () => {
  it('returns canvases and workflows with parsed graph data', async () => {
    prismaMock.canvas.findMany.mockResolvedValue([row(), row({ id: 'w1', kind: 'workflow', title: '分镜工作流' })])
    const result = await listCanvasResourcesForUser('u1')
    expect(prismaMock.canvas.findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, orderBy: { updatedAt: 'desc' } })
    expect(result.map((item) => ({ id: item.id, kind: item.kind, title: item.title }))).toEqual([
      { id: 'c1', kind: 'canvas', title: '未命名画布' },
      { id: 'w1', kind: 'workflow', title: '分镜工作流' },
    ])
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

  it('[node data contains a deeply nested reserved VoiceLine output] -> [rejects before any canvas or media write]', async () => {
    const input = {
      ...baseInput,
      nodes: [{
        ...baseInput.nodes[0],
        data: { stage: { result: { audioUrl: TASK_OUTPUT } } },
      }],
    }

    await expect(upsertCanvasForUser('u1', input)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' },
    })
    expect(prismaMock.canvas.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.canvas.create).not.toHaveBeenCalled()
    expect(prismaMock.canvas.update).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[node data contains null, ordinary values, and a missing /m alias] -> [creates the canvas unchanged]', async () => {
    const input = {
      ...baseInput,
      nodes: [{
        ...baseInput.nodes[0],
        data: { audioUrl: null, title: 'ordinary', unavailable: '/m/missing-audio' },
      }],
    }
    prismaMock.mediaObject.findUnique.mockResolvedValue(null)
    prismaMock.canvas.create.mockResolvedValue(row({ nodes: JSON.stringify(input.nodes) }))

    const result = await upsertCanvasForUser('u1', input)

    expect(prismaMock.canvas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        nodes: JSON.stringify(input.nodes),
      }),
    })
    expect(result.nodes).toEqual(input.nodes)
  })
})

describe('deleteCanvasResourceForUser', () => {
  it('owned id -> deletes exactly that resource', async () => {
    prismaMock.canvas.deleteMany.mockResolvedValue({ count: 1 })
    await deleteCanvasResourceForUser('u1', 'c1')
    expect(prismaMock.canvas.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u1' } })
  })

  it('foreign or missing id -> fails explicitly', async () => {
    prismaMock.canvas.deleteMany.mockResolvedValue({ count: 0 })
    await expect(deleteCanvasResourceForUser('u1', 'foreign')).rejects.toThrow('CANVAS_NOT_FOUND')
  })
})

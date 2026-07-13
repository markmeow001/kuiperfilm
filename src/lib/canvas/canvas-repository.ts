/**
 * Canvas data access (repository pattern). Single place that maps the Canvas
 * Prisma row (JSON-as-Text columns) to/from the SerializedCanvas client shape.
 *
 * M1.5: one autosaved canvas per user (the "default" canvas). getLatest returns
 * the most-recently-updated; upsert creates on first save then updates by id.
 * Ownership is always enforced by the caller passing userId — never trust an
 * id alone.
 */
import { prisma } from '@/lib/prisma'
import type { CanvasSaveInput } from './canvas-validation'

export interface CanvasRecord {
  id: string
  title: string
  kind: 'canvas' | 'workflow'
  nodes: unknown
  edges: unknown
  viewport: unknown
  updatedAt: string
}

function safeParse(value: string | null, fallback: unknown): unknown {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function toRecord(row: {
  id: string
  title: string
  kind: string
  nodes: string
  edges: string
  viewport: string | null
  updatedAt: Date
}): CanvasRecord {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind === 'workflow' ? 'workflow' : 'canvas',
    nodes: safeParse(row.nodes, []),
    edges: safeParse(row.edges, []),
    viewport: safeParse(row.viewport, { x: 0, y: 0, zoom: 1 }),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The user's most-recently-updated canvas, or null if they have none. */
export async function getLatestCanvasForUser(userId: string): Promise<CanvasRecord | null> {
  const row = await prisma.canvas.findFirst({
    where: { userId, kind: 'canvas' },
    orderBy: { updatedAt: 'desc' },
  })
  return row ? toRecord(row) : null
}

/** All user-owned canvases and workflow templates, newest first. */
export async function listCanvasResourcesForUser(userId: string): Promise<CanvasRecord[]> {
  const rows = await prisma.canvas.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map(toRecord)
}

/**
 * Create (no id) or update (id, ownership-checked) a canvas. Returns the saved
 * record. Throws 'CANVAS_NOT_FOUND' if an id is given but doesn't belong to the
 * user — never silently creates a new row on an ownership miss (避免静默回退).
 */
export async function upsertCanvasForUser(
  userId: string,
  input: CanvasSaveInput,
): Promise<CanvasRecord> {
  const data = {
    title: input.title ?? '未命名画布',
    kind: input.kind,
    nodes: JSON.stringify(input.nodes),
    edges: JSON.stringify(input.edges),
    viewport: JSON.stringify(input.viewport),
  }

  if (input.id) {
    const existing = await prisma.canvas.findFirst({
      where: { id: input.id, userId },
      select: { id: true },
    })
    if (!existing) {
      throw new Error('CANVAS_NOT_FOUND')
    }
    const row = await prisma.canvas.update({ where: { id: input.id }, data })
    return toRecord(row)
  }

  const row = await prisma.canvas.create({ data: { ...data, userId } })
  return toRecord(row)
}


/** Delete exactly one owned canvas/workflow. Missing or foreign ids fail explicitly. */
export async function deleteCanvasResourceForUser(userId: string, id: string): Promise<void> {
  const result = await prisma.canvas.deleteMany({ where: { id, userId } })
  if (result.count !== 1) throw new Error('CANVAS_NOT_FOUND')
}

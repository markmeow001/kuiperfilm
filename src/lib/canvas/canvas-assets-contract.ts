import { z } from 'zod'

export const CANVAS_ASSET_TYPES = ['character', 'scene', 'image', 'video'] as const
export type CanvasAssetType = (typeof CANVAS_ASSET_TYPES)[number]

export const canvasAssetSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task'), taskId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('storage-key'), storageKey: z.string().trim().min(1).max(512) }).strict(),
])

export const canvasAssetCreateSchema = z.object({
  canvasId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(CANVAS_ASSET_TYPES),
  folder: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2_000).optional(),
  source: canvasAssetSourceSchema,
  firstFrameKey: z.string().trim().min(1).max(512).optional(),
  lastFrameKey: z.string().trim().min(1).max(512).optional(),
}).strict()

export type CanvasAssetCreateInput = z.infer<typeof canvasAssetCreateSchema>

export function isAssetMimeCompatible(type: CanvasAssetType, mimeType: string | null): boolean {
  return type === 'video' ? Boolean(mimeType?.startsWith('video/')) : Boolean(mimeType?.startsWith('image/'))
}

export function readTaskResultStorageKey(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const record = result as Record<string, unknown>
  if (typeof record.resultKey === 'string' && record.resultKey.trim()) return record.resultKey.trim()
  if (!Array.isArray(record.resultUrls)) return null
  return record.resultUrls.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null
}

export function readTaskWorkspaceId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>).workspaceId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

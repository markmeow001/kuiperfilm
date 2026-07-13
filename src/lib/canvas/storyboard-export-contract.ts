import { z } from 'zod'

export const STORYBOARD_EXPORT_LIMITS = {
  maxItems: 25,
  timeoutMs: 90_000,
  defaultMaxRssBytes: 1536 * 1024 * 1024,
  width: 3840,
  height: 2160,
} as const

export const storyboardExportRequestSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(STORYBOARD_EXPORT_LIMITS.maxItems),
  titles: z.array(z.string().max(120)).min(1).max(STORYBOARD_EXPORT_LIMITS.maxItems),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(4),
  showShotNumber: z.boolean().default(true),
}).refine((value) => value.taskIds.length === value.titles.length, { message: 'taskIds and titles length mismatch' })

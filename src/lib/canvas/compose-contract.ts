import { z } from 'zod'

export const CANVAS_COMPOSE_LIMITS = {
  maxClips: 10,
  maxDurationSec: 180,
  width: 1280,
  height: 720,
  fps: 30,
  threads: 2,
  maxInputBytes: 2 * 1024 * 1024 * 1024,
  maxOutputBytes: 512 * 1024 * 1024,
} as const

export const canvasComposeRequestSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(CANVAS_COMPOSE_LIMITS.maxClips),
  transition: z.enum(['cut', 'crossfade']).default('cut'),
  crossfadeSec: z.number().min(0.1).max(2).default(0.5),
})

export type CanvasComposeRequest = z.infer<typeof canvasComposeRequestSchema>

export interface CanvasComposeExecutorInput {
  userId: string
  taskId: string
  sourceKeys: string[]
  transition: 'cut' | 'crossfade'
  crossfadeSec: number
}

export interface CanvasComposeExecutorResult {
  resultKey: string
  durationSec: number
}

export interface CanvasComposeExecutor {
  execute(input: CanvasComposeExecutorInput): Promise<CanvasComposeExecutorResult>
}

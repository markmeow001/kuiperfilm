import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { canvasComposeExecutor } from '@/lib/canvas/ffmpeg-compose-executor'
import { CANVAS_COMPOSE_LIMITS } from '@/lib/canvas/compose-contract'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive } from '../utils'

const LOCK_KEY = 'canvas:compose:global-lock'
const LOCK_TTL_MS = 20 * 60 * 1000

function resultKeys(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const values = (result as { resultUrls?: unknown }).resultUrls
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && Boolean(value)) : []
}

function audioKey(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const value = (result as { audioKey?: unknown }).audioKey
  return typeof value === 'string' && value ? value : null
}

async function releaseLock(token: string) {
  await queueRedis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK_KEY, token)
}

export async function handleCanvasComposeVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((value): value is string => typeof value === 'string') : []
  const transition = payload.transition === 'crossfade' ? 'crossfade' : 'cut'
  const crossfadeSec = typeof payload.crossfadeSec === 'number' ? payload.crossfadeSec : 0.5
  const voiceTaskId = typeof payload.voiceTaskId === 'string' ? payload.voiceTaskId : null
  const musicTaskId = typeof payload.musicTaskId === 'string' ? payload.musicTaskId : null
  if (taskIds.length < 1 || taskIds.length > CANVAS_COMPOSE_LIMITS.maxClips) throw new Error('CANVAS_COMPOSE_CLIP_COUNT_INVALID')

  const allTaskIds = [...taskIds, ...(voiceTaskId ? [voiceTaskId] : []), ...(musicTaskId ? [musicTaskId] : [])]
  const sourceTasks = await prisma.task.findMany({ where: { id: { in: allTaskIds }, userId: job.data.userId } })
  const byId = new Map(sourceTasks.map((task) => [task.id, task]))
  const sourceKeys = taskIds.map((id) => {
    const task = byId.get(id)
    if (!task || task.status !== 'completed') throw new Error(`CANVAS_COMPOSE_SOURCE_NOT_READY:${id}`)
    const keys = resultKeys(task.result)
    if (keys.length === 0) throw new Error(`CANVAS_COMPOSE_SOURCE_MISSING:${id}`)
    const key = keys[0]
    if (!key.startsWith(`video/playground-ref/${job.data.userId}/`)) throw new Error(`CANVAS_COMPOSE_SOURCE_NOT_OWNED:${id}`)
    return key
  })
  const resolveAudioKey = (id: string | null, role: 'voice' | 'music') => {
    if (!id) return undefined
    const task = byId.get(id)
    const key = task?.status === 'completed' ? audioKey(task.result) : null
    if (!key || !key.startsWith(`voice/playground-ref/${job.data.userId}/`)) throw new Error(`CANVAS_COMPOSE_${role.toUpperCase()}_NOT_READY`)
    return key
  }
  const voiceKey = resolveAudioKey(voiceTaskId, 'voice')
  const musicKey = resolveAudioKey(musicTaskId, 'music')

  const lockToken = `${job.id}:${crypto.randomUUID()}`
  const acquired = await queueRedis.set(LOCK_KEY, lockToken, 'PX', LOCK_TTL_MS, 'NX')
  if (acquired !== 'OK') {
    const error = new Error('CANVAS_COMPOSE_BUSY') as Error & { code?: string }
    error.code = 'RATE_LIMIT'
    throw error
  }
  try {
    await reportTaskProgress(job, 10, { stage: 'canvas_compose_prepare' })
    await assertTaskActive(job, 'canvas_compose_prepare')
    const result = await canvasComposeExecutor.execute({
      userId: job.data.userId,
      taskId: job.data.taskId,
      sourceKeys,
      transition,
      crossfadeSec,
      ...(voiceKey ? { voiceKey } : {}),
      ...(musicKey ? { musicKey } : {}),
      voiceVolume: typeof payload.voiceVolume === 'number' ? payload.voiceVolume : 1,
      musicVolume: typeof payload.musicVolume === 'number' ? payload.musicVolume : 0.25,
      preserveOriginalAudio: payload.preserveOriginalAudio !== false,
    })
    await reportTaskProgress(job, 95, { stage: 'canvas_compose_done' })
    return { success: true, resultUrls: [result.resultKey], resultKey: result.resultKey, durationSec: result.durationSec }
  } finally {
    await releaseLock(lockToken)
  }
}

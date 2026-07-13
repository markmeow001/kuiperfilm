import { queueRedis } from '@/lib/redis'

const LOCK_KEY = 'canvas:heavy-render:global-lock'
const LOCK_TTL_MS = 20 * 60 * 1000

export async function acquireCanvasHeavyRenderLock(owner: string): Promise<() => Promise<void>> {
  const token = `${owner}:${crypto.randomUUID()}`
  const acquired = await queueRedis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX')
  if (acquired !== 'OK') {
    const error = new Error('CANVAS_HEAVY_RENDER_BUSY') as Error & { code?: string }
    error.code = 'RATE_LIMIT'
    throw error
  }
  return async () => {
    await queueRedis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK_KEY, token)
  }
}

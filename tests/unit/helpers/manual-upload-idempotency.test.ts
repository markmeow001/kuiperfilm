import { describe, expect, it } from 'vitest'
import {
  deriveManualUploadIds,
  normalizeManualUploadIdempotencyKey,
} from '@/lib/novel-promotion/manual-upload-idempotency'

const REQUEST_ID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('manual upload idempotency identity', () => {
  it('同 request UUID + kind -> 穩定且彼此分離的 deterministic UUIDs', () => {
    const key = normalizeManualUploadIdempotencyKey(REQUEST_ID)
    expect(key).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')

    const first = deriveManualUploadIds('character', 'project-1', key!)
    const replay = deriveManualUploadIds('character', 'project-1', key!)
    const location = deriveManualUploadIds('location', 'project-1', key!)
    const otherProject = deriveManualUploadIds('character', 'project-2', key!)

    expect(replay).toEqual(first)
    expect(new Set(Object.values(first)).size).toBe(3)
    for (const id of Object.values(first)) expect(id).toMatch(UUID_PATTERN)
    expect(location.entityId).not.toBe(first.entityId)
    expect(otherProject.entityId).not.toBe(first.entityId)
  })

  it('缺 key 維持 legacy create；非 UUID key 明確拒絕', () => {
    expect(normalizeManualUploadIdempotencyKey(undefined)).toBeNull()
    expect(() => normalizeManualUploadIdempotencyKey('predictable-key')).toThrow(
      'INVALID_MANUAL_UPLOAD_IDEMPOTENCY_KEY',
    )
  })
})

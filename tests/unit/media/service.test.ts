import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// P1-6: media/service ownerContext behavior (Q-005 ownership tracking).
//
// ensureMediaObjectFromStorageKey accepts an optional MediaObjectOwnerContext.
// Contract:
//   1. Caller passes ownerContext.uploadedByUserId   → new row writes that userId
//   2. Caller omits ownerContext                      → new row writes null (legacy)
//   3. Existing row already has uploadedByUserId      → never overwrite (preserve owner)
//   4. Existing row uploadedByUserId is null + owner  → backfill (lazy fill)
// ============================================================================

type MediaModelMock = {
  findUnique: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

const prismaMock = vi.hoisted(() => ({
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  } satisfies MediaModelMock,
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

// extractCOSKey is also imported by the module under test but not exercised in
// these tests (we drive it via storageKey directly via ensureMediaObjectFromStorageKey).
// Stub minimal implementation so import doesn't fail.
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

// ===== Real import (after mocks) =====
import {
  classifyVoiceLineTaskOutputReference,
  ensureMediaObjectFromStorageKey,
  resolveMediaRefFromLegacyValue,
  resolveVoiceLineMediaRef,
} from '@/lib/media/service'

const STORAGE_KEY = 'cos/test/foo.png'
// stable publicId is m_ + sha256(storageKey).slice(0,40); precomputed via lib's hash:
//   crypto.createHash('sha256').update('cos/test/foo.png').digest('hex')
//     -> 7b3d9... (we don't pin the exact value; we read what upsert was called with)
function buildExistingRow(overrides: Partial<{
  id: string
  publicId: string
  storageKey: string
  uploadedByUserId: string | null
}> = {}) {
  return {
    id: 'mo-1',
    publicId: 'pub-1',
    storageKey: STORAGE_KEY,
    sha256: null,
    mimeType: 'image/png',
    sizeBytes: null,
    width: null,
    height: null,
    durationMs: null,
    updatedAt: new Date('2026-04-28T00:00:00Z'),
    uploadedByUserId: null as string | null,
    ...overrides,
  }
}

describe('media/service ensureMediaObjectFromStorageKey ownerContext behavior', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prismaMock.mediaObject.findUnique.mockResolvedValue(null)
    prismaMock.mediaObject.upsert.mockResolvedValue(buildExistingRow())
    prismaMock.mediaObject.update.mockResolvedValue(buildExistingRow())
  })

  it('new row + ownerContext -> upsert.create writes uploadedByUserId from ownerContext', async () => {
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(null) // no existing row
    prismaMock.mediaObject.upsert.mockResolvedValueOnce(
      buildExistingRow({ uploadedByUserId: 'user-1' }),
    )

    await ensureMediaObjectFromStorageKey(STORAGE_KEY, undefined, { uploadedByUserId: 'user-1' })

    const upsertArg = prismaMock.mediaObject.upsert.mock.calls.at(-1)?.[0] as {
      create: { uploadedByUserId: string | null }
      update: Record<string, unknown>
    }
    expect(upsertArg.create.uploadedByUserId).toBe('user-1')
    // update branch (called when publicId already exists due to race) should also
    // set uploadedByUserId on lazy fill
    expect(upsertArg.update).toMatchObject({ uploadedByUserId: 'user-1' })
  })

  it('[task-scoped VoiceLine output + owner write context] -> [rejects before any MediaObject read/write]', async () => {
    const taskOutput = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

    await expect(
      ensureMediaObjectFromStorageKey(taskOutput, undefined, { uploadedByUserId: 'user-1' }),
    ).rejects.toThrow('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')

    expect(prismaMock.mediaObject.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[task-scoped VoiceLine output + read without owner] -> [never creates a MediaObject]', async () => {
    const taskOutput = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

    await expect(resolveMediaRefFromLegacyValue(taskOutput)).rejects.toThrow(
      'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN',
    )

    expect(prismaMock.mediaObject.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[VoiceLine serializer + raw task output] -> [returns an ephemeral signed ref without MediaObject mutation]', async () => {
    const taskOutput = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

    const ref = await resolveVoiceLineMediaRef(null, taskOutput)

    expect(ref).toMatchObject({
      storageKey: taskOutput,
      url: `/signed/${encodeURIComponent(taskOutput)}`,
    })
    expect(prismaMock.mediaObject.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[historical VoiceLine MediaObject relation + task output] -> [serializes virtually without mutation]', async () => {
    const taskOutput = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(buildExistingRow({
      id: 'historical-task-media',
      publicId: 'historical-public',
      storageKey: taskOutput,
    }))

    const ref = await resolveVoiceLineMediaRef('historical-task-media', null)

    expect(ref?.storageKey).toBe(taskOutput)
    expect(ref?.id).toMatch(/^voice-line-output:/)
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it.each([
    ['trimmed raw key', `  voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav  `],
    ['uppercase URL scheme', `HTTPS://cos.example/voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`],
  ])('[canonical reference: %s] -> [reserved]', async (_label, value) => {
    await expect(classifyVoiceLineTaskOutputReference(value)).resolves.toBe('reserved')
  })

  it.each([
    ['absolute media route', 'https://app.example/m/missing'],
    ['protocol-relative media route', '//app.example/m/missing'],
  ])('[unresolved canonical alias: %s] -> [fails closed]', async (_label, value) => {
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(null)
    await expect(classifyVoiceLineTaskOutputReference(value)).resolves.toBe(
      'unresolved_media_alias',
    )
  })

  it('[task-scoped VoiceLine output /m alias + owner write context] -> [resolves alias then rejects without media mutation]', async () => {
    const taskOutput = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(buildExistingRow({
      publicId: 'generated-audio',
      storageKey: taskOutput,
    }))

    await expect(
      resolveMediaRefFromLegacyValue('/m/generated-audio', { uploadedByUserId: 'user-1' }),
    ).rejects.toThrow('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')

    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[unknown /m alias + owner write context] -> [fails closed instead of persisting an unresolved raw alias]', async () => {
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(null)

    await expect(
      resolveMediaRefFromLegacyValue('/m/missing', { uploadedByUserId: 'user-1' }),
    ).rejects.toThrow('MEDIA_WRITE_REFERENCE_INVALID')

    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('new row WITHOUT ownerContext -> upsert.create writes uploadedByUserId = null (legacy)', async () => {
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(null)
    prismaMock.mediaObject.upsert.mockResolvedValueOnce(
      buildExistingRow({ uploadedByUserId: null }),
    )

    await ensureMediaObjectFromStorageKey(STORAGE_KEY)

    const upsertArg = prismaMock.mediaObject.upsert.mock.calls.at(-1)?.[0] as {
      create: { uploadedByUserId: string | null }
      update: Record<string, unknown>
    }
    expect(upsertArg.create.uploadedByUserId).toBeNull()
    // update branch must NOT inject uploadedByUserId when no owner context
    expect(upsertArg.update).not.toHaveProperty('uploadedByUserId')
  })

  it('existing row already owned (non-null) + caller passes different userId -> mediaObject.update NOT called (no overwrite)', async () => {
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(
      buildExistingRow({ uploadedByUserId: 'original-owner' }),
    )

    const ref = await ensureMediaObjectFromStorageKey(
      STORAGE_KEY,
      undefined,
      { uploadedByUserId: 'foreign-user' },
    )

    // No backfill — existing owner preserved.
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
    // Returned ref should reflect the original storageKey from the existing row.
    expect(ref.storageKey).toBe(STORAGE_KEY)
  })

  it('existing row uploadedByUserId is NULL + caller passes ownerContext -> mediaObject.update called with backfill (lazy fill)', async () => {
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(
      buildExistingRow({ uploadedByUserId: null }),
    )
    prismaMock.mediaObject.update.mockResolvedValueOnce(
      buildExistingRow({ uploadedByUserId: 'lazy-fill-user' }),
    )

    await ensureMediaObjectFromStorageKey(
      STORAGE_KEY,
      undefined,
      { uploadedByUserId: 'lazy-fill-user' },
    )

    expect(prismaMock.mediaObject.update).toHaveBeenCalledTimes(1)
    const updateArg = prismaMock.mediaObject.update.mock.calls.at(-1)?.[0] as {
      where: { id: string }
      data: { uploadedByUserId: string }
    }
    expect(updateArg.where).toEqual({ id: 'mo-1' })
    expect(updateArg.data.uploadedByUserId).toBe('lazy-fill-user')
  })

  it('existing row uploadedByUserId is NULL + caller does NOT pass ownerContext -> no backfill (update NOT called)', async () => {
    prismaMock.mediaObject.findUnique.mockResolvedValueOnce(
      buildExistingRow({ uploadedByUserId: null }),
    )

    await ensureMediaObjectFromStorageKey(STORAGE_KEY)

    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
    // upsert also not called — existing row hit short-circuits write path
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mediaObject: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/service', () => ({
  classifyVoiceLineTaskOutputReference: vi.fn(async () => 'other' as const),
}))

import { assertMediaObjectIdsDoNotReferenceVoiceLineTaskOutputs } from '@/lib/media/write-policy'

const TASK_OUTPUT = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

describe('MediaObject relation write policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.mediaObject.findMany.mockResolvedValue([])
  })

  it('[relation points at VoiceLine task output] -> [rejects]', async () => {
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([{ storageKey: TASK_OUTPUT }])

    await expect(
      assertMediaObjectIdsDoNotReferenceVoiceLineTaskOutputs(['media-task-output']),
    ).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' },
    })
  })

  it('[ordinary, empty, and duplicate ids] -> [queries normalized ids and allows]', async () => {
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([{ storageKey: 'images/owned.png' }])

    await expect(assertMediaObjectIdsDoNotReferenceVoiceLineTaskOutputs([
      null,
      '',
      ' media-a ',
      'media-a',
    ])).resolves.toBeUndefined()
    expect(prismaMock.mediaObject.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['media-a'] } },
      select: { storageKey: true },
    })
  })
})

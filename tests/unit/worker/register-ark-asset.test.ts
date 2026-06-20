/**
 * Unit tests for the register_ark_asset worker handler.
 *
 * Fills the tests/contracts/task-type-catalog gap: REGISTER_ARK_ASSET had a
 * handler (register-ark-asset.ts) but no test file. The handler walks the
 * Volcengine 3-step pipeline (CreateAssetGroup → CreateAsset → poll GetAsset)
 * and writes status transitions back onto the subject row
 * (pending → processing → active|failed). These tests pin the defensive
 * branches + the happy/failed terminal writes, mocking every external edge
 * (prisma, ark-asset-api, credentials, COS signing) per agent/testing.md §3.
 */
import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> }
const prismaMock = vi.hoisted(() => {
  const update = () => vi.fn(async (_args: UpdateArgs) => ({}))
  return {
    characterAppearance: { findUnique: vi.fn(), update: update() },
    locationImage: { findUnique: vi.fn(), update: update() },
    novelPromotionProp: { findUnique: vi.fn(), update: update() },
  }
})

const apiConfigMock = vi.hoisted(() => ({
  getArkAssetCredentials: vi.fn(),
  setArkAssetGroupId: vi.fn(async () => undefined),
}))

const arkApiMock = vi.hoisted(() => ({
  arkCreateAssetGroup: vi.fn(),
  arkCreateAsset: vi.fn(),
  arkGetAsset: vi.fn(),
}))

const utilsMock = vi.hoisted(() => ({
  toSignedUrlIfCos: vi.fn((url: string): string | null => url),
  assertTaskActive: vi.fn(async () => undefined),
}))

// Real class so the handler's `error instanceof ArkAssetApiError` checks work.
// Defined via vi.hoisted so the hoisted vi.mock factory below can reference it.
const errorMock = vi.hoisted(() => {
  class MockArkAssetApiError extends Error {
    code: string
    httpStatus: number
    constructor(code: string, message: string, httpStatus = 400) {
      super(message)
      this.code = code
      this.httpStatus = httpStatus
    }
  }
  return { MockArkAssetApiError }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/ark-asset-api', () => ({
  arkCreateAssetGroup: arkApiMock.arkCreateAssetGroup,
  arkCreateAsset: arkApiMock.arkCreateAsset,
  arkGetAsset: arkApiMock.arkGetAsset,
  ArkAssetApiError: errorMock.MockArkAssetApiError,
}))
vi.mock('@/lib/workers/utils', () => ({
  toSignedUrlIfCos: utilsMock.toSignedUrlIfCos,
  assertTaskActive: utilsMock.assertTaskActive,
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { handleRegisterArkAssetTask } from '@/lib/workers/handlers/register-ark-asset'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-ark-1',
      type: TASK_TYPE.REGISTER_ARK_ASSET,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: payload.targetType,
      targetId: payload.targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

const CREDS = {
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  assetGroupId: 'group-existing',
  ownerUserId: 'user-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  utilsMock.toSignedUrlIfCos.mockImplementation((url: string) => url)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('register-ark-asset — input validation (throws before any I/O)', () => {
  it('rejects an unknown targetType', async () => {
    await expect(handleRegisterArkAssetTask(buildJob({ targetType: 'Bogus', targetId: 'x' })))
      .rejects.toThrow(/ARK_REGISTER_BAD_TARGET_TYPE/)
  })

  it('rejects a missing targetId', async () => {
    await expect(handleRegisterArkAssetTask(buildJob({ targetType: 'CharacterAppearance', targetId: '' })))
      .rejects.toThrow(/ARK_REGISTER_MISSING_TARGET_ID/)
  })
})

describe('register-ark-asset — subject resolution', () => {
  it('throws SUBJECT_NOT_FOUND when the row is gone', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue(null)
    await expect(handleRegisterArkAssetTask(buildJob({ targetType: 'CharacterAppearance', targetId: 'app-1' })))
      .rejects.toThrow(/ARK_REGISTER_SUBJECT_NOT_FOUND/)
  })

  it('throws NO_IMAGE when the subject has no imageUrl', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: null,
      character: { name: 'Vera' },
      appearanceIndex: 0,
    })
    await expect(handleRegisterArkAssetTask(buildJob({ targetType: 'CharacterAppearance', targetId: 'app-1' })))
      .rejects.toThrow(/ARK_REGISTER_NO_IMAGE/)
  })
})

describe('register-ark-asset — pre-submit failures write failed status onto the subject', () => {
  it('marks the subject failed when the resolved URL is not public (http)', async () => {
    prismaMock.novelPromotionProp.findUnique.mockResolvedValue({ imageUrl: 'file:///tmp/local.png', name: '匕首' })
    // COS signer can't turn a local path into an https URL → null → falls back to raw.
    utilsMock.toSignedUrlIfCos.mockReturnValue(null)

    await expect(handleRegisterArkAssetTask(buildJob({ targetType: 'NovelPromotionProp', targetId: 'prop-1' })))
      .rejects.toThrow(/ARK_REGISTER_URL_NOT_PUBLIC/)

    const update = prismaMock.novelPromotionProp.update.mock.calls.at(-1)?.[0]
    expect(update?.where).toEqual({ id: 'prop-1' })
    expect(update?.data.arkAssetStatus).toBe('failed')
    expect(String(update?.data.arkAssetError)).toMatch(/ARK_REGISTER_URL_NOT_PUBLIC/)
  })

  it('marks the subject failed when the user has no ARK credentials', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: 'https://cos.example/vera.png',
      character: { name: 'Vera' },
      appearanceIndex: 1,
    })
    apiConfigMock.getArkAssetCredentials.mockResolvedValue(null)

    await expect(handleRegisterArkAssetTask(buildJob({ targetType: 'CharacterAppearance', targetId: 'app-1' })))
      .rejects.toThrow(/ARK_REGISTER_NO_CREDENTIALS/)

    const update = prismaMock.characterAppearance.update.mock.calls.at(-1)?.[0]
    expect(update?.data.arkAssetStatus).toBe('failed')
    expect(String(update?.data.arkAssetError)).toContain('火山')
  })
})

describe('register-ark-asset — full pipeline (poll loop with fake timers)', () => {
  it('promotes the subject to active when GetAsset returns Active', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: 'https://cos.example/vera.png',
      character: { name: 'Vera' },
      appearanceIndex: 2,
    })
    apiConfigMock.getArkAssetCredentials.mockResolvedValue(CREDS)
    arkApiMock.arkCreateAsset.mockResolvedValue({ Id: 'asset-active-1' })
    arkApiMock.arkGetAsset.mockResolvedValue({ Status: 'Active', URL: 'https://ark.example/asset-active-1.png' })

    vi.useFakeTimers()
    const p = handleRegisterArkAssetTask(buildJob({ targetType: 'CharacterAppearance', targetId: 'app-1' }))
    // Flush the pre-poll awaits + fire the 5s poll-interval timer.
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await p

    // Existing group reused — lazy CreateAssetGroup must NOT fire.
    expect(arkApiMock.arkCreateAssetGroup).not.toHaveBeenCalled()
    expect(arkApiMock.arkCreateAsset).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('active')
    expect(result.arkAssetId).toBe('asset-active-1')
    expect(result.arkAssetUrl).toBe('https://ark.example/asset-active-1.png')

    // Subject row ends 'active' with the registered timestamp + cleared error.
    const finalUpdate = prismaMock.characterAppearance.update.mock.calls.at(-1)?.[0]
    expect(finalUpdate?.data.arkAssetStatus).toBe('active')
    expect(finalUpdate?.data.arkAssetError).toBeNull()
    expect(finalUpdate?.data.arkAssetRegisteredAt).toBeInstanceOf(Date)
  })

  it('marks the subject failed (with Volcengine error code) when GetAsset returns Failed', async () => {
    prismaMock.locationImage.findUnique.mockResolvedValue({
      imageUrl: 'https://cos.example/room.png',
      viewName: '正面',
      imageIndex: 0,
      location: { name: '客廳' },
    })
    apiConfigMock.getArkAssetCredentials.mockResolvedValue(CREDS)
    arkApiMock.arkCreateAsset.mockResolvedValue({ Id: 'asset-fail-1' })
    arkApiMock.arkGetAsset.mockResolvedValue({
      Status: 'Failed',
      Error: { Code: 'FaceDetected', Message: 'real person face' },
    })

    vi.useFakeTimers()
    const p = handleRegisterArkAssetTask(buildJob({ targetType: 'LocationImage', targetId: 'loc-1' }))
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await p

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('FaceDetected')

    const finalUpdate = prismaMock.locationImage.update.mock.calls.at(-1)?.[0]
    expect(finalUpdate?.data.arkAssetStatus).toBe('failed')
    expect(String(finalUpdate?.data.arkAssetError)).toContain('FaceDetected')
  })
})

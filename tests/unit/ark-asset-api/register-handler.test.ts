/**
 * register-ark-asset worker handler tests.
 *
 * Mocks the wire layer (ark-asset-api) + DB (prisma) + auxiliary
 * helpers (toSignedUrlIfCos, getArkAssetCredentials, setArkAssetGroupId,
 * assertTaskActive, reportTaskProgress). Asserts the state machine
 * progresses correctly through the 3 official steps + poll loop, and
 * that DB writes happen with the right column patches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'

const arkCreateAssetGroupMock = vi.hoisted(() => vi.fn())
const arkCreateAssetMock = vi.hoisted(() => vi.fn())
const arkGetAssetMock = vi.hoisted(() => vi.fn())
const getArkAssetCredentialsMock = vi.hoisted(() => vi.fn())
const setArkAssetGroupIdMock = vi.hoisted(() => vi.fn())
const toSignedUrlIfCosMock = vi.hoisted(() => vi.fn((input: string | null | undefined) => {
  if (!input) return null
  if (input.startsWith('images/') || input.startsWith('video/') || input.startsWith('voice/')) {
    return `https://r2.example.com/${input}?sig=fake`
  }
  return input
}))

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => {}))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => {}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  locationImage: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionProp: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/ark-asset-api', async () => {
  const real = await vi.importActual<typeof import('@/lib/ark-asset-api')>('@/lib/ark-asset-api')
  return {
    ...real,
    arkCreateAssetGroup: arkCreateAssetGroupMock,
    arkCreateAsset: arkCreateAssetMock,
    arkGetAsset: arkGetAssetMock,
  }
})

vi.mock('@/lib/api-config', () => ({
  getArkAssetCredentials: getArkAssetCredentialsMock,
  setArkAssetGroupId: setArkAssetGroupIdMock,
}))

vi.mock('@/lib/workers/utils', () => ({
  toSignedUrlIfCos: toSignedUrlIfCosMock,
  assertTaskActive: assertTaskActiveMock,
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { handleRegisterArkAssetTask } from '@/lib/workers/handlers/register-ark-asset'

function makeJob(overrides: Partial<TaskJobData> = {}): Job<TaskJobData> {
  return {
    id: 'job-1',
    data: {
      taskId: 'task-1',
      type: 'register_ark_asset' as TaskJobData['type'],
      locale: 'zh-TW' as TaskJobData['locale'],
      projectId: 'proj-1',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      userId: 'user-1',
      payload: {
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
      },
      ...overrides,
    },
  } as Job<TaskJobData>
}

describe('handleRegisterArkAssetTask — happy path (CharacterAppearance, Active first poll)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: 'images/character/abc.png',
      character: { name: '长官' },
      appearanceIndex: 0,
    })
    prismaMock.characterAppearance.update.mockResolvedValue({})

    getArkAssetCredentialsMock.mockResolvedValue({
      accessKeyId: 'AKLTtest',
      secretAccessKey: 'secret123',
      assetGroupId: 'group-existing-123',
      ownerUserId: 'user-1',
    })

    arkCreateAssetMock.mockResolvedValue({ Id: 'Asset-20260523-abc12' })
    arkGetAssetMock.mockResolvedValue({
      Id: 'Asset-20260523-abc12',
      Name: '长官#0',
      URL: 'https://volcengine.cdn/signed-12hr',
      AssetType: 'Image',
      GroupId: 'group-existing-123',
      Status: 'Active',
      Error: { Code: '', Message: '' },
      CreateTime: '2026-05-23T05:51:14Z',
      UpdateTime: '2026-05-23T05:53:00Z',
      ProjectName: 'default',
    })
  })

  it('reuses existing assetGroupId (no CreateAssetGroup call)', async () => {
    const job = makeJob()
    const promise = handleRegisterArkAssetTask(job)
    await vi.advanceTimersByTimeAsync(6_000)
    const result = await promise

    expect(arkCreateAssetGroupMock).not.toHaveBeenCalled()
    expect(setArkAssetGroupIdMock).not.toHaveBeenCalled()
    expect(result.status).toBe('active')
    expect(result.arkAssetId).toBe('Asset-20260523-abc12')
  })

  it('writes intermediate processing status before polling', async () => {
    const job = makeJob()
    const promise = handleRegisterArkAssetTask(job)
    await vi.advanceTimersByTimeAsync(6_000)
    await promise

    // First update: arkAssetStatus='processing' + arkAssetId + arkAssetSourceUrl
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          arkAssetId: 'Asset-20260523-abc12',
          arkAssetStatus: 'processing',
          arkAssetSourceUrl: 'images/character/abc.png',
        }),
      }),
    )
    // Final update: arkAssetStatus='active' + arkAssetRegisteredAt
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          arkAssetStatus: 'active',
          arkAssetRegisteredAt: expect.any(Date),
        }),
      }),
    )
  })

  it('signs cos key into https URL before submitting CreateAsset', async () => {
    const job = makeJob()
    const promise = handleRegisterArkAssetTask(job)
    await vi.advanceTimersByTimeAsync(6_000)
    await promise

    expect(arkCreateAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        URL: 'https://r2.example.com/images/character/abc.png?sig=fake',
        GroupId: 'group-existing-123',
        AssetType: 'Image',
      }),
      expect.objectContaining({ accessKeyId: 'AKLTtest' }),
    )
  })
})

describe('handleRegisterArkAssetTask — lazy CreateAssetGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: 'images/character/abc.png',
      character: { name: '长官' },
      appearanceIndex: 0,
    })
    prismaMock.characterAppearance.update.mockResolvedValue({})

    // No existing group — user's first registration.
    getArkAssetCredentialsMock.mockResolvedValue({
      accessKeyId: 'AKLTtest',
      secretAccessKey: 'secret123',
      assetGroupId: null,
      ownerUserId: 'user-1',
    })

    arkCreateAssetGroupMock.mockResolvedValue({ Id: 'group-new-456' })
    arkCreateAssetMock.mockResolvedValue({ Id: 'Asset-xx' })
    arkGetAssetMock.mockResolvedValue({
      Id: 'Asset-xx',
      Name: 'x',
      URL: '',
      AssetType: 'Image',
      GroupId: 'group-new-456',
      Status: 'Active',
      Error: { Code: '', Message: '' },
      CreateTime: '',
      UpdateTime: '',
      ProjectName: 'default',
    })
  })

  it('creates a new asset group and persists it back to ownerUserId', async () => {
    const job = makeJob()
    const promise = handleRegisterArkAssetTask(job)
    await vi.advanceTimersByTimeAsync(6_000)
    const result = await promise

    expect(arkCreateAssetGroupMock).toHaveBeenCalledTimes(1)
    expect(setArkAssetGroupIdMock).toHaveBeenCalledWith('user-1', 'group-new-456')
    expect(arkCreateAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ GroupId: 'group-new-456' }),
      expect.anything(),
    )
    expect(result.status).toBe('active')
  })
})

describe('handleRegisterArkAssetTask — failure surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    prismaMock.characterAppearance.update.mockResolvedValue({})
  })

  it('fails fast when subject is missing', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue(null)
    await expect(handleRegisterArkAssetTask(makeJob())).rejects.toThrow(/ARK_REGISTER_SUBJECT_NOT_FOUND/)
  })

  it('fails fast when subject has no imageUrl', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: null,
      character: { name: 'x' },
      appearanceIndex: 0,
    })
    await expect(handleRegisterArkAssetTask(makeJob())).rejects.toThrow(/ARK_REGISTER_NO_IMAGE/)
  })

  it('marks subject failed + throws when user has no AK/SK', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: 'images/character/abc.png',
      character: { name: 'x' },
      appearanceIndex: 0,
    })
    getArkAssetCredentialsMock.mockResolvedValue(null)

    await expect(handleRegisterArkAssetTask(makeJob())).rejects.toThrow(/ARK_REGISTER_NO_CREDENTIALS/)
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          arkAssetStatus: 'failed',
          arkAssetError: expect.stringContaining('火山'),
        }),
      }),
    )
  })

  it('marks subject failed when GetAsset returns Failed status', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      imageUrl: 'images/character/abc.png',
      character: { name: 'x' },
      appearanceIndex: 0,
    })
    getArkAssetCredentialsMock.mockResolvedValue({
      accessKeyId: 'AKLTtest',
      secretAccessKey: 'secret123',
      assetGroupId: 'group-existing-123',
      ownerUserId: 'user-1',
    })
    arkCreateAssetMock.mockResolvedValue({ Id: 'Asset-fail' })
    arkGetAssetMock.mockResolvedValue({
      Id: 'Asset-fail',
      Name: 'x',
      URL: '',
      AssetType: 'Image',
      GroupId: 'group-existing-123',
      Status: 'Failed',
      Error: { Code: 'RealPersonDetected', Message: '检测到真人人脸' },
      CreateTime: '',
      UpdateTime: '',
      ProjectName: 'default',
    })

    const job = makeJob()
    const promise = handleRegisterArkAssetTask(job)
    await vi.advanceTimersByTimeAsync(6_000)
    const result = await promise

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('RealPersonDetected')
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          arkAssetStatus: 'failed',
          arkAssetError: expect.stringContaining('RealPersonDetected'),
        }),
      }),
    )
  })
})

describe('handleRegisterArkAssetTask — target type routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    getArkAssetCredentialsMock.mockResolvedValue({
      accessKeyId: 'AKLTtest',
      secretAccessKey: 'secret123',
      assetGroupId: 'group-existing-123',
      ownerUserId: 'user-1',
    })
    arkCreateAssetMock.mockResolvedValue({ Id: 'Asset-1' })
    arkGetAssetMock.mockResolvedValue({
      Id: 'Asset-1',
      Name: '',
      URL: '',
      AssetType: 'Image',
      GroupId: '',
      Status: 'Active',
      Error: { Code: '', Message: '' },
      CreateTime: '',
      UpdateTime: '',
      ProjectName: 'default',
    })
    prismaMock.characterAppearance.update.mockResolvedValue({})
    prismaMock.locationImage.update.mockResolvedValue({})
    prismaMock.novelPromotionProp.update.mockResolvedValue({})
  })

  it('reads from locationImage table for LocationImage target', async () => {
    prismaMock.locationImage.findUnique.mockResolvedValue({
      imageUrl: 'images/scene/lobby.png',
      viewName: '正门',
      imageIndex: 1,
      location: { name: '总统府' },
    })

    const job = makeJob({
      targetType: 'LocationImage',
      targetId: 'view-1',
      payload: { targetType: 'LocationImage', targetId: 'view-1' },
    })
    const promise = handleRegisterArkAssetTask(job)
    await vi.advanceTimersByTimeAsync(6_000)
    await promise

    expect(prismaMock.locationImage.findUnique).toHaveBeenCalled()
    expect(prismaMock.characterAppearance.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.locationImage.update).toHaveBeenCalled()
    expect(arkCreateAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ Name: '总统府#正门' }),
      expect.anything(),
    )
  })

  it('reads from novelPromotionProp table for NovelPromotionProp target', async () => {
    prismaMock.novelPromotionProp.findUnique.mockResolvedValue({
      imageUrl: 'images/prop/sword.png',
      name: '玉玺',
    })

    const job = makeJob({
      targetType: 'NovelPromotionProp',
      targetId: 'prop-1',
      payload: { targetType: 'NovelPromotionProp', targetId: 'prop-1' },
    })
    const promise = handleRegisterArkAssetTask(job)
    await vi.advanceTimersByTimeAsync(6_000)
    await promise

    expect(prismaMock.novelPromotionProp.findUnique).toHaveBeenCalled()
    expect(prismaMock.novelPromotionProp.update).toHaveBeenCalled()
    expect(arkCreateAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ Name: '玉玺' }),
      expect.anything(),
    )
  })

  it('throws on unknown targetType', async () => {
    const job = makeJob({
      targetType: 'BogusType',
      targetId: 'x',
      payload: { targetType: 'BogusType', targetId: 'x' },
    } as Partial<TaskJobData>)
    await expect(handleRegisterArkAssetTask(job)).rejects.toThrow(/ARK_REGISTER_BAD_TARGET_TYPE/)
  })
})

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  installAuthMocks,
  mockAuthenticated,
  mockProjectAuth,
  resetAuthMockState,
} from '../../helpers/auth'

installAuthMocks()

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  characterAppearance: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionLocation: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  locationImage: {
    update: vi.fn(),
    create: vi.fn(),
  },
  novelPromotionProp: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}))

const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async (_buffer: Buffer, key: string) => key),
  deleteCOSObject: vi.fn(async () => undefined),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `uploads/${prefix}.${ext}`),
}))

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  event: vi.fn(),
}))

const afterMock = vi.hoisted(() => vi.fn((_callback: () => Promise<void>) => undefined))
const redescribeMock = vi.hoisted(() => vi.fn())

const sharpMock = vi.hoisted(() => {
  const pipeline = {
    metadata: vi.fn(async () => ({ width: 100, height: 100 })),
    extend: vi.fn(),
    composite: vi.fn(),
    jpeg: vi.fn(),
    toBuffer: vi.fn(async () => Buffer.from('processed-image')),
  }
  pipeline.extend.mockReturnValue(pipeline)
  pipeline.composite.mockReturnValue(pipeline)
  pipeline.jpeg.mockReturnValue(pipeline)
  return {
    factory: vi.fn(() => pipeline),
    pipeline,
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: vi.fn(() => loggerMock) }))
vi.mock('@/lib/fonts', () => ({
  initializeFonts: vi.fn(async () => undefined),
  createLabelSVG: vi.fn(async () => Buffer.from('<svg />')),
}))
vi.mock('@/lib/novel-promotion/asset-image-redescribe', () => ({
  redescribeAssetFromImage: redescribeMock,
}))
vi.mock('sharp', () => ({ default: sharpMock.factory }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: afterMock }
})

type RouteModule = typeof import('@/app/api/novel-promotion/[projectId]/upload-asset-image/route')
let routePost: RouteModule['POST']

const characterAppearance = {
  id: 'appearance-1',
  imageUrls: '[]',
  selectedIndex: null,
  description: 'existing description',
  descriptions: JSON.stringify(['existing description']),
}

const location = {
  selectedImageId: null,
  images: [],
}

function uploadRequest(input: {
  type: string
  id: string
  appearanceId?: string
  imageIndex?: number | string
  labelText?: string
  file?: File
}) {
  const formData = new FormData()
  formData.append(
    'file',
    input.file ?? new File([
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], 'asset.png', { type: 'image/png' }),
  )
  formData.append('type', input.type)
  formData.append('id', input.id)
  formData.append('labelText', input.labelText ?? '正面')
  if (input.appearanceId !== undefined) formData.append('appearanceId', input.appearanceId)
  if (input.imageIndex !== undefined) formData.append('imageIndex', String(input.imageIndex))

  return new NextRequest(
    'http://localhost:3000/api/novel-promotion/project-1/upload-asset-image',
    { method: 'POST', body: formData },
  )
}

async function postUpload(input: Parameters<typeof uploadRequest>[0]) {
  return routePost(uploadRequest(input), {
    params: Promise.resolve({ projectId: 'project-1' }),
  })
}

function expectOwnershipBeforeUpload(ownershipMock: { mock: { invocationCallOrder: number[] } }) {
  expect(ownershipMock.mock.invocationCallOrder[0]).toBeLessThan(
    cosMock.uploadToCOS.mock.invocationCallOrder[0],
  )
}

describe('POST /api/novel-promotion/[projectId]/upload-asset-image', () => {
  beforeAll(async () => {
    ;({ POST: routePost } = await import(
      '@/app/api/novel-promotion/[projectId]/upload-asset-image/route'
    ))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMockState()
    mockAuthenticated('editor-1')

    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
    prismaMock.characterAppearance.findFirst.mockResolvedValue(characterAppearance)
    prismaMock.characterAppearance.findUnique.mockResolvedValue(characterAppearance)
    prismaMock.characterAppearance.update.mockResolvedValue(characterAppearance)
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValue(location)
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue(location)
    prismaMock.novelPromotionLocation.update.mockResolvedValue({ id: 'location-1' })
    prismaMock.locationImage.create.mockResolvedValue({ id: 'location-image-1' })
    prismaMock.locationImage.update.mockResolvedValue({ id: 'location-image-1' })
    prismaMock.novelPromotionProp.findFirst.mockResolvedValue({ id: 'prop-1' })
    prismaMock.novelPromotionProp.update.mockResolvedValue({ id: 'prop-1' })
    cosMock.uploadToCOS.mockImplementation(async (_buffer: Buffer, key: string) => key)
    cosMock.deleteCOSObject.mockResolvedValue(undefined)
  })

  it('Viewer 上傳角色圖片 -> 403 且不查 target、不寫 COS', async () => {
    mockProjectAuth('forbidden')

    const response = await postUpload({
      type: 'character',
      id: 'character-1',
      appearanceId: 'appearance-1',
    })

    expect(response.status).toBe(403)
    expect(prismaMock.characterAppearance.findFirst).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('未知素材類型 -> 400 且不寫 COS', async () => {
    const response = await postUpload({ type: 'unknown', id: 'asset-1' })

    expect(response.status).toBe(400)
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('非整數 imageIndex -> 400 且不寫 COS', async () => {
    const response = await postUpload({
      type: 'location',
      id: 'location-1',
      imageIndex: '0abc',
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledTimes(1)
    expect(sharpMock.factory).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('空檔案 -> ownership 後回 400 且不啟動 Sharp/COS', async () => {
    const response = await postUpload({
      type: 'location',
      id: 'location-1',
      file: new File([], 'empty.png', { type: 'image/png' }),
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledTimes(1)
    expect(sharpMock.factory).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('超過 10 MiB -> ownership 後回 400 且不啟動 Sharp/COS', async () => {
    const response = await postUpload({
      type: 'location',
      id: 'location-1',
      file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'oversize.png', {
        type: 'image/png',
      }),
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledTimes(1)
    expect(sharpMock.factory).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('非 JPEG/PNG/WebP 實際格式 -> ownership 後回 400 且不啟動 Sharp/COS', async () => {
    const response = await postUpload({
      type: 'location',
      id: 'location-1',
      file: new File([Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'fake.png', {
        type: 'image/png',
      }),
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledTimes(1)
    expect(sharpMock.factory).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('imageIndex 32 -> ownership 後回 400 且不啟動 Sharp/COS', async () => {
    const response = await postUpload({ type: 'character', id: 'character-1', appearanceId: 'appearance-1', imageIndex: 32 })

    expect(response.status).toBe(400)
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledTimes(1)
    expect(sharpMock.factory).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('極大 imageIndex -> ownership 後回 400 且不啟動 Sharp/COS', async () => {
    const response = await postUpload({
      type: 'character',
      id: 'character-1',
      appearanceId: 'appearance-1',
      imageIndex: '999999999999999999999999999999999999999999',
    })

    expect(response.status).toBe(400)
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledTimes(1)
    expect(sharpMock.factory).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('外專案角色 appearance -> 404 且 COS 零寫入', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    // Existing vulnerable code can see this row through an unscoped findUnique.
    prismaMock.characterAppearance.findUnique.mockResolvedValueOnce({
      ...characterAppearance,
      id: 'foreign-appearance',
    })

    const response = await postUpload({
      type: 'character',
      id: 'character-1',
      appearanceId: 'foreign-appearance',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign-appearance',
        characterId: 'character-1',
        character: { novelPromotionProject: { projectId: 'project-1' } },
      },
    })
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.characterAppearance.update).not.toHaveBeenCalled()
  })

  it('appearanceId 不屬於 characterId -> 404 且 COS 零寫入', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)

    const response = await postUpload({
      type: 'character',
      id: 'character-2',
      appearanceId: 'appearance-1',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'appearance-1',
        characterId: 'character-2',
        character: { novelPromotionProject: { projectId: 'project-1' } },
      },
    })
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('外專案場景 -> 404 且 COS 零寫入', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValueOnce(null)
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValueOnce({
      selectedImageId: 'foreign-image',
      images: [],
    })

    const response = await postUpload({ type: 'location', id: 'foreign-location' })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign-location',
        novelPromotionProject: { projectId: 'project-1' },
      },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.locationImage.create).not.toHaveBeenCalled()
  })

  it('外專案道具 -> 404 且 COS 零寫入', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce(null)

    const response = await postUpload({ type: 'prop', id: 'foreign-prop' })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionProp.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-prop', novelPromotionProject: { projectId: 'project-1' } },
      select: { id: true },
    })
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionProp.update).not.toHaveBeenCalled()
  })

  it('合法角色 target -> ownership 查詢先於 COS，上傳後更新同一 appearance', async () => {
    const response = await postUpload({
      type: 'character',
      id: 'character-1',
      appearanceId: 'appearance-1',
      imageIndex: 0,
    })

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    expectOwnershipBeforeUpload(prismaMock.characterAppearance.findFirst)
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-1' },
      data: {
        imageUrls: JSON.stringify(['uploads/char-character-1-appearance-1-upload.jpg']),
        imageUrl: 'uploads/char-character-1-appearance-1-upload.jpg',
      },
    })
    expect(afterMock).not.toHaveBeenCalled()
    expect(redescribeMock).not.toHaveBeenCalled()
  })

  it('合法場景 target -> ownership 查詢先於 COS，維持既有 form contract', async () => {
    const response = await postUpload({ type: 'location', id: 'location-1', labelText: '窗邊' })

    expect(response.status).toBe(200)
    expectOwnershipBeforeUpload(prismaMock.novelPromotionLocation.findFirst)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.locationImage.create).toHaveBeenCalledWith({
      data: {
        locationId: 'location-1',
        imageIndex: 0,
        imageUrl: 'uploads/loc-location-1-upload.jpg',
        description: '窗邊',
        isSelected: true,
      },
    })
    expect(afterMock).not.toHaveBeenCalled()
    expect(redescribeMock).not.toHaveBeenCalled()
  })

  it('合法道具 target -> ownership 查詢先於 COS，上傳後更新同一道具', async () => {
    const response = await postUpload({ type: 'prop', id: 'prop-1' })

    expect(response.status).toBe(200)
    expectOwnershipBeforeUpload(prismaMock.novelPromotionProp.findFirst)
    expect(prismaMock.novelPromotionProp.update).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { imageUrl: 'uploads/prop-prop-1-upload.jpg' },
    })
    expect(afterMock).not.toHaveBeenCalled()
    expect(redescribeMock).not.toHaveBeenCalled()
  })

  it('角色 DB update 失敗 -> 刪除本次新 blob 並回報原始錯誤', async () => {
    prismaMock.characterAppearance.update.mockRejectedValueOnce(new Error('character-db-write-failed'))

    const response = await postUpload({
      type: 'character',
      id: 'character-1',
      appearanceId: 'appearance-1',
    })

    expect(response.status).toBe(500)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(
      'uploads/char-character-1-appearance-1-upload.jpg',
      { throwOnError: true },
    )
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'asset_image_persistence_failed',
      details: expect.objectContaining({
        projectId: 'project-1',
        assetType: 'character',
        assetId: 'character-1',
        imageKey: 'uploads/char-character-1-appearance-1-upload.jpg',
        persistenceError: 'character-db-write-failed',
        cleanupError: null,
      }),
    }))
  })

  it('角色既有 imageUrls 無法解析 -> 刪除本次新 blob 且不寫 DB', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce({
      ...characterAppearance,
      imageUrls: 'not-json',
    })

    const response = await postUpload({
      type: 'character',
      id: 'character-1',
      appearanceId: 'appearance-1',
    })

    expect(response.status).toBe(500)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(
      'uploads/char-character-1-appearance-1-upload.jpg',
      { throwOnError: true },
    )
    expect(prismaMock.characterAppearance.update).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'asset_image_persistence_failed',
      details: expect.objectContaining({
        persistenceError: expect.stringContaining('characterAppearance.imageUrls'),
        cleanupError: null,
      }),
    }))
  })

  it('場景 DB create 失敗 -> 刪除本次新 blob', async () => {
    prismaMock.locationImage.create.mockRejectedValueOnce(new Error('location-db-create-failed'))

    const response = await postUpload({ type: 'location', id: 'location-1' })

    expect(response.status).toBe(500)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(
      'uploads/loc-location-1-upload.jpg',
      { throwOnError: true },
    )
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'asset_image_persistence_failed',
      details: expect.objectContaining({
        persistenceError: 'location-db-create-failed',
        cleanupError: null,
      }),
    }))
  })

  it('場景圖片建立後 selectedImageId 寫入失敗 -> transaction 失敗並刪除新 blob', async () => {
    prismaMock.novelPromotionLocation.update.mockRejectedValueOnce(
      new Error('location-selection-write-failed'),
    )

    const response = await postUpload({ type: 'location', id: 'location-1' })

    expect(response.status).toBe(500)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.locationImage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: 'uploads/loc-location-1-upload.jpg' }),
    }))
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(
      'uploads/loc-location-1-upload.jpg',
      { throwOnError: true },
    )
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'asset_image_persistence_failed',
      details: expect.objectContaining({
        persistenceError: 'location-selection-write-failed',
        cleanupError: null,
      }),
    }))
  })

  it('道具 DB update 與 blob cleanup 都失敗 -> 兩個錯誤同時可觀測且仍回報原始失敗', async () => {
    prismaMock.novelPromotionProp.update.mockRejectedValueOnce(new Error('prop-db-write-failed'))
    cosMock.deleteCOSObject.mockRejectedValueOnce(new Error('cos-cleanup-failed'))

    const response = await postUpload({ type: 'prop', id: 'prop-1' })

    expect(response.status).toBe(500)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(
      'uploads/prop-prop-1-upload.jpg',
      { throwOnError: true },
    )
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'asset_image_persistence_failed',
      details: expect.objectContaining({
        projectId: 'project-1',
        assetType: 'prop',
        assetId: 'prop-1',
        imageKey: 'uploads/prop-prop-1-upload.jpg',
        persistenceError: 'prop-db-write-failed',
        cleanupError: 'cos-cleanup-failed',
      }),
    }))
    const body = await response.json()
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).not.toContain('prop-db-write-failed')
    expect(body.error.message).not.toContain('cos-cleanup-failed')
  })
})

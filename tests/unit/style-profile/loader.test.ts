import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== Mocks =====

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  mediaObject: {
    findMany: vi.fn(),
  },
}))

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  event: vi.fn(),
  child: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn((...args: unknown[]) => loggerMock.warn(...args)),
  logError: vi.fn((...args: unknown[]) => loggerMock.error(...args)),
  createScopedLogger: vi.fn(() => loggerMock),
}))

// ===== Real import (after mocks) =====
import { loadStyleProfile, type StyleProfile } from '@/lib/style-profile/loader'

// helper: returns prisma client placeholder; loader receives `prisma` arg directly
const prismaArg = prismaMock as unknown as Parameters<typeof loadStyleProfile>[0]

describe('style-profile loader behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('三栏全 null -> 回传 realistic preset (2026-05-04 fallback)', async () => {
    // Behavior change: previously returned null when all three style
    // fields were null, which made the chokepoint a pass-through and
    // let GEM-3.1 free-style stylized output (iangyc 2026-05-03
    // incident — TikTok 短劇 needs photoreal). Loader now falls back
    // to the 'realistic' preset so legacy projects + any future-codepath
    // miss-seed both get cinematic photorealism instead of nothing.
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: null,
      project: { userId: 'user-1' },
    })

    const result: StyleProfile | null = await loadStyleProfile(prismaArg, 'np-project-1')
    expect(result).not.toBeNull()
    expect(result!.positivePrompt).toMatch(/photorealistic/i)
    expect(result!.negativePrompt).toMatch(/cartoon|anime|illustration/i)
    expect(result!.referenceImageUrls).toEqual([])
  })

  it('只有 positivePrompt -> 回传 { positivePrompt, negativePrompt: null, referenceImageUrls: [] }', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: '高对比黑白漫画风',
      styleNegativePrompt: null,
      styleReferenceImages: null,
      project: { userId: 'user-1' },
    })

    const result = await loadStyleProfile(prismaArg, 'np-project-1')
    expect(result).toEqual({
      positivePrompt: '高对比黑白漫画风',
      negativePrompt: null,
      referenceImageUrls: [],
    })
  })

  it('styleReferenceImages 是合法 JSON array of MediaObject ids -> 回传对应 URL 陣列（owner 通過）', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: JSON.stringify(['media-1', 'media-2']),
      project: { userId: 'user-1' },
    })

    // Q-005 A: implementer 在 loader 內透過 uploadedByUserId 對齊 project.user.id 過濾。
    // 兩筆 row 的 uploadedByUserId 都 == 'user-1'（即 project owner）→ 全部回傳。
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      { id: 'media-1', publicId: 'pub-1', storageKey: 'cos/ref-1.png', uploadedByUserId: 'user-1' },
      { id: 'media-2', publicId: 'pub-2', storageKey: 'cos/ref-2.png', uploadedByUserId: 'user-1' },
    ])

    const result = await loadStyleProfile(prismaArg, 'np-project-1')
    expect(result).not.toBeNull()
    expect(result?.referenceImageUrls).toHaveLength(2)
    // 不锁死 URL 具体格式（实现可能用 /m/<publicId> 或 cosKey），仅断言两个 id 都被解析为 string url
    expect(result?.referenceImageUrls.every((u) => typeof u === 'string' && u.length > 0)).toBe(true)
    // 顺序必须保留（id 数组顺序 -> URL 数组顺序）
    expect(result?.referenceImageUrls[0]).not.toBe(result?.referenceImageUrls[1])
  })

  it('styleReferenceImages 含越权 mediaId（owner != project.user）-> 该 id 跳过 + log warn + 返回 URL 阵列不含越权 id', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: JSON.stringify(['media-allowed', 'media-forbidden']),
      project: { userId: 'user-1' },
    })

    // Q-005 A 第二輪 implementer 在 loader 內加 owner 過濾。
    // 這裡 mock findMany 同時回傳兩筆（其中一筆 owner 是別人）→
    // loader 應該過濾掉 uploadedByUserId !== 'user-1' 的那筆，且 log warn。
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      { id: 'media-allowed', publicId: 'pub-allowed', storageKey: 'cos/allowed.png', uploadedByUserId: 'user-1' },
      { id: 'media-forbidden', publicId: 'pub-forbidden', storageKey: 'cos/forbidden.png', uploadedByUserId: 'user-2' },
    ])

    const result = await loadStyleProfile(prismaArg, 'np-project-1')

    // 业务断言主轴：返回的 URL 阵列只有 1 个，且该 URL 必须与 allowed publicId 相关（不含 forbidden）
    expect(result?.referenceImageUrls).toHaveLength(1)
    const url = result?.referenceImageUrls[0] ?? ''
    expect(url).toContain('pub-allowed')
    expect(url).not.toContain('pub-forbidden')

    // forbidden id 应该 log warn（次要断言）
    expect(loggerMock.warn).toHaveBeenCalled()
    const warnCalls = loggerMock.warn.mock.calls.flat()
    const warnText = JSON.stringify(warnCalls)
    expect(warnText).toContain('media-forbidden')
  })

  it('styleReferenceImages 含 mediaId，且 row uploadedByUserId 是 NULL（未 backfill）-> 该 id 跳过 + log warn', async () => {
    // Q-005 A: nullable owner field（backfill 過渡期），rows with NULL 視為「未驗證 owner」一律 skip
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: JSON.stringify(['media-null-owner']),
      project: { userId: 'user-1' },
    })
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      { id: 'media-null-owner', publicId: 'pub-null', storageKey: 'cos/null-owner.png', uploadedByUserId: null },
    ])

    const result = await loadStyleProfile(prismaArg, 'np-project-1')
    // 业务断言：null-owner row 必须被跳过 → 結果空陣列
    expect(result?.referenceImageUrls).toHaveLength(0)
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('styleReferenceImages 是 invalid JSON -> 拋 explicit error（不静默吞）', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: '{not-valid-json',
      project: { userId: 'user-1' },
    })

    await expect(loadStyleProfile(prismaArg, 'np-project-1')).rejects.toThrow()
  })

  it('project 不存在 -> 拋 explicit error', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce(null)
    await expect(loadStyleProfile(prismaArg, 'np-project-not-exist')).rejects.toThrow()
  })

  it('styleReferenceImages 是合法 JSON 但不是 array（例如 object）-> 拋 explicit error', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: JSON.stringify({ not: 'array' }),
      project: { userId: 'user-1' },
    })

    await expect(loadStyleProfile(prismaArg, 'np-project-1')).rejects.toThrow()
  })

  it('styleReferenceImages 为空数组 -> referenceImageUrls 为空', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: 'positive',
      styleNegativePrompt: null,
      styleReferenceImages: JSON.stringify([]),
      project: { userId: 'user-1' },
    })

    const result = await loadStyleProfile(prismaArg, 'np-project-1')
    expect(result).toEqual({
      positivePrompt: 'positive',
      negativePrompt: null,
      referenceImageUrls: [],
    })
  })

  it('positive + negative + referenceImages 全有 -> 三栏值都正确返回', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      projectId: 'project-1',
      stylePositivePrompt: 'POS',
      styleNegativePrompt: 'NEG',
      styleReferenceImages: JSON.stringify(['media-1']),
      project: { userId: 'user-1' },
    })
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      { id: 'media-1', publicId: 'pub-1', storageKey: 'cos/r.png', uploadedByUserId: 'user-1' },
    ])

    const result = await loadStyleProfile(prismaArg, 'np-project-1')
    expect(result?.positivePrompt).toBe('POS')
    expect(result?.negativePrompt).toBe('NEG')
    expect(result?.referenceImageUrls).toHaveLength(1)
  })
})

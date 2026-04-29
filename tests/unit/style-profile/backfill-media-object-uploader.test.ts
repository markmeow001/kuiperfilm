import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== Mocks =====
//
// Q-005 A: backfill MediaObject.uploadedByUserId.
// implementer 第二輪採用「per-relation-table 全表掃描 → 合併到 mediaId→userId map → 更新」
// 設計 (見 scripts/migrations/backfill-media-object-uploader.ts)。
// 因此測試 mock 多個 prisma 表的 findMany；mediaObject.findMany 返回 null rows，
// 各 chain 表的 findMany 返回對應 (mediaId, userId) 的 row。

type MediaIdRow = { id: string }

const prismaMock = vi.hoisted(() => ({
  mediaObject: {
    findMany: vi.fn<(...args: unknown[]) => Promise<MediaIdRow[]>>(async () => []),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  characterAppearance: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  locationImage: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  novelPromotionPanel: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  supplementaryPanel: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  novelPromotionShot: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  novelPromotionEpisode: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  novelPromotionCharacter: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  globalCharacterAppearance: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  globalLocationImage: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  globalCharacter: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
  globalVoice: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  },
}))

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn((...args: unknown[]) => loggerMock.info(...args)),
  logWarn: vi.fn((...args: unknown[]) => loggerMock.warn(...args)),
  logError: vi.fn((...args: unknown[]) => loggerMock.error(...args)),
  createScopedLogger: vi.fn(() => loggerMock),
}))

// ===== Real import (after mocks) =====
import { backfillMediaObjectUploader } from '../../../scripts/migrations/backfill-media-object-uploader'

function lastUpdateCall(): { where: { id: string }; data: { uploadedByUserId: string } } | undefined {
  const calls = prismaMock.mediaObject.update.mock.calls
  if (calls.length === 0) return undefined
  return calls[calls.length - 1]?.[0] as {
    where: { id: string }
    data: { uploadedByUserId: string }
  }
}

describe('backfill-media-object-uploader script behavior (Q-005 A)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('反查链命中（CharacterAppearance → Character → NovelPromotionProject → Project.userId）→ uploadedByUserId 被填', async () => {
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([{ id: 'media-1' }])
    prismaMock.characterAppearance.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-1',
        character: {
          novelPromotionProject: {
            project: { userId: 'user-1' },
          },
        },
      },
    ])

    const stats = await backfillMediaObjectUploader({ apply: true })

    expect(stats.totalNullRows).toBe(1)
    expect(stats.resolved).toBe(1)
    expect(stats.unresolved).toBe(0)

    const call = lastUpdateCall()
    expect(call?.where).toEqual({ id: 'media-1' })
    expect(call?.data.uploadedByUserId).toBe('user-1')
  })

  it('反查链找不到 owner（孤立 media）→ 保留 NULL（不 update）+ stats.unresolved 计数', async () => {
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([{ id: 'media-orphan' }])
    // 所有 chain 表都返回空 → media-orphan 反查不到 → 保留 NULL

    const stats = await backfillMediaObjectUploader({ apply: true })

    expect(stats.totalNullRows).toBe(1)
    expect(stats.resolved).toBe(0)
    expect(stats.unresolved).toBe(1)
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('idempotent: 没有 null row -> stats.totalNullRows = 0 + update 不被呼叫', async () => {
    // mediaObject.findMany returns 空数组（implementer 用 where: { uploadedByUserId: null } 过滤）
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([])

    const stats = await backfillMediaObjectUploader({ apply: true })

    expect(stats.totalNullRows).toBe(0)
    expect(stats.resolved).toBe(0)
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('idempotent: 同一份 data 連跑兩次，第二次 totalNullRows = 0', async () => {
    // 第 1 次：1 个 null row 反查到 user-1 → update
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([{ id: 'media-1' }])
    prismaMock.characterAppearance.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-1',
        character: {
          novelPromotionProject: { project: { userId: 'user-1' } },
        },
      },
    ])

    const stats1 = await backfillMediaObjectUploader({ apply: true })
    expect(stats1.resolved).toBe(1)
    expect(prismaMock.mediaObject.update).toHaveBeenCalledTimes(1)

    prismaMock.mediaObject.update.mockClear()

    // 第 2 次：null row 0 个（implementer 真實情境下 update 之後 row 已不再 null）
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([])

    const stats2 = await backfillMediaObjectUploader({ apply: true })
    expect(stats2.totalNullRows).toBe(0)
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('--apply=false (dry-run) -> 计算反查链 + dryRun 标记 + update 不被呼叫', async () => {
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      { id: 'media-1' },
      { id: 'media-2' },
    ])
    prismaMock.characterAppearance.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-1',
        character: { novelPromotionProject: { project: { userId: 'user-1' } } },
      },
    ])
    prismaMock.locationImage.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-2',
        location: { novelPromotionProject: { project: { userId: 'user-2' } } },
      },
    ])

    const stats = await backfillMediaObjectUploader({ apply: false })

    expect(stats.dryRun).toBe(true)
    expect(stats.totalNullRows).toBe(2)
    expect(stats.resolved).toBe(2)
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('多 row 混合：部分能反查 + 部分不能 → 能反查的填上，不能反查的保留 NULL', async () => {
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      { id: 'media-found' },
      { id: 'media-orphan' },
    ])
    prismaMock.characterAppearance.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-found',
        character: { novelPromotionProject: { project: { userId: 'user-1' } } },
      },
    ])
    // media-orphan 不在任何 chain → 保留 null

    const stats = await backfillMediaObjectUploader({ apply: true })

    expect(stats.totalNullRows).toBe(2)
    expect(stats.resolved).toBe(1)
    expect(stats.unresolved).toBe(1)

    const updateCalls = prismaMock.mediaObject.update.mock.calls
    expect(updateCalls.length).toBe(1)
    const callArg = updateCalls[0]?.[0] as {
      where: { id: string }
      data: { uploadedByUserId: string }
    }
    expect(callArg.where.id).toBe('media-found')
    expect(callArg.data.uploadedByUserId).toBe('user-1')
  })

  // P1-5: SupplementaryPanel chain (per script docstring item #8 — chain
  // SupplementaryPanel → NovelPromotionStoryboard → NovelPromotionEpisode →
  // NovelPromotionProject → Project.userId).
  // Schema confirms supplementary_panels.storyboard_id → novel_promotion_storyboards
  // and storyboard.episode_id → novel_promotion_episodes; resolver must walk the
  // full chain to recover owner.
  it('反查链命中（SupplementaryPanel → Storyboard → Episode → NovelPromotionProject → Project.userId）→ uploadedByUserId 被填', async () => {
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([{ id: 'media-supp-1' }])
    prismaMock.supplementaryPanel.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-supp-1',
        storyboard: {
          episode: {
            novelPromotionProject: {
              project: { userId: 'user-supp-1' },
            },
          },
        },
      },
    ])

    const stats = await backfillMediaObjectUploader({ apply: true })

    expect(stats.totalNullRows).toBe(1)
    expect(stats.resolved).toBe(1)
    expect(stats.unresolved).toBe(0)

    const call = lastUpdateCall()
    expect(call?.where).toEqual({ id: 'media-supp-1' })
    expect(call?.data.uploadedByUserId).toBe('user-supp-1')
  })

  it('多个 chain 都命中同一个 mediaId → first hit wins (不重复 update)', async () => {
    // implementer 设计：「First match wins (Map.set never overwrites because we
    // skip ids already present)」。
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([{ id: 'media-shared' }])
    // chain 1 (CharacterAppearance) 命中 user-A
    prismaMock.characterAppearance.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-shared',
        character: { novelPromotionProject: { project: { userId: 'user-A' } } },
      },
    ])
    // chain 2 (LocationImage) 也宣称同一 mediaId 但 owner = user-B
    // → 第一个 chain (CharacterAppearance) 已 win，第二个被 skip
    prismaMock.locationImage.findMany.mockResolvedValueOnce([
      {
        imageMediaId: 'media-shared',
        location: { novelPromotionProject: { project: { userId: 'user-B' } } },
      },
    ])

    await backfillMediaObjectUploader({ apply: true })

    const updateCalls = prismaMock.mediaObject.update.mock.calls
    expect(updateCalls.length).toBe(1)
    const callArg = updateCalls[0]?.[0] as {
      where: { id: string }
      data: { uploadedByUserId: string }
    }
    expect(callArg.where.id).toBe('media-shared')
    // 业务断言：first hit wins → user-A 而不是 user-B
    expect(callArg.data.uploadedByUserId).toBe('user-A')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 11.2 — episode-asset-bridge unit tests
 *
 * 跑：`BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/lib/episode-asset-bridge.test.ts`
 *
 * 合約 (Q-1 A / Q-2 B / Q-3 C)：
 *   - junction (EpisodeCharacter / EpisodeLocation) 是 SoT
 *   - bridge 反查順序: name(精確) → name(case-insensitive) → aliases JSON 三層
 *     (locations 沒有 aliases 欄位，第 3 層自動跳過)
 *   - junction.role 區分來源:
 *       'auto-from-panel' / 'manual' / 'imported-from-global'
 *
 * 實際 signature (見 src/lib/episode-asset-bridge.ts)：
 *   - linkEpisodeCharactersFromPanel(tx, { projectId, episodeId, panelCharacterNames, role })
 *       => { matched: number, unmatched: string[], ambiguous: string[] }
 *     先用 projectId 查 NovelPromotionProject.id；character 用 createMany skipDuplicates 寫入
 *   - linkEpisodeLocationFromPanel(tx, { projectId, episodeId, locationName, role })
 *       => { matched: boolean, unmatched: boolean, ambiguous: boolean }
 *     單一 locationName，no-aliases；location 用 findUnique 預檢 + create 寫入
 *   - getEpisodesForCharacter(characterId) => Episode[]（從 episodeCharacter junction 取）
 *   - getEpisodesForLocation(locationId)   => Episode[]（從 episodeLocation junction 取）
 */

const txMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionCharacter: {
    findMany: vi.fn(),
  },
  novelPromotionLocation: {
    findMany: vi.fn(),
  },
  episodeCharacter: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  episodeLocation: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}))

const prismaMock = vi.hoisted(() => ({
  episodeCharacter: {
    findMany: vi.fn(),
  },
  episodeLocation: {
    findMany: vi.fn(),
  },
}))

const loggerMock = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => loggerMock)

import {
  linkEpisodeCharactersFromPanel,
  linkEpisodeLocationFromPanel,
  getEpisodesForCharacter,
  getEpisodesForLocation,
} from '@/lib/episode-asset-bridge'

describe('episode-asset-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 預設 NovelPromotionProject 存在
    txMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'np-1' })
    txMock.episodeCharacter.findMany.mockResolvedValue([])
    txMock.episodeCharacter.createMany.mockResolvedValue({ count: 1 })
    txMock.episodeLocation.findUnique.mockResolvedValue(null)
    txMock.episodeLocation.create.mockResolvedValue({ id: 'el-1' })
  })

  describe('linkEpisodeCharactersFromPanel — 三層 fallback', () => {
    it('exact name match (level 1) -> 寫入 junction, role 對, matched=1', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        { id: 'char-1', name: '小明', aliases: null },
      ])

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: ['小明'],
        role: 'auto-from-panel',
      })

      expect(result).toEqual({ matched: 1, unmatched: [], ambiguous: [] })
      expect(txMock.episodeCharacter.createMany).toHaveBeenCalledTimes(1)
      const arg = txMock.episodeCharacter.createMany.mock.calls[0][0]
      expect(arg.skipDuplicates).toBe(true)
      expect(arg.data).toEqual([
        { episodeId: 'ep-1', characterId: 'char-1', role: 'auto-from-panel' },
      ])
    })

    it('多筆 case-sensitive match -> ambiguous, skip + warn, 不寫入', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        { id: 'char-a', name: '小明', aliases: null },
        { id: 'char-b', name: '小明', aliases: null },
      ])

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: ['小明'],
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(0)
      expect(result.ambiguous).toEqual(['小明'])
      expect(result.unmatched).toEqual([])
      expect(txMock.episodeCharacter.createMany).not.toHaveBeenCalled()
      expect(loggerMock.logWarn).toHaveBeenCalled()
    })

    it('exact 不中但 case-insensitive 中 (level 2) -> 寫入', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        { id: 'char-mary', name: 'Mary', aliases: null },
      ])

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: ['mary'],
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(1)
      expect(result.unmatched).toEqual([])
      expect(txMock.episodeCharacter.createMany).toHaveBeenCalledTimes(1)
      const arg = txMock.episodeCharacter.createMany.mock.calls[0][0]
      expect(arg.data).toEqual([
        { episodeId: 'ep-1', characterId: 'char-mary', role: 'auto-from-panel' },
      ])
    })

    it('name 不中但 aliases JSON 包含該名 (level 3) -> 寫入', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        {
          id: 'char-mary',
          name: 'Mary',
          aliases: JSON.stringify(['玛丽', 'Mary Q']),
        },
      ])

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: ['玛丽'],
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(1)
      expect(result.unmatched).toEqual([])
      const arg = txMock.episodeCharacter.createMany.mock.calls[0][0]
      expect(arg.data[0].characterId).toBe('char-mary')
    })

    it('三層都不中 -> unmatched, skip + warn, 不寫入', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        { id: 'char-a', name: 'Alice', aliases: null },
      ])

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: ['Bob'],
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(0)
      expect(result.unmatched).toEqual(['Bob'])
      expect(result.ambiguous).toEqual([])
      expect(txMock.episodeCharacter.createMany).not.toHaveBeenCalled()
      expect(loggerMock.logWarn).toHaveBeenCalled()
    })

    it('部分中部分不中 -> matched=2, unmatched 包含未中的名字', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        { id: 'char-a', name: 'Alice', aliases: null },
        { id: 'char-c', name: 'Carol', aliases: JSON.stringify(['卡羅']) },
      ])

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        // Alice 精確中、卡羅 alias 中、Bob 三層都不中
        panelCharacterNames: ['Alice', '卡羅', 'Bob'],
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(2)
      expect(result.unmatched).toEqual(['Bob'])
      expect(result.ambiguous).toEqual([])

      // createMany 一次寫入兩個 character
      expect(txMock.episodeCharacter.createMany).toHaveBeenCalledTimes(1)
      const arg = txMock.episodeCharacter.createMany.mock.calls[0][0]
      const ids = (arg.data as Array<{ characterId: string }>).map((d) => d.characterId).sort()
      expect(ids).toEqual(['char-a', 'char-c'].sort())
    })

    it('idempotent: 第二次呼叫時 existing 已包含該配對 -> 不重複寫入', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        { id: 'char-1', name: '小明', aliases: null },
      ])
      // 模擬第二次 — episodeCharacter.findMany 回 existing 有這個 pair
      txMock.episodeCharacter.findMany.mockResolvedValue([{ characterId: 'char-1' }])

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: ['小明'],
        role: 'auto-from-panel',
      })

      // 仍 matched=1（語意上 link 成功），但不應再 createMany
      expect(result.matched).toBe(1)
      expect(txMock.episodeCharacter.createMany).not.toHaveBeenCalled()
    })

    it('role=manual 與 role=imported-from-global 各自正確寫入', async () => {
      txMock.novelPromotionCharacter.findMany.mockResolvedValue([
        { id: 'char-1', name: '小明', aliases: null },
      ])

      await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: ['小明'],
        role: 'manual',
      })
      const c1 = txMock.episodeCharacter.createMany.mock.calls.at(-1)?.[0]
      expect(c1.data[0].role).toBe('manual')

      await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-2',
        panelCharacterNames: ['小明'],
        role: 'imported-from-global',
      })
      const c2 = txMock.episodeCharacter.createMany.mock.calls.at(-1)?.[0]
      expect(c2.data[0].role).toBe('imported-from-global')
    })

    it('panelCharacterNames 為空陣列 -> 不查 DB 不寫入, matched=0', async () => {
      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        panelCharacterNames: [],
        role: 'auto-from-panel',
      })
      expect(result).toEqual({ matched: 0, unmatched: [], ambiguous: [] })
      expect(txMock.novelPromotionProject.findUnique).not.toHaveBeenCalled()
      expect(txMock.novelPromotionCharacter.findMany).not.toHaveBeenCalled()
      expect(txMock.episodeCharacter.createMany).not.toHaveBeenCalled()
    })

    it('NovelPromotionProject 不存在 -> 全 unmatched, 不寫入', async () => {
      txMock.novelPromotionProject.findUnique.mockResolvedValue(null)

      const result = await linkEpisodeCharactersFromPanel(txMock as never, {
        projectId: 'proj-missing',
        episodeId: 'ep-1',
        panelCharacterNames: ['小明'],
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(0)
      expect(result.unmatched).toEqual(['小明'])
      expect(txMock.episodeCharacter.createMany).not.toHaveBeenCalled()
      expect(loggerMock.logWarn).toHaveBeenCalled()
    })
  })

  describe('linkEpisodeLocationFromPanel — 單一 locationName', () => {
    it('exact name match -> 寫入 junction, matched=true', async () => {
      txMock.novelPromotionLocation.findMany.mockResolvedValue([
        { id: 'loc-1', name: '客廳' },
      ])

      const result = await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: '客廳',
        role: 'auto-from-panel',
      })

      expect(result).toEqual({ matched: true, unmatched: false, ambiguous: false })
      expect(txMock.episodeLocation.create).toHaveBeenCalledTimes(1)
      const arg = txMock.episodeLocation.create.mock.calls[0][0]
      expect(arg.data).toEqual({
        episodeId: 'ep-1',
        locationId: 'loc-1',
        role: 'auto-from-panel',
      })
    })

    it('多筆 case-sensitive match -> ambiguous, 不寫入', async () => {
      txMock.novelPromotionLocation.findMany.mockResolvedValue([
        { id: 'loc-a', name: '客廳' },
        { id: 'loc-b', name: '客廳' },
      ])

      const result = await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: '客廳',
        role: 'auto-from-panel',
      })

      expect(result).toEqual({ matched: false, unmatched: false, ambiguous: true })
      expect(txMock.episodeLocation.create).not.toHaveBeenCalled()
      expect(loggerMock.logWarn).toHaveBeenCalled()
    })

    it('case-insensitive fallback (level 2) -> 寫入', async () => {
      txMock.novelPromotionLocation.findMany.mockResolvedValue([
        { id: 'loc-x', name: 'Office' },
      ])

      const result = await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: 'OFFICE',
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(true)
      expect(txMock.episodeLocation.create).toHaveBeenCalledTimes(1)
      const arg = txMock.episodeLocation.create.mock.calls[0][0]
      expect(arg.data.locationId).toBe('loc-x')
    })

    it('三層都不中 -> unmatched, 不寫入', async () => {
      txMock.novelPromotionLocation.findMany.mockResolvedValue([
        { id: 'loc-x', name: 'Office' },
      ])

      const result = await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: 'NotAnywhere',
        role: 'auto-from-panel',
      })

      expect(result).toEqual({ matched: false, unmatched: true, ambiguous: false })
      expect(txMock.episodeLocation.create).not.toHaveBeenCalled()
      expect(loggerMock.logWarn).toHaveBeenCalled()
    })

    it('idempotent: 已存在於 episodeLocation -> matched=true 但不重複 create', async () => {
      txMock.novelPromotionLocation.findMany.mockResolvedValue([
        { id: 'loc-1', name: '客廳' },
      ])
      txMock.episodeLocation.findUnique.mockResolvedValue({ id: 'el-existing' })

      const result = await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: '客廳',
        role: 'auto-from-panel',
      })

      expect(result.matched).toBe(true)
      expect(txMock.episodeLocation.create).not.toHaveBeenCalled()
    })

    it('locationName 為 null -> 全 false, 不查 DB', async () => {
      const result = await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: null,
        role: 'auto-from-panel',
      })
      expect(result).toEqual({ matched: false, unmatched: false, ambiguous: false })
      expect(txMock.novelPromotionProject.findUnique).not.toHaveBeenCalled()
      expect(txMock.episodeLocation.create).not.toHaveBeenCalled()
    })

    it('locationName 為空字串 -> 全 false, 不查 DB', async () => {
      const result = await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: '   ',
        role: 'auto-from-panel',
      })
      expect(result).toEqual({ matched: false, unmatched: false, ambiguous: false })
      expect(txMock.episodeLocation.create).not.toHaveBeenCalled()
    })

    it('role=manual / imported-from-global 寫入正確', async () => {
      txMock.novelPromotionLocation.findMany.mockResolvedValue([
        { id: 'loc-1', name: '客廳' },
      ])

      await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-1',
        locationName: '客廳',
        role: 'manual',
      })
      const a1 = txMock.episodeLocation.create.mock.calls.at(-1)?.[0]
      expect(a1.data.role).toBe('manual')

      txMock.episodeLocation.findUnique.mockResolvedValue(null)
      await linkEpisodeLocationFromPanel(txMock as never, {
        projectId: 'proj-1',
        episodeId: 'ep-2',
        locationName: '客廳',
        role: 'imported-from-global',
      })
      const a2 = txMock.episodeLocation.create.mock.calls.at(-1)?.[0]
      expect(a2.data.role).toBe('imported-from-global')
    })
  })

  describe('getEpisodesForCharacter — junction is SoT (Q-1 A)', () => {
    it('一個 character 出現於多 episodes -> 回 episodes 陣列含 id/episodeNumber/name', async () => {
      prismaMock.episodeCharacter.findMany.mockResolvedValue([
        { episode: { id: 'ep-3', episodeNumber: 3, name: '第 3 集' } },
        { episode: { id: 'ep-7', episodeNumber: 7, name: '第 7 集' } },
      ])

      const result = await getEpisodesForCharacter('char-1')

      expect(result).toEqual([
        { id: 'ep-3', episodeNumber: 3, name: '第 3 集' },
        { id: 'ep-7', episodeNumber: 7, name: '第 7 集' },
      ])

      // 必須從 episodeCharacter junction 取，不從 panels 反查
      expect(prismaMock.episodeCharacter.findMany).toHaveBeenCalledTimes(1)
      const arg = prismaMock.episodeCharacter.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({ characterId: 'char-1' })
      expect(arg.include?.episode).toBeDefined()
    })

    it('character 不出現任何 episode -> 回空陣列', async () => {
      prismaMock.episodeCharacter.findMany.mockResolvedValue([])
      const result = await getEpisodesForCharacter('char-orphan')
      expect(result).toEqual([])
    })
  })

  describe('getEpisodesForLocation — junction is SoT', () => {
    it('一個 location 出現於多 episodes -> 回 episodes 陣列', async () => {
      prismaMock.episodeLocation.findMany.mockResolvedValue([
        { episode: { id: 'ep-1', episodeNumber: 1, name: '第 1 集' } },
        { episode: { id: 'ep-5', episodeNumber: 5, name: '第 5 集' } },
      ])

      const result = await getEpisodesForLocation('loc-1')

      expect(result).toEqual([
        { id: 'ep-1', episodeNumber: 1, name: '第 1 集' },
        { id: 'ep-5', episodeNumber: 5, name: '第 5 集' },
      ])
      expect(prismaMock.episodeLocation.findMany).toHaveBeenCalledTimes(1)
      const arg = prismaMock.episodeLocation.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({ locationId: 'loc-1' })
    })

    it('location 不出現任何 episode -> 回空陣列', async () => {
      prismaMock.episodeLocation.findMany.mockResolvedValue([])
      const result = await getEpisodesForLocation('loc-orphan')
      expect(result).toEqual([])
    })
  })
})

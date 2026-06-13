import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 11.2 — storyboard helper 落庫時必須觸發 episode-asset-bridge
 *
 * 跑：`BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker/storyboard-junction.test.ts`
 *
 * 合約 (Q-1 A / Q-3 C)：
 *   - `persistStoryboardsAndPanels` 在 panel 落庫後必須呼叫:
 *       linkEpisodeCharactersFromPanel(tx, { ..., role: 'auto-from-panel' })
 *       linkEpisodeLocationFromPanel(tx, { ..., role: 'auto-from-panel' })
 *     並把所有 panel 中蒐集到的 character / location 名字傳進去（用 Set 去重）
 *   - 既有 storyboard 落庫流程不破壞 (return shape 對)
 */

type LinkCharactersArgs = {
  projectId: string
  episodeId: string
  panelCharacterNames: string[]
  role: string
}
type LinkCharactersResult = { matched: number; unmatched: string[]; ambiguous: string[] }
type LinkLocationArgs = {
  projectId: string
  episodeId: string
  locationName: string
  role: string
}
type LinkLocationResult = { matched: boolean; unmatched: boolean; ambiguous: boolean }

const linkEpisodeCharactersFromPanelMock = vi.hoisted(() =>
  vi.fn<(tx: unknown, args: LinkCharactersArgs) => Promise<LinkCharactersResult>>(
    async () => ({ matched: 1, unmatched: [], ambiguous: [] }),
  ),
)
const linkEpisodeLocationFromPanelMock = vi.hoisted(() =>
  vi.fn<(tx: unknown, args: LinkLocationArgs) => Promise<LinkLocationResult>>(
    async () => ({ matched: true, unmatched: false, ambiguous: false }),
  ),
)

// $transaction 模擬：直接執行 callback 並提供 tx mock
const txMock = vi.hoisted(() => ({
  novelPromotionStoryboard: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(),
  },
  novelPromotionPanel: {
    create: vi.fn(),
  },
  // 2026-06-03 — helper added a projectCharacterRoster findMany (12b89e1);
  // mock fell behind, crashing before the bridge assertions could run.
  novelPromotionCharacter: {
    findMany: vi.fn(async () => []),
  },
  // Phase 1.5C — helper fetches project generationMode to stamp
  // panelGenerationMode on every created panel.
  novelPromotionProject: {
    findUnique: vi.fn(async () => ({ generationMode: 'r2v-narrative' })),
  },
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/episode-asset-bridge', () => ({
  linkEpisodeCharactersFromPanel: linkEpisodeCharactersFromPanelMock,
  linkEpisodeLocationFromPanel: linkEpisodeLocationFromPanelMock,
}))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

import { persistStoryboardsAndPanels } from '@/lib/workers/handlers/script-to-storyboard-helpers'

describe('persistStoryboardsAndPanels — episode-asset-bridge integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // tx.novelPromotionPanel.create 回有 id 的 row
    let nextPanelId = 0
    txMock.novelPromotionPanel.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      nextPanelId += 1
      return {
        id: `panel-${nextPanelId}`,
        panelIndex: args.data.panelIndex,
        description: args.data.description,
        srtSegment: args.data.srtSegment,
        characters: args.data.characters,
      }
    })
    let nextStoryboardId = 0
    txMock.novelPromotionStoryboard.create.mockImplementation(
      async (args: { data: { clipId: string } }) => {
        nextStoryboardId += 1
        return { id: `storyboard-${nextStoryboardId}`, clipId: args.data.clipId }
      },
    )

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
    )

    linkEpisodeCharactersFromPanelMock.mockResolvedValue({ matched: 0, unmatched: [], ambiguous: [] })
    linkEpisodeLocationFromPanelMock.mockResolvedValue({ matched: false, unmatched: false, ambiguous: false })
  })

  it('panel 落庫後 -> linkEpisodeCharactersFromPanel 用 role=auto-from-panel + dedup 後的 character names 被呼叫', async () => {
    await persistStoryboardsAndPanels({
      projectId: 'proj-1',
      episodeId: 'ep-1',
      clipPanels: [
        {
          clipId: 'clip-1',
          clipIndex: 0,
          finalPanels: [
            // Panel 1: ['小明', '小紅']
            { characters: ['小明', '小紅'], location: '客廳', shot_type: 'cu', camera_move: 'static' },
            // Panel 2: ['小明'] - 重複的 '小明' 應被去重
            { characters: ['小明'], location: '街道', shot_type: 'wide', camera_move: 'pan' },
          ] as never[],
        },
      ],
    })

    // 必須恰好被呼叫 1 次（per-episode 一次性 sync，非 per-panel）
    expect(linkEpisodeCharactersFromPanelMock).toHaveBeenCalledTimes(1)
    const [tx, args] = linkEpisodeCharactersFromPanelMock.mock.calls[0]
    expect(tx).toBeDefined()
    expect(args.projectId).toBe('proj-1')
    expect(args.episodeId).toBe('ep-1')
    expect(args.role).toBe('auto-from-panel')
    expect(args.panelCharacterNames.sort()).toEqual(['小明', '小紅'].sort())
  })

  it('panel 落庫後 -> linkEpisodeLocationFromPanel 對每個 unique location 呼叫一次, role=auto-from-panel', async () => {
    await persistStoryboardsAndPanels({
      projectId: 'proj-1',
      episodeId: 'ep-1',
      clipPanels: [
        {
          clipId: 'clip-1',
          clipIndex: 0,
          finalPanels: [
            { characters: [], location: '客廳', shot_type: 'cu', camera_move: 'static' },
            { characters: [], location: '街道', shot_type: 'wide', camera_move: 'pan' },
            { characters: [], location: '客廳', shot_type: 'medium', camera_move: 'static' }, // 重複
          ] as never[],
        },
      ],
    })

    // 兩個 unique location → 呼叫 2 次
    expect(linkEpisodeLocationFromPanelMock).toHaveBeenCalledTimes(2)
    const callArgs = linkEpisodeLocationFromPanelMock.mock.calls.map(
      (c: [unknown, { locationName: string; role: string }]) => c[1],
    )
    const locNames = callArgs.map((a) => a.locationName).sort()
    expect(locNames).toEqual(['客廳', '街道'].sort())

    // 全部都帶 role='auto-from-panel'
    for (const arg of callArgs) {
      expect(arg.role).toBe('auto-from-panel')
    }
  })

  it('沒任何 character / location -> bridge 完全不被呼叫', async () => {
    await persistStoryboardsAndPanels({
      projectId: 'proj-1',
      episodeId: 'ep-1',
      clipPanels: [
        {
          clipId: 'clip-1',
          clipIndex: 0,
          finalPanels: [
            { characters: [], location: null, shot_type: 'cu', camera_move: 'static' },
          ] as never[],
        },
      ],
    })

    expect(linkEpisodeCharactersFromPanelMock).not.toHaveBeenCalled()
    expect(linkEpisodeLocationFromPanelMock).not.toHaveBeenCalled()
  })

  it('成功路徑: 既有 storyboard 落庫 return shape (storyboardId / clipId / panels) 不破壞', async () => {
    const result = await persistStoryboardsAndPanels({
      projectId: 'proj-1',
      episodeId: 'ep-1',
      clipPanels: [
        {
          clipId: 'clip-A',
          clipIndex: 0,
          finalPanels: [
            { characters: ['小明'], location: '客廳', shot_type: 'cu', camera_move: 'static' },
          ] as never[],
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      storyboardId: 'storyboard-1',
      clipId: 'clip-A',
    }))
    expect(result[0].panels).toHaveLength(1)
    expect(result[0].panels[0]).toEqual(expect.objectContaining({
      id: 'panel-1',
      panelIndex: 0,
    }))
  })

  it('bridge 拋錯 -> 整個 transaction 失敗（顯式失敗，不靜默吞錯）', async () => {
    linkEpisodeCharactersFromPanelMock.mockRejectedValueOnce(new Error('bridge boom'))

    await expect(persistStoryboardsAndPanels({
      projectId: 'proj-1',
      episodeId: 'ep-1',
      clipPanels: [
        {
          clipId: 'clip-1',
          clipIndex: 0,
          finalPanels: [
            { characters: ['小明'], location: null, shot_type: 'cu', camera_move: 'static' },
          ] as never[],
        },
      ],
    })).rejects.toThrow('bridge boom')
  })
})

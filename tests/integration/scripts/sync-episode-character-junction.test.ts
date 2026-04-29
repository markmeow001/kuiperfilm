import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 11.2 — scripts/migrations/sync-episode-character-junction.ts
 *
 * 一次性遷移腳本：scan 每個 NovelPromotionProject 的所有 panels，從 panel.characters
 * 與 panel.location 字段透過 bridge 的 Q-2 B match logic 寫入 EpisodeCharacter /
 * EpisodeLocation junction（role='auto-from-panel'）。
 *
 * - 預設 dry-run；--commit 才實際寫入
 * - --projectId=xxx 限定單一 Project (where: { projectId: xxx })
 * - 報告: { mode, projectsScanned, panelsScanned, charactersLinked, locationsLinked,
 *          unmatched, ambiguous, charactersInsertedRows, locationsInsertedRows }
 *
 * 該腳本在 import 時呼叫 main()，所以 test 必須:
 *   1) 先 mock prisma
 *   2) 設置 process.argv flags
 *   3) capture stdout
 *   4) await import (觸發 main)
 *   5) 等 main 跑完（用 prisma.$disconnect 的 mock 來探測完成）
 */

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findMany: vi.fn() },
  novelPromotionCharacter: { findMany: vi.fn() },
  novelPromotionLocation: { findMany: vi.fn() },
  novelPromotionEpisode: { findMany: vi.fn() },
  novelPromotionStoryboard: { findMany: vi.fn() },
  episodeCharacter: { createMany: vi.fn() },
  episodeLocation: { createMany: vi.fn() },
  $disconnect: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

interface ScriptSummary {
  mode: 'dry-run' | 'commit'
  projectsScanned: number
  panelsScanned: number
  charactersLinked: number
  locationsLinked: number
  unmatched: Array<{ kind: 'character' | 'location'; episodeId: string; name: string }>
  ambiguous: Array<{ kind: 'character' | 'location'; episodeId: string; name: string; candidates: string[] }>
  charactersInsertedRows: number
  locationsInsertedRows: number
}

const originalArgv = process.argv

async function runScriptWithArgs(extraArgs: string[]): Promise<ScriptSummary> {
  // 重置 modules，set argv，攔 stdout，等 main 完成（用 disconnect 當哨兵）
  vi.resetModules()
  process.argv = ['node', 'sync-episode-character-junction.ts', ...extraArgs]

  let stdoutBuf = ''
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdoutBuf += typeof chunk === 'string' ? chunk : chunk.toString()
    return true
  }) as typeof process.stdout.write

  let disconnectResolve: () => void = () => {}
  const disconnectDone = new Promise<void>((resolve) => { disconnectResolve = resolve })
  prismaMock.$disconnect.mockImplementation(async () => {
    disconnectResolve()
  })

  try {
    await import('@/scripts/migrations/sync-episode-character-junction')
    // 等 main().finally() 真的把 $disconnect 跑完
    await disconnectDone
    // 給 microtasks 時間 flush stdout
    await new Promise((r) => setImmediate(r))
  } finally {
    process.stdout.write = originalWrite
  }

  const trimmed = stdoutBuf.trim()
  if (!trimmed.startsWith('{')) {
    throw new Error(`expected JSON summary, got: ${trimmed.slice(0, 200)}`)
  }
  return JSON.parse(trimmed) as ScriptSummary
}

describe('scripts/migrations/sync-episode-character-junction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$disconnect.mockResolvedValue(undefined)

    // 預設：一個 project，一個 episode，一個 storyboard，一個 panel
    // panel.characters = ['小明']，panel.location = '客廳'
    prismaMock.novelPromotionProject.findMany.mockResolvedValue([
      { id: 'np-1', projectId: 'proj-1' },
    ])
    prismaMock.novelPromotionCharacter.findMany.mockResolvedValue([
      { id: 'char-1', name: '小明', aliases: null },
    ])
    prismaMock.novelPromotionLocation.findMany.mockResolvedValue([
      { id: 'loc-1', name: '客廳' },
    ])
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([{ id: 'ep-1' }])
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      {
        id: 'sb-1',
        panels: [
          { characters: JSON.stringify(['小明']), location: '客廳' },
        ],
      },
    ])
    prismaMock.episodeCharacter.createMany.mockResolvedValue({ count: 1 })
    prismaMock.episodeLocation.createMany.mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  it('dry-run (預設) -> mode=dry-run, 不呼叫 episodeCharacter.createMany / episodeLocation.createMany', async () => {
    const summary = await runScriptWithArgs([])

    expect(summary.mode).toBe('dry-run')
    expect(prismaMock.episodeCharacter.createMany).not.toHaveBeenCalled()
    expect(prismaMock.episodeLocation.createMany).not.toHaveBeenCalled()
  })

  it('--commit -> mode=commit, 呼叫 createMany 寫入 EpisodeCharacter + EpisodeLocation, role=auto-from-panel', async () => {
    const summary = await runScriptWithArgs(['--commit'])

    expect(summary.mode).toBe('commit')
    expect(prismaMock.episodeCharacter.createMany).toHaveBeenCalledTimes(1)
    const charArg = prismaMock.episodeCharacter.createMany.mock.calls[0][0]
    expect(charArg.skipDuplicates).toBe(true)
    expect(charArg.data).toEqual([
      { episodeId: 'ep-1', characterId: 'char-1', role: 'auto-from-panel' },
    ])

    expect(prismaMock.episodeLocation.createMany).toHaveBeenCalledTimes(1)
    const locArg = prismaMock.episodeLocation.createMany.mock.calls[0][0]
    expect(locArg.skipDuplicates).toBe(true)
    expect(locArg.data).toEqual([
      { episodeId: 'ep-1', locationId: 'loc-1', role: 'auto-from-panel' },
    ])
  })

  it('idempotent: 跑兩次 commit -> createMany 用 skipDuplicates 保證不重複插入', async () => {
    const r1 = await runScriptWithArgs(['--commit'])
    expect(r1.charactersLinked).toBe(1)
    expect(r1.locationsLinked).toBe(1)

    // 第二次：模擬 createMany 的 skipDuplicates 回 count=0（已存在）
    prismaMock.episodeCharacter.createMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.episodeLocation.createMany.mockResolvedValueOnce({ count: 0 })

    const r2 = await runScriptWithArgs(['--commit'])
    expect(r2.charactersLinked).toBe(1)
    expect(r2.locationsLinked).toBe(1)
    // 但實際插入的 row 數應該是 0
    expect(r2.charactersInsertedRows).toBe(0)
    expect(r2.locationsInsertedRows).toBe(0)
  })

  it('報告統計 (projectsScanned/panelsScanned/charactersLinked/locationsLinked) 正確', async () => {
    // 兩個 project，每個 project 一個 episode 一個 panel
    prismaMock.novelPromotionProject.findMany.mockResolvedValue([
      { id: 'np-1', projectId: 'proj-1' },
      { id: 'np-2', projectId: 'proj-2' },
    ])

    const summary = await runScriptWithArgs(['--commit'])

    expect(summary.projectsScanned).toBe(2)
    // panelsScanned: 每個 project 都跑一次 storyboard.findMany (回 1 panel)
    expect(summary.panelsScanned).toBe(2)
  })

  it('unmatched character name -> 加進 unmatched, 不寫入', async () => {
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      {
        id: 'sb-1',
        panels: [{ characters: JSON.stringify(['UnknownGuy']), location: null }],
      },
    ])

    const summary = await runScriptWithArgs(['--commit'])

    expect(summary.charactersLinked).toBe(0)
    expect(summary.unmatched).toContainEqual(
      expect.objectContaining({ kind: 'character', episodeId: 'ep-1', name: 'UnknownGuy' }),
    )
    // 沒中 -> createMany 不應被呼叫
    expect(prismaMock.episodeCharacter.createMany).not.toHaveBeenCalled()
  })

  it('ambiguous character name (兩個同名 character) -> 加進 ambiguous, 不寫入', async () => {
    prismaMock.novelPromotionCharacter.findMany.mockResolvedValue([
      { id: 'char-a', name: '小明', aliases: null },
      { id: 'char-b', name: '小明', aliases: null },
    ])
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      {
        id: 'sb-1',
        panels: [{ characters: JSON.stringify(['小明']), location: null }],
      },
    ])

    const summary = await runScriptWithArgs(['--commit'])

    expect(summary.charactersLinked).toBe(0)
    expect(summary.ambiguous).toContainEqual(
      expect.objectContaining({
        kind: 'character',
        episodeId: 'ep-1',
        name: '小明',
        candidates: expect.arrayContaining(['char-a', 'char-b']),
      }),
    )
    expect(prismaMock.episodeCharacter.createMany).not.toHaveBeenCalled()
  })

  it('--projectId=xxx -> findMany where 帶 projectId 限定單一 project', async () => {
    await runScriptWithArgs(['--projectId=proj-target'])

    expect(prismaMock.novelPromotionProject.findMany).toHaveBeenCalledTimes(1)
    const arg = prismaMock.novelPromotionProject.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ projectId: 'proj-target' })
  })

  it('panel.characters / panel.location 為 null -> 不加入任何 link', async () => {
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      {
        id: 'sb-1',
        panels: [{ characters: null, location: null }],
      },
    ])

    const summary = await runScriptWithArgs(['--commit'])

    expect(summary.charactersLinked).toBe(0)
    expect(summary.locationsLinked).toBe(0)
    expect(prismaMock.episodeCharacter.createMany).not.toHaveBeenCalled()
    expect(prismaMock.episodeLocation.createMany).not.toHaveBeenCalled()
  })
})

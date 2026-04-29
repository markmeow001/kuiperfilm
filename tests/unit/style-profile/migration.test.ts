import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== Mocks =====

type ProjectRow = {
  id: string
  artStyle: string
  artStylePrompt: string | null
  stylePositivePrompt: string | null
  styleNegativePrompt: string | null
  styleReferenceImages: string | null
}

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findMany: vi.fn<() => Promise<ProjectRow[]>>(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
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
  logInfo: vi.fn((...args: unknown[]) => loggerMock.info(...args)),
  logWarn: vi.fn((...args: unknown[]) => loggerMock.warn(...args)),
  logError: vi.fn((...args: unknown[]) => loggerMock.error(...args)),
  createScopedLogger: vi.fn(() => loggerMock),
}))

// ===== Real import (after mocks). Implementer 应导出可被测试的 main 函数。
// scripts/ 不在 @/ 别名（@/ 仅映射 src/），所以走相对路径。
// implementer 进行中时该文件可能尚未存在 -> 测试 import error 是预期红，待实现完成后转绿。
import { migrateArtStyleToStyleProfile } from '../../../scripts/migrations/migrate-artstyle-to-style-profile'
import { STYLE_PROFILE_PRESETS } from '@/lib/style-profile/presets'

// Q-007 B fallback: mock `getArtStylePrompt` 让测试直接断言「fallback 字串确实进 stylePositivePrompt」
// 不是 false positive。
vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants')
  return {
    ...actual,
    getArtStylePrompt: vi.fn((artStyle: string | null | undefined, _locale: string) => {
      if (!artStyle) return ''
      // 模拟：xianxia → 有 fallback 字串；some-truly-unknown → 空字符串（→ skip 路径）
      if (artStyle === 'xianxia') return 'XIANXIA_FALLBACK_PROMPT'
      if (artStyle === 'ink-wash') return 'INK_WASH_FALLBACK_PROMPT'
      // 任何其他 unmapped artStyle 都返回空（触发 skip+warn 路径）
      return ''
    }),
  }
})

function buildRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'np-1',
    artStyle: 'american-comic',
    artStylePrompt: null,
    stylePositivePrompt: null,
    styleNegativePrompt: null,
    styleReferenceImages: null,
    ...overrides,
  }
}

// 取出最近一次 update 调用的 data 字段
function lastUpdateData(): Record<string, unknown> | undefined {
  const calls = prismaMock.novelPromotionProject.update.mock.calls
  if (calls.length === 0) return undefined
  const arg = calls[calls.length - 1]?.[0] as { data?: Record<string, unknown> }
  return arg?.data
}

describe('migrate-artstyle-to-style-profile script behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('artStyle = "american-comic" + artStylePrompt = "extra detail" -> stylePositivePrompt = preset.positivePrompt + "\\n\\n" + "extra detail", styleNegativePrompt = preset.negativePrompt', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-1', artStyle: 'american-comic', artStylePrompt: 'extra detail' }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    const data = lastUpdateData()
    expect(data).toBeDefined()
    expect(data?.stylePositivePrompt).toBe(
      `${STYLE_PROFILE_PRESETS['american-comic'].positivePrompt}\n\nextra detail`,
    )
    expect(data?.styleNegativePrompt).toBe(STYLE_PROFILE_PRESETS['american-comic'].negativePrompt)
  })

  it('artStyle = "american-comic" + artStylePrompt = null -> stylePositivePrompt = preset.positivePrompt（不带 trailing 分隔符）', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-1', artStyle: 'american-comic', artStylePrompt: null }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    const data = lastUpdateData()
    expect(data?.stylePositivePrompt).toBe(STYLE_PROFILE_PRESETS['american-comic'].positivePrompt)
  })

  it('已有 stylePositivePrompt（user 已编辑）-> skip 不覆盖', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({
        id: 'np-1',
        artStyle: 'american-comic',
        stylePositivePrompt: 'USER_EDITED',
      }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('未知 artStyle 值 -> log warn + skip 该 row + 不影响其他 row', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-bad', artStyle: 'completely-unknown-style' }),
      buildRow({ id: 'np-good', artStyle: 'anime' }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    // bad row 不被 update
    const updateCalls = prismaMock.novelPromotionProject.update.mock.calls
    const updatedIds = updateCalls.map((c) => (c[0] as { where?: { id?: string } }).where?.id)
    expect(updatedIds).not.toContain('np-bad')
    expect(updatedIds).toContain('np-good')
    // warn 应被呼叫
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('--dry-run 模式 -> 不写 DB，只 log 变更计画', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-1', artStyle: 'anime' }),
      buildRow({ id: 'np-2', artStyle: 'realistic' }),
    ])

    await migrateArtStyleToStyleProfile({ apply: false })

    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
    // 至少有 info log（说明计画）
    expect(loggerMock.info).toHaveBeenCalled()
  })

  it('两次跑结果相同（idempotent）：第二次跑时所有 row 都已 migrate 过 -> 全部 skip', async () => {
    // 第一次跑：原始 row（stylePositivePrompt 为 null）
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-1', artStyle: 'american-comic', artStylePrompt: 'detail' }),
    ])
    await migrateArtStyleToStyleProfile({ apply: true })
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledTimes(1)

    prismaMock.novelPromotionProject.update.mockClear()

    // 第二次跑：模拟数据已迁移（stylePositivePrompt 非 null）
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({
        id: 'np-1',
        artStyle: 'american-comic',
        artStylePrompt: 'detail',
        stylePositivePrompt: 'already-migrated',
        styleNegativePrompt: 'already-migrated-neg',
      }),
    ])
    await migrateArtStyleToStyleProfile({ apply: true })

    // 第二次跑应该完全 skip
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('多个 preset key 混合 -> 每个 row 都 map 到对应 preset', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-1', artStyle: 'realistic' }),
      buildRow({ id: 'np-2', artStyle: 'anime' }),
      buildRow({ id: 'np-3', artStyle: 'thick-paint' }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledTimes(3)

    const calls = prismaMock.novelPromotionProject.update.mock.calls
    for (const call of calls) {
      const arg = call[0] as { where: { id: string }; data: { stylePositivePrompt: string } }
      // 每个 update 的 stylePositivePrompt 必须非空字符串
      expect(typeof arg.data.stylePositivePrompt).toBe('string')
      expect(arg.data.stylePositivePrompt.length).toBeGreaterThan(0)
    }
  })

  // ============================================================
  // Q-007 B: Unmapped artStyle 用 getArtStylePrompt fallback 字串
  // ============================================================
  it('Q-007 B: artStyle = "xianxia" (unmapped) → 用 getArtStylePrompt fallback 写入 stylePositivePrompt', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-xianxia', artStyle: 'xianxia', artStylePrompt: null }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledTimes(1)
    const data = lastUpdateData()
    // Mock 的 getArtStylePrompt('xianxia', 'zh') = 'XIANXIA_FALLBACK_PROMPT'
    // → 实际写入的 stylePositivePrompt 必须包含这个 fallback marker
    expect(data?.stylePositivePrompt).toBe('XIANXIA_FALLBACK_PROMPT')
    // styleNegativePrompt 应为 null（fallback 没有 negative）
    expect(data?.styleNegativePrompt).toBeNull()
  })

  it('Q-007 B: artStyle = "xianxia" + artStylePrompt = "extra detail" → fallback 字串 + "\\n\\n" + extra detail', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({
        id: 'np-xianxia',
        artStyle: 'xianxia',
        artStylePrompt: 'extra detail',
      }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    const data = lastUpdateData()
    expect(data?.stylePositivePrompt).toBe('XIANXIA_FALLBACK_PROMPT\n\nextra detail')
  })

  it('Q-007 B: artStyle = "completely-unknown-style" (preset miss + getArtStylePrompt 也返回空) → skip + log warn', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-truly-unknown', artStyle: 'completely-unknown-style' }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
    // warn 内容必须提到那个 unknown artStyle
    const warnText = JSON.stringify(loggerMock.warn.mock.calls.flat())
    expect(warnText).toContain('completely-unknown-style')
  })

  it('Q-007 B: 混合 preset / fallback / skip 一次扫描 → 每个 row 走对应路径', async () => {
    prismaMock.novelPromotionProject.findMany.mockResolvedValueOnce([
      buildRow({ id: 'np-preset', artStyle: 'realistic' }),
      buildRow({ id: 'np-fallback', artStyle: 'xianxia' }),
      buildRow({ id: 'np-skip', artStyle: 'completely-unknown-style' }),
    ])

    await migrateArtStyleToStyleProfile({ apply: true })

    // 2 个 update（preset + fallback），1 个 skip
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledTimes(2)

    const updateCalls = prismaMock.novelPromotionProject.update.mock.calls
    const updatedById = new Map<string, Record<string, unknown>>()
    for (const c of updateCalls) {
      const arg = c[0] as { where: { id: string }; data: Record<string, unknown> }
      updatedById.set(arg.where.id, arg.data)
    }

    // np-preset 走 preset 路径 → 含 STYLE_PROFILE_PRESETS['realistic'].positivePrompt
    expect(updatedById.get('np-preset')?.stylePositivePrompt).toBe(
      STYLE_PROFILE_PRESETS['realistic'].positivePrompt,
    )
    // np-fallback 走 fallback 路径 → stylePositivePrompt = 'XIANXIA_FALLBACK_PROMPT'
    expect(updatedById.get('np-fallback')?.stylePositivePrompt).toBe('XIANXIA_FALLBACK_PROMPT')
    // np-skip 不在 update 结果中
    expect(updatedById.has('np-skip')).toBe(false)
    // skip 必须 log warn
    expect(loggerMock.warn).toHaveBeenCalled()
  })
})

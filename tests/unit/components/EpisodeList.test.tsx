import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Phase 11.1 — EpisodeList component test
 *
 * 跑：`npm run test:dom`（用 vitest.dom.config.ts，jsdom + @testing-library/react）
 *
 * 合約：
 *   - 渲染 N 集卡片 + 「+ 新增集」按鈕
 *   - 點集卡片 -> onEpisodeOpen(episodeId)
 *   - 點「+ 新增集」-> onEpisodeCreate()
 *   - 集 progress 顯示 done/total（未開始時顯示 notStartedLabel）
 *   - 統計徽章顯示集數 / 角色數 / 場景數
 */

// next-intl 在 jsdom 環境下不需真的 i18n provider，用 fixture
vi.mock('next-intl', () => ({
  useTranslations: (_namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.count !== 'undefined') {
      return `${key}:${values.count}`
    }
    return key
  },
}))

// AppIcon 是純展示，mock 成 span 簡化 DOM 斷言
vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className} />
  ),
}))

import EpisodeList, {
  type EpisodeWithProgress,
} from '@/app/[locale]/workspace/[projectId]/components/EpisodeList'

function makeEpisode(overrides: Partial<EpisodeWithProgress> = {}): EpisodeWithProgress {
  return {
    id: 'ep-1',
    episodeNumber: 1,
    name: 'Episode One',
    description: null,
    progress: {
      scriptDone: 0,
      scriptTotal: 0,
      storyboardDone: 0,
      storyboardTotal: 0,
      videoDone: 0,
      videoTotal: 0,
    },
    thumbnailUrl: null,
    ...overrides,
  }
}

interface RenderArgs {
  projectName?: string
  episodes?: EpisodeWithProgress[]
  characterCount?: number
  locationCount?: number
}

function renderList(args: RenderArgs = {}) {
  const onEpisodeOpen = vi.fn()
  const onEpisodeCreate = vi.fn()
  const onEpisodeRename = vi.fn().mockResolvedValue(undefined)
  const onEpisodeDelete = vi.fn().mockResolvedValue(undefined)
  const onOpenProjectSettings = vi.fn()

  render(
    <EpisodeList
      projectName={args.projectName ?? 'My Drama'}
      episodes={args.episodes ?? []}
      characterCount={args.characterCount ?? 0}
      locationCount={args.locationCount ?? 0}
      onEpisodeOpen={onEpisodeOpen}
      onEpisodeCreate={onEpisodeCreate}
      onEpisodeRename={onEpisodeRename}
      onEpisodeDelete={onEpisodeDelete}
      onOpenProjectSettings={onOpenProjectSettings}
    />,
  )

  return {
    onEpisodeOpen,
    onEpisodeCreate,
    onEpisodeRename,
    onEpisodeDelete,
    onOpenProjectSettings,
  }
}

describe('EpisodeList', () => {
  it('render 3 集 -> 顯示劇名 + 3 張卡片 + 「+ 新增集」按鈕', () => {
    const episodes = [
      makeEpisode({ id: 'ep-1', episodeNumber: 1, name: '第 1 集' }),
      makeEpisode({ id: 'ep-2', episodeNumber: 2, name: '第 2 集' }),
      makeEpisode({ id: 'ep-3', episodeNumber: 3, name: '第 3 集' }),
    ]

    renderList({ projectName: 'Knife Edge', episodes })

    // 劇名
    expect(screen.getByRole('heading', { name: 'Knife Edge' })).toBeInTheDocument()

    // 3 張卡片：用集名作 anchor
    expect(screen.getByText('第 1 集')).toBeInTheDocument()
    expect(screen.getByText('第 2 集')).toBeInTheDocument()
    expect(screen.getByText('第 3 集')).toBeInTheDocument()

    // 「+ 新增集」按鈕（key: addEpisode）
    expect(screen.getByText('addEpisode')).toBeInTheDocument()
  })

  it('點集卡片 -> onEpisodeOpen(episodeId)', () => {
    const episodes = [
      makeEpisode({ id: 'ep-7', episodeNumber: 1, name: '集 7' }),
      makeEpisode({ id: 'ep-8', episodeNumber: 2, name: '集 8' }),
    ]
    const { onEpisodeOpen } = renderList({ episodes })

    fireEvent.click(screen.getByText('集 8'))

    expect(onEpisodeOpen).toHaveBeenCalledTimes(1)
    expect(onEpisodeOpen).toHaveBeenCalledWith('ep-8')
  })

  it('點「+ 新增集」按鈕 -> onEpisodeCreate, 不誤觸 onEpisodeOpen', () => {
    const { onEpisodeCreate, onEpisodeOpen } = renderList({
      episodes: [makeEpisode({ id: 'ep-1', name: 'A' })],
    })

    fireEvent.click(screen.getByText('addEpisode'))

    expect(onEpisodeCreate).toHaveBeenCalledTimes(1)
    // 確保按錯按鈕不會 fallthrough 觸發到 episode open
    expect(onEpisodeOpen).not.toHaveBeenCalled()
  })

  it('集 progress 部分完成 (3/5 panels) -> 顯示包含 "3" 與 "5" 的文字', () => {
    const episodes = [
      makeEpisode({
        id: 'ep-1',
        episodeNumber: 1,
        name: 'with progress',
        progress: {
          scriptDone: 1,
          scriptTotal: 2,
          storyboardDone: 3,
          storyboardTotal: 5,
          videoDone: 0,
          videoTotal: 5,
        },
      }),
    ]
    renderList({ episodes })

    // storyboardDone:3 / storyboardTotal:5 必須出現
    expect(screen.getByText('3/5')).toBeInTheDocument()
    // scriptDone:1 / scriptTotal:2 也要出現
    expect(screen.getByText('1/2')).toBeInTheDocument()
    // videoDone:0 / videoTotal:5
    expect(screen.getByText('0/5')).toBeInTheDocument()
  })

  it('集 progress total 為 0 -> 顯示 notStartedLabel (key: progressNotStarted)', () => {
    const episodes = [
      makeEpisode({
        id: 'ep-empty',
        progress: {
          scriptDone: 0,
          scriptTotal: 0,
          storyboardDone: 0,
          storyboardTotal: 0,
          videoDone: 0,
          videoTotal: 0,
        },
      }),
    ]
    renderList({ episodes })

    // 三條 bar 應顯示 progressNotStarted（即「未開始」）
    const notStarted = screen.getAllByText('progressNotStarted')
    expect(notStarted.length).toBe(3)
  })

  it('統計徽章: 3 集 / 5 角色 / 7 場景 -> 各自顯示對應 count', () => {
    const episodes = [
      makeEpisode({ id: 'ep-1', name: 'A' }),
      makeEpisode({ id: 'ep-2', name: 'B' }),
      makeEpisode({ id: 'ep-3', name: 'C' }),
    ]
    renderList({ episodes, characterCount: 5, locationCount: 7 })

    // mocked t: returns `${key}:${values.count}` when values.count exists
    expect(screen.getByText('episodeCountLabel:3')).toBeInTheDocument()
    expect(screen.getByText('characterCountLabel:5')).toBeInTheDocument()
    expect(screen.getByText('locationCountLabel:7')).toBeInTheDocument()
  })

  it('集有 thumbnailUrl -> 渲染 <img src=...>', () => {
    const episodes = [
      makeEpisode({
        id: 'ep-1',
        name: 'with thumb',
        thumbnailUrl: 'https://cdn.example/thumb.png',
      }),
    ]
    renderList({ episodes })

    const img = screen.getByRole('img', { name: 'with thumb' }) as HTMLImageElement
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://cdn.example/thumb.png')
  })

  it('集無 thumbnailUrl -> 顯示 fallback film icon, 不渲染 <img>', () => {
    const episodes = [
      makeEpisode({ id: 'ep-1', name: 'no thumb', thumbnailUrl: null }),
    ]
    renderList({ episodes })

    // fallback icon 出現
    expect(screen.getByTestId('icon-film')).toBeInTheDocument()
    // 不應有 <img alt="no thumb">
    expect(screen.queryByRole('img', { name: 'no thumb' })).toBeNull()
  })

  it('點 ProjectSettings 按鈕 -> onOpenProjectSettings, 不誤觸 onEpisodeOpen', () => {
    const { onOpenProjectSettings, onEpisodeOpen } = renderList({
      episodes: [makeEpisode({ id: 'ep-1', name: 'A' })],
    })

    fireEvent.click(screen.getByText('projectSettings'))

    expect(onOpenProjectSettings).toHaveBeenCalledTimes(1)
    expect(onEpisodeOpen).not.toHaveBeenCalled()
  })
})

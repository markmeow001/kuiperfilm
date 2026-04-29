import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Phase 11.1 — EpisodeTabBar component test
 *
 * 跑：`npm run test:dom`
 *
 * 合約：
 *   - render N 個 episode tab → 每個都顯示
 *   - 點某個 tab → onSelect(episodeId)
 *   - currentId 對應 tab 有 active 高亮 (我們以 active underline span 為信號)
 *   - 點「+ 新建集」→ onAdd()
 *   - 點劇名 → 跳 projectHref（透過 <a href> 斷言，不假設 router）
 */

// Mock next-intl: 回傳 key 本身或 key:count
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.count !== 'undefined') {
      return `${key}:${values.count}`
    }
    return key
  },
}))

// Mock next/link: 回傳同樣的 anchor
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    title,
  }: {
    href: string
    children: React.ReactNode
    className?: string
    title?: string
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}))

// Mock AppIcon
vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className} />
  ),
}))

import EpisodeTabBar, {
  type EpisodeTabItem,
} from '@/components/ui/EpisodeTabBar'

function makeEpisodes(count: number): EpisodeTabItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `episode-${i + 1}`,
    title: `第 ${i + 1} 集`,
    episodeNumber: i + 1,
  }))
}

interface RenderArgs {
  episodes?: EpisodeTabItem[]
  currentId?: string
  projectName?: string
  projectHref?: string
}

function renderTabBar(args: RenderArgs = {}) {
  const onSelect = vi.fn()
  const onAdd = vi.fn()
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const episodes = args.episodes ?? makeEpisodes(5)

  render(
    <EpisodeTabBar
      projectName={args.projectName ?? 'Drama'}
      projectHref={args.projectHref ?? '/workspace/proj-1'}
      episodes={episodes}
      currentId={args.currentId ?? episodes[0]?.id ?? ''}
      onSelect={onSelect}
      onAdd={onAdd}
      onRename={onRename}
      onDelete={onDelete}
    />,
  )

  return { onSelect, onAdd, onRename, onDelete, episodes }
}

describe('EpisodeTabBar', () => {
  it('render 5 個 episode tabs -> 5 個集名都在 DOM', () => {
    renderTabBar({ episodes: makeEpisodes(5) })

    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByText(`第 ${i} 集`)).toBeInTheDocument()
    }
  })

  it('點第 3 個 tab -> onSelect("episode-3")', () => {
    const { onSelect } = renderTabBar({
      episodes: makeEpisodes(5),
      currentId: 'episode-1',
    })

    fireEvent.click(screen.getByText('第 3 集'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('episode-3')
  })

  it('currentId="episode-2" -> 對應 tab 有 active underline (gradient span)', () => {
    renderTabBar({
      episodes: makeEpisodes(3),
      currentId: 'episode-2',
    })

    // 用 data-tab-id 找到 episode-2 的容器
    const tab2 = document.querySelector('[data-tab-id="episode-2"]')
    expect(tab2).not.toBeNull()
    // active underline span: bg-gradient-to-r 的 absolute span
    const underline = tab2?.querySelector('span.absolute.bg-gradient-to-r')
    expect(underline).not.toBeNull()

    // 非 active tab 不應有 underline
    const tab1 = document.querySelector('[data-tab-id="episode-1"]')
    expect(tab1?.querySelector('span.absolute.bg-gradient-to-r')).toBeNull()
  })

  it('點「+ 新建集」按鈕 -> onAdd()', () => {
    const { onAdd, onSelect } = renderTabBar({ episodes: makeEpisodes(2) })

    // newEpisode 按鈕 (key: newEpisode)
    const buttons = screen.getAllByText('newEpisode')
    // 過濾出 button (title + label 兩個 newEpisode；找 button 元素)
    const addButton = buttons.find((node) => node.closest('button'))?.closest('button')
    expect(addButton).not.toBeNull()

    fireEvent.click(addButton!)

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('劇名連結 href = projectHref', () => {
    renderTabBar({
      projectName: 'Knife Edge',
      projectHref: '/zh/workspace/proj-42',
    })

    const link = screen.getByText('Knife Edge').closest('a')
    expect(link).not.toBeNull()
    expect(link).toHaveAttribute('href', '/zh/workspace/proj-42')
  })

  it('episodeNumber 顯示為 tab 內標號', () => {
    renderTabBar({ episodes: makeEpisodes(3) })

    // 每個 tab 應該包含 episodeNumber 文字（mock 後 t() 不轉換 number）
    for (let i = 1; i <= 3; i += 1) {
      const tab = document.querySelector(`[data-tab-id="episode-${i}"]`)
      expect(tab?.textContent).toContain(String(i))
    }
  })
})

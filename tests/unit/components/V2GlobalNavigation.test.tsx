import type { ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigationMock = vi.hoisted(() => ({
  pathname: '/zh/v2',
}))

const translations: Record<string, string> = {
  primaryNav: '主要工具',
  mobileNav: '行動版主要工具',
  productionGroup: '製作',
  creativeLabGroup: '創作實驗室',
  accountTeamGroup: '帳號與團隊',
  projects: '專案',
  projectsLabel: '專案總覽',
  new: '建立',
  newLabel: '建立新專案',
  jobs: '任務',
  jobsLabel: '生成任務中心',
  assets: '素材',
  assetsLabel: '素材庫',
  canvas: '畫布',
  canvasLabel: '無限畫布',
  playground: '創作',
  playgroundLabel: '創作 Playground',
  visualDevelopment: '角色',
  visualDevelopmentLabel: '角色視覺開發',
  composite: '重製',
  compositeLabel: 'AI 實拍重製',
  skills: '技能',
  skillsLabel: 'Skill 庫',
  workspaces: '工作區',
  workspacesLabel: '工作區與團隊',
  settings: '設定',
  settingsLabel: '設定中心',
  more: '更多',
  moreLabel: '開啟更多工具',
  morePanel: '更多工具',
}

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMock.pathname,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => translations[key] ?? key,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/v2/ProductionBrand', () => ({
  ProductionBrand: () => <span>Kuiper</span>,
}))

import { V2HomeRail } from '@/app/[locale]/v2/V2HomeRail'

describe('V2 global navigation', () => {
  beforeEach(() => {
    navigationMock.pathname = '/zh/v2'
  })

  it('桌面導覽 -> 以製作、創作實驗室、帳號與團隊分組且所有路徑保留 locale', () => {
    render(<V2HomeRail locale="zh" />)

    const desktopNav = screen.getByRole('navigation', { name: '主要工具' })
    expect(within(desktopNav).getByRole('group', { name: '製作' })).toBeInTheDocument()
    expect(within(desktopNav).getByRole('group', { name: '創作實驗室' })).toBeInTheDocument()
    expect(within(desktopNav).getByRole('group', { name: '帳號與團隊' })).toBeInTheDocument()
    expect(within(desktopNav).getByRole('link', { name: '素材庫' })).toHaveAttribute(
      'href',
      '/zh/workspace/asset-hub',
    )
    expect(within(desktopNav).getByRole('link', { name: '工作區與團隊' })).toHaveAttribute(
      'href',
      '/zh/workspaces',
    )
    expect(within(desktopNav).getByRole('link', { name: '設定中心' })).toHaveAttribute(
      'href',
      '/zh/profile',
    )
  })

  it('手機導覽 -> 固定顯示 Projects、Create、Jobs、Assets、More 五項 44px 控制', () => {
    render(<V2HomeRail locale="zh" />)

    const mobileNav = screen.getByRole('navigation', { name: '行動版主要工具' })
    expect(within(mobileNav).getAllByRole('link')).toHaveLength(4)
    expect(within(mobileNav).getByRole('link', { name: '專案總覽' })).toHaveAttribute('href', '/zh/v2')
    expect(within(mobileNav).getByRole('link', { name: '建立新專案' })).toHaveAttribute('href', '/zh/v2/new')
    expect(within(mobileNav).getByRole('link', { name: '生成任務中心' })).toHaveAttribute('href', '/zh/v2/jobs')
    expect(within(mobileNav).getByRole('link', { name: '素材庫' })).toHaveAttribute('href', '/zh/workspace/asset-hub')

    for (const control of within(mobileNav).getAllByRole('link')) {
      expect(control).toHaveClass('min-h-11', 'min-w-11')
    }
    expect(within(mobileNav).getByRole('button', { name: '開啟更多工具' })).toHaveClass(
      'min-h-11',
      'min-w-11',
    )
  })

  it('手機 More -> 是 disclosure，Escape 關閉並把焦點還給觸發按鈕', () => {
    render(<V2HomeRail locale="zh" />)

    const moreButton = screen.getByRole('button', { name: '開啟更多工具' })
    moreButton.focus()
    fireEvent.click(moreButton)

    expect(moreButton).toHaveAttribute('aria-expanded', 'true')
    const morePanel = screen.getByRole('navigation', { name: '更多工具' })
    const firstMoreLink = within(morePanel).getByRole('link', { name: '無限畫布' })
    expect(firstMoreLink).toHaveAttribute(
      'href',
      '/zh/canvas',
    )
    expect(firstMoreLink).toHaveFocus()
    expect(within(morePanel).getByRole('link', { name: '工作區與團隊' })).toHaveAttribute(
      'href',
      '/zh/workspaces',
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('navigation', { name: '更多工具' })).not.toBeInTheDocument()
    expect(moreButton).toHaveFocus()
  })

  it('目前頁面位於更多工具 -> More 按鈕反映目前頁面', () => {
    navigationMock.pathname = '/zh/canvas'
    render(<V2HomeRail locale="zh" />)

    expect(screen.getByRole('button', { name: '開啟更多工具' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

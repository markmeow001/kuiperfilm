import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  EntityWorkstation,
  type EntityWorkstationCopy,
} from '@/app/[locale]/v2/workspace/[projectId]/subjects/EntityWorkstation'

const copy: EntityWorkstationCopy = {
  listTitle: '角色清單',
  searchLabel: '搜尋角色',
  searchPlaceholder: '輸入角色名稱',
  countLabel: '共 2 個角色',
  backToList: '返回角色清單',
  detailRegionLabel: '角色工作區',
  ready: '設定圖已準備',
  needsImage: '缺少設定圖',
  generating: '生成中',
  approved: '已定稿',
  readOnly: '唯讀',
  loadingTitle: '正在載入角色',
  loadingDescription: '取得角色與集數關聯。',
  emptyTitle: '本集還沒有角色',
  emptyDescription: '分析劇本或手動新增第一個角色。',
  errorTitle: '角色載入失敗',
  errorDescription: '既有內容沒有被修改。',
  staleTitle: '角色資料不是最新版本',
  staleDescription: '重新整理後再繼續。',
  permissionTitle: '目前是唯讀模式',
  permissionDescription: '請向專案擁有者申請編輯權限。',
  partialTitle: '部分角色缺少設定圖',
  partialDescription: '仍可先編輯已完成的角色。',
}

const items = [
  {
    id: 'char-1',
    name: '林真',
    caption: '主角',
    description: '調查記者',
    imageUrl: '/lin.jpg',
    isLocked: true,
  },
  {
    id: 'char-2',
    name: '周岳',
    caption: '配角',
    description: '攝影師',
    imageUrl: null,
  },
]

function renderWorkstation(
  overrides: Partial<
    ComponentProps<
      typeof EntityWorkstation<'character' | 'scene', (typeof items)[number]>
    >
  > = {},
) {
  const props: ComponentProps<
    typeof EntityWorkstation<'character' | 'scene', (typeof items)[number]>
  > = {
    eyebrow: '劇本拆解',
    title: '角色',
    description: '整理本集角色',
    tabs: [
      { id: 'character', label: '角色', count: 2 },
      { id: 'scene', label: '世界／場景', count: 1 },
    ],
    activeTab: 'character',
    onTabChange: vi.fn(),
    items,
    renderDetail: (item) => <p>目前編輯：{item.name}</p>,
    copy,
    ...overrides,
  }
  return render(<EntityWorkstation {...props} />)
}

describe('EntityWorkstation', () => {
  it('選取清單項目 -> 工作區顯示正確實體並保留 aria selection', () => {
    renderWorkstation()

    const pageHeading = screen.getByRole('heading', { level: 1, name: '角色' })
    expect(pageHeading.closest('[class*="studioRoot"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /周岳/ }))

    expect(screen.getByText('目前編輯：周岳')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /周岳/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('切換 entity tab -> 回傳指定 tab id', () => {
    const onTabChange = vi.fn()
    renderWorkstation({ onTabChange })

    fireEvent.click(screen.getByRole('tab', { name: /世界／場景/ }))
    expect(onTabChange).toHaveBeenLastCalledWith('scene')
  })

  it('分頁使用完整 tab/tabpanel 關聯與 roving tabIndex', () => {
    renderWorkstation()

    const tabList = screen.getByRole('tablist', { name: '劇本拆解' })
    const characterTab = screen.getByRole('tab', { name: /角色/ })
    const sceneTab = screen.getByRole('tab', { name: /世界／場景/ })
    const panel = screen.getByRole('tabpanel')

    expect(tabList).toHaveAttribute('aria-orientation', 'horizontal')
    expect(characterTab).toHaveAttribute('tabindex', '0')
    expect(sceneTab).toHaveAttribute('tabindex', '-1')
    expect(characterTab).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', characterTab.id)
    expect(
      document.getElementById(sceneTab.getAttribute('aria-controls') ?? ''),
    ).toHaveAttribute('hidden')
    expect(characterTab).toHaveClass('min-h-11', 'min-w-11')
  })

  it('左右方向鍵會循環移動焦點並啟用目標分頁', () => {
    const onTabChange = vi.fn()
    renderWorkstation({ onTabChange })

    const characterTab = screen.getByRole('tab', { name: /角色/ })
    const sceneTab = screen.getByRole('tab', { name: /世界／場景/ })

    characterTab.focus()
    fireEvent.keyDown(characterTab, { key: 'ArrowRight' })
    expect(sceneTab).toHaveFocus()
    expect(onTabChange).toHaveBeenLastCalledWith('scene')

    characterTab.focus()
    fireEvent.keyDown(characterTab, { key: 'ArrowLeft' })
    expect(sceneTab).toHaveFocus()
    expect(onTabChange).toHaveBeenLastCalledWith('scene')
  })

  it('權限拒絕 -> 顯示 permission state 且不渲染 entity list', () => {
    renderWorkstation({ accessDenied: true })

    expect(screen.getByRole('alert')).toHaveTextContent('目前是唯讀模式')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('有舊資料但重新整理失敗 -> 顯示 stale 提示並維持既有工作區', () => {
    renderWorkstation({ error: true, stale: true })

    expect(screen.getByText('角色資料不是最新版本')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('目前編輯：林真')).toBeInTheDocument()
  })

  it('部分實體缺圖 -> 顯示 partial 說明與文字狀態', () => {
    renderWorkstation({ missingImageCount: 1 })

    expect(screen.getByText('部分角色缺少設定圖')).toBeInTheDocument()
    expect(screen.getAllByText('缺少設定圖').length).toBeGreaterThan(0)
  })

  it('唯讀 viewer -> 顯示明確的唯讀狀態但仍可檢視資料', () => {
    renderWorkstation({ readOnly: true })

    expect(screen.getByRole('alert')).toHaveTextContent('目前是唯讀模式')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('目前編輯：林真')).toBeInTheDocument()
    expect(screen.getByText('唯讀')).toBeInTheDocument()
  })

  it('English locale -> 狀態面板使用英文預設標籤', () => {
    renderWorkstation({ locale: 'en', readOnly: true })

    expect(screen.getByText('Permission required')).toBeInTheDocument()
  })
})

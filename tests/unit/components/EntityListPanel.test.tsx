import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EntityListPanel } from '@/components/v2/EntityListPanel'

interface ProjectItem {
  id: string
  name: string
  stage: string
}

const PROJECTS: readonly ProjectItem[] = [
  { id: 'project-1', name: '春日車站', stage: '劇本' },
  { id: 'project-2', name: '海邊旅館', stage: '分鏡' },
]

function renderProjectItem({
  item,
  selected,
}: {
  item: ProjectItem
  selected: boolean
  query: string
}) {
  return (
    <div>
      <strong>{item.name}</strong>
      <span>{item.stage}</span>
      {selected ? <span>目前選取</span> : null}
    </div>
  )
}

describe('EntityListPanel', () => {
  it('輸入搜尋字詞 -> 只顯示符合項目並保留清單狀態文字', () => {
    render(
      <EntityListPanel
        title="專案"
        items={PROJECTS}
        getItemId={(item) => item.id}
        getSearchText={(item) => `${item.name} ${item.stage}`}
        renderItem={renderProjectItem}
        statusText="共 2 個專案"
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋清單' }), {
      target: { value: '分鏡' },
    })

    expect(screen.queryByText('春日車站')).not.toBeInTheDocument()
    expect(screen.getByText('海邊旅館')).toBeInTheDocument()
    expect(screen.getByText('共 2 個專案')).toBeInTheDocument()
  })

  it('搜尋沒有結果 -> 顯示 filter-empty slot，而不是初始 empty slot', () => {
    render(
      <EntityListPanel
        title="角色"
        items={PROJECTS}
        getItemId={(item) => item.id}
        getSearchText={(item) => item.name}
        renderItem={renderProjectItem}
        defaultSearchValue="不存在"
        emptySlot={<p>尚未建立角色</p>}
        filterEmptySlot={<p>請調整搜尋條件</p>}
      />,
    )

    expect(screen.getByText('請調整搜尋條件')).toBeInTheDocument()
    expect(screen.queryByText('尚未建立角色')).not.toBeInTheDocument()
  })

  it('按 Enter 選取項目 -> 回傳正確實體並標示 selected item', () => {
    const onSelect = vi.fn<(item: ProjectItem) => void>()
    const { rerender } = render(
      <EntityListPanel
        title="專案"
        items={PROJECTS}
        getItemId={(item) => item.id}
        getSearchText={(item) => item.name}
        renderItem={renderProjectItem}
        selectedId="project-1"
        onSelect={onSelect}
      />,
    )

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(options[1], { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(PROJECTS[1])

    rerender(
      <EntityListPanel
        title="專案"
        items={PROJECTS}
        getItemId={(item) => item.id}
        getSearchText={(item) => item.name}
        renderItem={renderProjectItem}
        selectedId="project-2"
        onSelect={onSelect}
      />,
    )
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('載入中 -> 顯示 loading slot 且不渲染實體列', () => {
    render(
      <EntityListPanel
        title="場景"
        items={PROJECTS}
        getItemId={(item) => item.id}
        getSearchText={(item) => item.name}
        renderItem={renderProjectItem}
        loading
        loadingSlot={<p>正在取得場景</p>}
      />,
    )

    expect(screen.getByText('正在取得場景')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})

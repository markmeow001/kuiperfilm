import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { SubjectGrid } from '@/app/[locale]/v2/workspace/[projectId]/subjects/SubjectGrid'
import type { SubjectItem } from '@/app/[locale]/v2/workspace/[projectId]/subjects/subjects-client-helpers'

function buildItem(overrides: Partial<SubjectItem> = {}): SubjectItem {
  return {
    id: 'character-1',
    targetId: 'appearance-1',
    name: '林真',
    caption: '主角',
    description: '调查记者',
    imageUrl: null,
    ...overrides,
  }
}

describe('SubjectGrid workstation presentation', () => {
  it('缺少设定图且可生成 -> 点击媒体区送出目前 entity 的生成动作', () => {
    const onRegenerate = vi.fn()
    render(
      <SubjectGrid
        items={[buildItem({ onRegenerate })]}
        emptyHint="本集还没有角色"
        layout="detail"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /generateOne/ }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('选择有图角色的编辑入口 -> 打开该 entity 既有编辑器', () => {
    const onOpenEditor = vi.fn()
    render(
      <SubjectGrid
        items={[buildItem({ imageUrl: '/character.jpg', onOpenEditor })]}
        emptyHint="本集还没有角色"
        layout="detail"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '林真' }))
    expect(onOpenEditor).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img', { name: '林真' })).toHaveAttribute('src', '/character.jpg')
  })

  it('有圖且可預覽 -> 縮圖是可鍵盤操作的 button 並送出圖片網址', () => {
    const onZoom = vi.fn()
    render(
      <SubjectGrid
        items={[buildItem({ imageUrl: '/character.jpg', onZoom })]}
        emptyHint="本集还没有角色"
        layout="detail"
      />,
    )

    const previewButton = screen.getByRole('button', { name: '圖片預覽：林真' })
    previewButton.focus()
    expect(previewButton).toHaveFocus()

    fireEvent.click(previewButton)
    expect(onZoom).toHaveBeenCalledWith('/character.jpg')
  })

  it('空清单 -> 显示明确下一步与传入的主要动作', () => {
    const onCreate = vi.fn()
    render(
      <SubjectGrid
        items={[]}
        emptyHint="本集还没有道具"
        emptyAction={<button onClick={onCreate}>手动新增道具</button>}
      />,
    )

    expect(screen.getByText('本集还没有道具')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '手动新增道具' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('唯讀 entity 不传 mutation callbacks -> 不显示编辑、生成、上传或定稿入口', () => {
    render(
      <SubjectGrid
        items={[buildItem({ imageUrl: '/character.jpg' })]}
        emptyHint="本集还没有角色"
        layout="detail"
      />,
    )

    expect(screen.getByRole('button', { name: '林真' })).toBeDisabled()
    expect(screen.queryByText('editButton')).not.toBeInTheDocument()
    expect(screen.queryByText('regenerate')).not.toBeInTheDocument()
    expect(screen.queryByText('uploadReplaceLabel')).not.toBeInTheDocument()
    expect(screen.queryByText('lock')).not.toBeInTheDocument()
  })

  it('角色 A 定稿中 -> 只停用角色 A，角色 B 仍可標記定稿', () => {
    const finalizeA = vi.fn()
    const finalizeB = vi.fn()
    render(
      <SubjectGrid
        items={[
          buildItem({ id: 'character-a', name: '角色 A', imageUrl: '/a.jpg', onLock: finalizeA, isLocking: true }),
          buildItem({ id: 'character-b', name: '角色 B', imageUrl: '/b.jpg', onLock: finalizeB, isLocking: false }),
        ]}
        emptyHint="本集还没有角色"
      />,
    )

    expect(screen.getByRole('button', { name: 'locking' })).toBeDisabled()
    const finalizeBButton = screen.getByRole('button', { name: 'lock' })
    expect(finalizeBButton).toBeEnabled()
    fireEvent.click(finalizeBButton)
    expect(finalizeA).not.toHaveBeenCalled()
    expect(finalizeB).toHaveBeenCalledTimes(1)
  })

  it('角色 A 定稿失敗 -> 只在角色 A 顯示錯誤並可獨立重試', () => {
    const retryA = vi.fn()
    render(
      <SubjectGrid
        items={[
          buildItem({
            id: 'character-a',
            name: '角色 A',
            imageUrl: '/a.jpg',
            onLock: retryA,
            lockError: '連線中斷',
          }),
          buildItem({ id: 'character-b', name: '角色 B', imageUrl: '/b.jpg' }),
        ]}
        emptyHint="本集还没有角色"
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('連線中斷')
    fireEvent.click(screen.getByRole('button', { name: 'retryLock' }))
    expect(retryA).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('本集造型綁定失效 -> 顯示明確錯誤且沒有角色圖片 mutation 入口', () => {
    render(
      <SubjectGrid
        items={[
          buildItem({
            imageUrl: '/last-known.jpg',
            appearanceStatus: {
              label: '本集綁定的造型已不存在，請修正綁定後再操作',
              tone: 'error',
            },
          }),
        ]}
        emptyHint="本集還沒有角色"
        layout="detail"
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('本集綁定的造型已不存在')
    expect(screen.queryByText('regenerate')).not.toBeInTheDocument()
    expect(screen.queryByText('uploadReplaceLabel')).not.toBeInTheDocument()
    expect(screen.queryByText('redescribe')).not.toBeInTheDocument()
  })
})

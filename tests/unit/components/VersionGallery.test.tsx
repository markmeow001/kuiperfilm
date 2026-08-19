import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  VersionGallery,
  type VersionGalleryVersion,
} from '@/components/v2/VersionGallery'

interface TestVersion extends VersionGalleryVersion {
  assetUrl: string
}

const versions: TestVersion[] = [
  {
    id: 'v-1',
    name: '角色定臉 v1',
    meta: '2026-08-08 · 導演台',
    assetUrl: '/assets/v1.webp',
    locked: true,
    approved: true,
  },
  {
    id: 'v-2',
    name: '角色定臉 v2',
    assetUrl: '/assets/v2.webp',
    stale: true,
  },
]

describe('VersionGallery', () => {
  it('使用真實版本 props 與 preview renderer，不建立假資料', () => {
    const renderPreview = vi.fn((version: TestVersion) => (
      <span>{version.assetUrl}</span>
    ))

    render(
      <VersionGallery
        versions={versions}
        selectedId="v-1"
        renderPreview={renderPreview}
      />,
    )

    expect(screen.getByText('角色定臉 v1')).toBeInTheDocument()
    expect(screen.getByText('/assets/v1.webp')).toBeInTheDocument()
    expect(screen.getByText('/assets/v2.webp')).toBeInTheDocument()
    expect(renderPreview).toHaveBeenCalledTimes(2)
  })

  it('用文字同時標示選取、鎖定、核准與過期狀態', () => {
    render(
      <VersionGallery
        versions={versions}
        selectedId="v-1"
        renderPreview={(version) => <span>{version.id}</span>}
      />,
    )

    expect(screen.getByText('已選取')).toBeInTheDocument()
    expect(screen.getByText('已鎖定')).toBeInTheDocument()
    expect(screen.getByText('已核准')).toBeInTheDocument()
    expect(screen.getByText('需更新')).toBeInTheDocument()
    expect(screen.getByText('目前版本')).toBeInTheDocument()
  })

  it('核准與鎖定使用 editorial gold，過期仍維持 warning 語意', () => {
    render(
      <VersionGallery
        versions={versions}
        selectedId="v-1"
        renderPreview={(version) => <span>{version.id}</span>}
      />,
    )

    expect(screen.getByText('已鎖定').className).toContain('production-gold')
    expect(screen.getByText('已核准').className).toContain('production-gold')
    expect(screen.getByText('需更新').className).not.toContain('production-gold')
  })

  it('觸發受控選取回呼，且按鈕符合 44px 觸控高度', () => {
    const onSelect = vi.fn()

    render(
      <VersionGallery
        versions={versions}
        selectedId="v-1"
        onSelect={onSelect}
        renderPreview={(version) => <span>{version.id}</span>}
      />,
    )

    const selectButton = screen.getByRole('button', { name: '選擇版本' })
    expect(selectButton).toHaveClass('min-h-11')
    fireEvent.click(selectButton)
    expect(onSelect).toHaveBeenCalledWith(versions[1])

    const currentButton = screen.getByRole('button', { name: '目前版本' })
    expect(currentButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('允許深色 editor 外觀與每個版本的操作插槽', () => {
    render(
      <VersionGallery
        versions={[versions[0]]}
        appearance="editor"
        renderPreview={(version) => <span>{version.id}</span>}
        renderActions={(version) => (
          <button type="button">下載 {version.id}</button>
        )}
      />,
    )

    expect(
      screen.getByRole('button', { name: '下載 v-1' }).parentElement,
    ).toHaveClass('[&_button]:min-h-11')
  })

  it('沒有版本時顯示誠實的空狀態，也可由呼叫端取代', () => {
    const { rerender } = render(
      <VersionGallery<TestVersion>
        versions={[]}
        renderPreview={(version) => <span>{version.id}</span>}
      />,
    )

    expect(screen.getByText('尚無版本')).toBeInTheDocument()
    expect(screen.getByText(/產生或上傳第一個版本/)).toBeInTheDocument()

    rerender(
      <VersionGallery<TestVersion>
        versions={[]}
        emptyState={<div>此專案尚未建立版本</div>}
        renderPreview={(version) => <span>{version.id}</span>}
      />,
    )

    expect(screen.getByText('此專案尚未建立版本')).toBeInTheDocument()
  })

  it('英文 locale 與預覽用途標籤 -> 不暗示已持久化選取', () => {
    render(
      <VersionGallery
        versions={versions}
        locale="en"
        selectedId="v-1"
        onSelect={() => undefined}
        labels={{ current: 'Previewing', select: 'Preview version' }}
        renderPreview={(version) => <span>{version.id}</span>}
      />,
    )

    expect(screen.getByText('Selected')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Previewing' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Preview version' }),
    ).toBeInTheDocument()
  })
})

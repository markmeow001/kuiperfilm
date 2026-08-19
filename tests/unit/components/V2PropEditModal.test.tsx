import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { V2PropEditModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2PropEditModal'

describe('V2PropEditModal responsive layout', () => {
  it('窄螢幕開啟道具編輯 -> 圖片與表單先單欄、sm 以上才切雙欄', () => {
    const { container } = render(
      <V2PropEditModal
        prop={{ id: 'prop-1', name: '銀劍', summary: '狼頭劍柄' }}
        imageUrl="/sword.jpg"
        onClose={vi.fn()}
        onZoomImage={vi.fn()}
        onSaveName={vi.fn()}
        onSaveSummary={vi.fn()}
        isSavingName={false}
        isSavingSummary={false}
        onRegenerate={vi.fn()}
        onUploadFile={vi.fn()}
        isRegenerating={false}
        isUploading={false}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    )

    const responsiveGrid = container.querySelector('.grid.grid-cols-1')
    expect(responsiveGrid).toHaveClass('sm:grid-cols-[200px_minmax(0,1fr)]')
  })
})

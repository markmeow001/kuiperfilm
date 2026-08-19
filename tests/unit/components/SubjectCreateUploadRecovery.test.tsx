import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hookState = vi.hoisted(() => ({
  retryUpload: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'uploadRecovery.message') return '素材已建立，圖片上傳失敗'
    if (key === 'uploadRecovery.retry') return '重試上傳'
    return key
  },
}))

vi.mock('@/components/shared/assets/character-creation/hooks/useCharacterCreationSubmit', () => ({
  useCharacterCreationSubmit: () => ({
    isSubmitting: false,
    isAiDesigning: false,
    isExtracting: false,
    uploadRecovery: { createdId: 'character-1', targetId: 'appearance-1' },
    uploadError: '素材已建立，圖片上傳失敗',
    handleExtractDescription: vi.fn(),
    handleCreateWithReference: vi.fn(),
    handleCreateWithUpload: vi.fn(),
    handleRetryUpload: hookState.retryUpload,
    handleAiDesign: vi.fn(),
    handleSubmit: vi.fn(),
    handleCreateOnly: vi.fn(),
  }),
}))

import { V2CharacterCreationModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterCreationModal'
import { V2LocationCreationModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2LocationCreationModal'
import { V2ManualAddSubjectModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2ManualAddSubjectModal'

const recovery = { createdId: 'asset-1', targetId: 'asset-1' }

describe('subject create upload recovery UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('角色圖片失敗 -> 顯示已建立狀態並提供同 target 重試', () => {
    render(
      <V2CharacterCreationModal
        projectId="project-1"
        episodeId="episode-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: '新建角色' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('素材已建立，圖片上傳失敗')
    const retry = screen.getByRole('button', { name: '重試上傳' })
    const cancel = screen.getByRole('button', { name: '取消' })
    const createOnly = screen.getByRole('button', { name: '只建立角色' })
    expect(retry.parentElement).toHaveClass('flex-col', 'sm:flex-row')
    for (const action of [retry, cancel, createOnly]) expect(action).toHaveClass('min-h-11')
    fireEvent.click(retry)
    expect(hookState.retryUpload).toHaveBeenCalledTimes(1)
  })

  it('場景圖片失敗 -> 表單 modal 顯示可重試狀態', () => {
    render(
      <V2LocationCreationModal
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
        uploadRecovery={recovery}
        uploadError="素材已建立，圖片上傳失敗"
      />,
    )

    expect(screen.getByRole('dialog', { name: '新場景' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('素材已建立，圖片上傳失敗')
    expect(screen.getByRole('button', { name: '重試上傳' })).toBeInTheDocument()
  })

  it('道具圖片失敗 -> 表單 modal 顯示可重試狀態', () => {
    render(
      <V2ManualAddSubjectModal
        subjectType="prop"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
        uploadRecovery={recovery}
        uploadError="素材已建立，圖片上傳失敗"
      />,
    )

    expect(screen.getByRole('dialog', { name: '手動新增道具' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('素材已建立，圖片上傳失敗')
    expect(screen.getByRole('button', { name: '重試上傳' })).toBeInTheDocument()
  })
})

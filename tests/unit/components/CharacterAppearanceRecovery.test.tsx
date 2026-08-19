import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enSubjects from '../../../messages/en/v2Subjects.json'
import zhSubjects from '../../../messages/zh/v2Subjects.json'

const mocks = vi.hoisted(() => ({
  createAppearance: vi.fn(),
}))

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: () => ({
    data: { novelPromotionData: { episodes: [] } },
  }),
}))

vi.mock('@/lib/query/mutations/episode-character-binding-mutations', () => ({
  useCreateCharacterAppearance: () => ({
    mutate: mocks.createAppearance,
    isPending: false,
  }),
  useEpisodeCharacterBindings: () => ({
    data: [], error: null, isPending: false, isFetching: false, refetch: vi.fn(),
  }),
  useUpdateEpisodeCharacterBinding: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkBindEpisodeCharacterAppearance: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCharacterAppearance: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCharacterAppearanceMeta: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/query/mutations/character-image-ops-mutations', () => ({
  useUploadAndExpandCharacterToMultiView: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/query/mutations/useRegisterArkAsset', () => ({
  useRegisterArkAsset: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { SubjectGrid } from '@/app/[locale]/v2/workspace/[projectId]/subjects/SubjectGrid'
import { V2CharacterAppearanceRecoveryModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearanceRecoveryModal'

function Harness({ locale }: { locale: 'zh' | 'en' }) {
  const [open, setOpen] = useState(false)
  const messages = locale === 'zh' ? zhSubjects : enSubjects
  return (
    <NextIntlClientProvider locale={locale} messages={{ v2Subjects: messages }}>
      <SubjectGrid
        items={[{
          id: 'character-1',
          targetId: '',
          name: '林真',
          caption: '主角',
          description: '調查記者',
          imageUrl: null,
          appearanceStatus: {
            label: locale === 'zh'
              ? '這個角色尚無可用造型'
              : 'This character has no available look.',
            tone: 'warning',
          },
          onOpenEditor: () => setOpen(true),
        }]}
        emptyHint="empty"
        layout="detail"
      />
      {open ? (
        <V2CharacterAppearanceRecoveryModal
          projectId="project-1"
          currentEpisodeId="episode-2"
          characterId="character-1"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </NextIntlClientProvider>
  )
}

describe('character appearance recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[no appearance] -> opens the recovery modal and creates a look bound only to the current episode', () => {
    render(<Harness locale="zh" />)

    fireEvent.click(screen.getByRole('button', { name: '林真' }))
    expect(screen.getByRole('dialog', { name: '新增角色造型' })).toBeInTheDocument()
    expect(screen.getByText('這個角色目前沒有可用造型。新增後，這一集才會使用新的造型。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ 新增造型' }))
    fireEvent.change(screen.getByPlaceholderText(/造型名稱/), {
      target: { value: '第二集戰鬥服' },
    })
    fireEvent.change(screen.getByPlaceholderText(/外觀描述/), {
      target: { value: '黑色戰術外套與防護背心' },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立造型' }))

    expect(mocks.createAppearance).toHaveBeenCalledWith(
      {
        characterId: 'character-1',
        changeReason: '第二集戰鬥服',
        description: '黑色戰術外套與防護背心',
        episodeId: 'episode-2',
      },
      expect.any(Object),
    )
  })

  it('[English locale at mobile width] -> keeps recovery copy in English and uses a bounded responsive dialog', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    render(<Harness locale="en" />)

    fireEvent.click(screen.getByRole('button', { name: '林真' }))
    const dialog = screen.getByRole('dialog', { name: 'Add character look' })
    expect(dialog).toHaveClass('p-4')
    expect(screen.getByText(/does not have an available look/i)).toBeInTheDocument()
    expect(dialog.firstElementChild).toHaveClass('max-w-[720px]', 'kuiper-workspace')
    expect(screen.getByTestId('appearance-recovery-body')).toHaveClass(
      'overflow-x-hidden',
      '[&_button]:min-h-11',
      '[&_input]:min-h-11',
    )

    fireEvent.click(screen.getByRole('button', { name: '+ 新增造型' }))
    const nameInput = screen.getByPlaceholderText(/造型名稱/)
    expect(nameInput.parentElement).toHaveClass('min-w-0', 'w-full')
    expect(nameInput.parentElement?.parentElement).toHaveClass('flex-col')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })
})

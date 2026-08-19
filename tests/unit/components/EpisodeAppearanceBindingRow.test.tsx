import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enSubjects from '../../../messages/en/v2Subjects.json'
import zhSubjects from '../../../messages/zh/v2Subjects.json'

const mocks = vi.hoisted(() => ({
  bindingsQuery: vi.fn(),
  updateMutate: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('@/lib/query/mutations/episode-character-binding-mutations', () => ({
  useEpisodeCharacterBindings: mocks.bindingsQuery,
  useUpdateEpisodeCharacterBinding: () => ({
    mutate: mocks.updateMutate,
    isPending: false,
  }),
  useBulkBindEpisodeCharacterAppearance: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateCharacterAppearance: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCharacterAppearance: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCharacterAppearanceMeta: () => ({ mutate: vi.fn(), isPending: false }),
}))

import { EpisodeBindingRow } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearancesPanel'

const appearances = [
  { id: 'appearance-a', appearanceIndex: 0, changeReason: '日常服' },
  { id: 'appearance-b', appearanceIndex: 1, changeReason: '戰鬥服' },
]

function renderRow(locale: 'zh' | 'en' = 'zh') {
  const messages = locale === 'zh' ? zhSubjects : enSubjects
  return render(
    <NextIntlClientProvider locale={locale} messages={{ v2Subjects: messages }}>
      <EpisodeBindingRow
        projectId="project-1"
        characterId="character-1"
        episode={{ id: 'episode-2', episodeNumber: 2, name: '第二集' }}
        appearances={appearances}
      />
    </NextIntlClientProvider>,
  )
}

describe('EpisodeBindingRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[initial binding load] -> disables selection, shows an explicit state, and sends no mutation', () => {
    mocks.bindingsQuery.mockReturnValue({
      data: undefined,
      error: null,
      isPending: true,
      isFetching: true,
      refetch: mocks.refetch,
    })
    renderRow()

    const select = screen.getByRole('combobox', { name: '第 2 集' })
    expect(select).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在載入此集的造型綁定')
    fireEvent.change(select, { target: { value: 'appearance-b' } })
    expect(mocks.updateMutate).not.toHaveBeenCalled()
  })

  it('[cached binding B then background refetch fails] -> keeps B visible but blocks changes until retry succeeds', () => {
    mocks.bindingsQuery.mockReturnValue({
      data: [{ characterId: 'character-1', appearanceId: 'appearance-b' }],
      error: new Error('offline'),
      isPending: false,
      isFetching: false,
      refetch: mocks.refetch,
    })
    renderRow()

    const select = screen.getByRole('combobox', { name: '第 2 集' })
    expect(select).toHaveValue('appearance-b')
    expect(select).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('造型綁定載入失敗')
    fireEvent.change(select, { target: { value: 'appearance-a' } })
    expect(mocks.updateMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '重新載入綁定' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('[binding load succeeds] -> selecting B writes the exact episode, character, and appearance B ids', () => {
    mocks.bindingsQuery.mockReturnValue({
      data: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
      error: null,
      isPending: false,
      isFetching: false,
      refetch: mocks.refetch,
    })
    renderRow()

    fireEvent.change(screen.getByRole('combobox', { name: '第 2 集' }), {
      target: { value: 'appearance-b' },
    })
    expect(mocks.updateMutate).toHaveBeenCalledWith({
      episodeId: 'episode-2',
      characterId: 'character-1',
      appearanceId: 'appearance-b',
    })
    expect(mocks.updateMutate.mock.calls).toEqual([[
      {
        episodeId: 'episode-2',
        characterId: 'character-1',
        appearanceId: 'appearance-b',
      },
    ]])
  })

  it('[English locale] -> renders the episode label and default look option in English', () => {
    mocks.bindingsQuery.mockReturnValue({
      data: [{ characterId: 'character-1', appearanceId: null }],
      error: null,
      isPending: false,
      isFetching: false,
      refetch: mocks.refetch,
    })
    renderRow('en')

    const select = screen.getByRole('combobox', { name: 'Episode 2' })
    expect(select).toBeEnabled()
    expect(screen.getByRole('option', { name: '— Use lowest-numbered look —' })).toBeInTheDocument()
  })
})

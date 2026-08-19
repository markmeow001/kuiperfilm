import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import enProduction from '../../../messages/en/v2Production.json'
import zhProduction from '../../../messages/zh/v2Production.json'

const mocks = vi.hoisted(() => ({
  useProjectData: vi.fn(),
  useStoryboards: vi.fn(),
}))

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: mocks.useProjectData,
}))

vi.mock('@/lib/query/hooks/useStoryboards', () => ({
  useStoryboards: mocks.useStoryboards,
}))

vi.mock(
  '@/app/[locale]/v2/workspace/[projectId]/hooks/useCurrentEpisode',
  () => ({
    useCurrentEpisode: () => ({
      currentEpisodeId: 'episode-1',
      currentEpisode: { name: '第一集' },
    }),
  }),
)

vi.mock(
  '@/app/[locale]/v2/workspace/[projectId]/hooks/useEpisodePreservingHref',
  () => ({
    useEpisodePreservingHref: () => (href: string) => href,
  }),
)

import { V2ShotBuilderClient } from '@/app/[locale]/v2/workspace/[projectId]/shot-builder/V2ShotBuilderClient'

function renderShot(locale: 'zh' | 'en' = 'zh') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{
        v2Production: locale === 'en' ? enProduction : zhProduction,
      }}
    >
      <V2ShotBuilderClient projectId="project-1" locale={locale} />
    </NextIntlClientProvider>,
  )
}

describe('V2ShotBuilderClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProjectData.mockReturnValue({
      data: {
        novelPromotionData: {
          videoModel: 'atlascloud/seedance-2-r2v',
          videoRatio: '16:9',
          videoResolution: '720p',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useStoryboards.mockReturnValue({
      data: {
        storyboards: [
          {
            id: 'scene-1',
            stageIndex: 0,
            panels: [
              {
                id: 'shot-1',
                panelIndex: 0,
                panelNumber: 1,
                imageUrl: '/shot.jpg',
                media: null,
                videoPrompt: '鏡頭穩定後退，人物向前走。',
                videoUrl: null,
                videoGenerationMode: null,
                videoMedia: null,
                imageErrorMessage: null,
                candidateImages: JSON.stringify(['/candidate.jpg']),
                characters: [{ name: '陳默' }],
                location: '北門車站',
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it('shows real shot dependencies and switches keyframe versions', () => {
    renderShot()

    expect(
      screen.getByRole('heading', { name: '鏡頭工作站' }),
    ).toBeInTheDocument()
    expect(screen.getByText('陳默')).toBeInTheDocument()
    expect(screen.getByText('北門車站')).toBeInTheDocument()
    expect(screen.getByText('鏡頭穩定後退，人物向前走。')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /AI Plan/ })).toBeDisabled()
    expect(screen.getByText(/AI Plan 尚未接上計畫資料/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '預覽版本' }))
    expect(screen.getAllByText('預覽中').length).toBeGreaterThan(0)
  })

  it('專案查詢 503 且無快取 -> 顯示 retry error，不冒充比例未設定', () => {
    const refetch = vi.fn()
    mocks.useProjectData.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('HTTP 503'),
      refetch,
    })

    renderShot()

    expect(screen.getByText('鏡頭資料載入失敗')).toBeInTheDocument()
    expect(screen.getByText('專案設定：HTTP 503')).toBeInTheDocument()
    expect(screen.queryByText('比例未設定')).not.toBeInTheDocument()
    expect(
      screen.queryByText('鏡頭穩定後退，人物向前走。'),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('專案背景刷新失敗但仍有快取 -> 顯示警告並保留上次鏡頭資料', () => {
    mocks.useProjectData.mockReturnValue({
      data: {
        novelPromotionData: {
          videoModel: 'atlascloud/seedance-2-r2v',
          videoRatio: '16:9',
          videoResolution: '720p',
        },
      },
      isLoading: false,
      isError: true,
      error: new Error('HTTP 503'),
      refetch: vi.fn(),
    })

    renderShot()

    expect(
      screen.getByText('資料刷新失敗；下方保留上次成功載入的鏡頭與專案設定。'),
    ).toBeInTheDocument()
    expect(screen.getByText('鏡頭穩定後退，人物向前走。')).toBeInTheDocument()
    expect(screen.getByText('16:9')).toBeInTheDocument()
  })

  it('English locale -> renders the new workspace without Chinese UI labels', () => {
    renderShot('en')

    expect(
      screen.getByRole('heading', { name: 'Shot Builder' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Preview version' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI Plan/ })).toBeDisabled()
  })
})

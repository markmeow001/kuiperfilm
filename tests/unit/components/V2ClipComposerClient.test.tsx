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

import { V2ClipComposerClient } from '@/app/[locale]/v2/workspace/[projectId]/clip-composer/V2ClipComposerClient'

function renderComposer(locale: 'zh' | 'en' = 'zh') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{
        v2Production: locale === 'en' ? enProduction : zhProduction,
      }}
    >
      <V2ClipComposerClient projectId="project-1" locale={locale} />
    </NextIntlClientProvider>,
  )
}

describe('V2ClipComposerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProjectData.mockReturnValue({
      data: { novelPromotionData: { videoRatio: '16:9', targetDuration: 60 } },
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
            panels: [
              {
                id: 'clip-1',
                panelIndex: 0,
                imageUrl: '/shot.jpg',
                videoUrl: '/shot.mp4',
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

  it('renders the source clip in preview, media library, and timeline', () => {
    renderComposer()

    expect(
      screen.getByRole('heading', { name: '剪輯工作區' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('真實鏡頭媒體、預覽與時間線選取已可用；', {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(document.querySelector('video')).toHaveAttribute('src', '/shot.mp4')
    expect(screen.getAllByText('SHOT 01').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '字幕' }))
    expect(
      screen.getByText(
        '此工具的介面已定位；資料契約尚未接線，不會寫入時間線。',
      ),
    ).toBeInTheDocument()
  })

  it('真實 storyboards envelope -> 不會被誤判為空白時間線', () => {
    renderComposer()

    expect(screen.queryByText('時間線還沒有媒體')).not.toBeInTheDocument()
    expect(document.querySelector('video')).toHaveAttribute('src', '/shot.mp4')
  })

  it('專案查詢 503 且無快取 -> 顯示 retry error，不建立空白時間線', () => {
    const refetch = vi.fn()
    mocks.useProjectData.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('HTTP 503'),
      refetch,
    })

    renderComposer()

    expect(screen.getByText('剪輯來源載入失敗')).toBeInTheDocument()
    expect(screen.getByText('專案設定：HTTP 503')).toBeInTheDocument()
    expect(screen.queryByText('時間線還沒有媒體')).not.toBeInTheDocument()
    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: '行動版剪輯模式' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('English locale -> labels connected and unavailable tools honestly', () => {
    renderComposer('en')

    expect(
      screen.getByRole('heading', { name: 'Clip Composer' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Captions' }))
    expect(
      screen.getByText(/data contract is not connected/),
    ).toBeInTheDocument()
  })
})

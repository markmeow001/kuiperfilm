import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import enFinal from '../../../messages/en/v2Final.json'
import zhFinal from '../../../messages/zh/v2Final.json'

const mocks = vi.hoisted(() => ({
  useProjectData: vi.fn(),
  useProjectAccess: vi.fn(),
  useStoryboards: vi.fn(),
  useEpisodeDelivery: vi.fn(),
  useGenerationJobs: vi.fn(),
  useCancelGenerationJob: vi.fn(),
  useStitchEpisodeMp4: vi.fn(),
  mutate: vi.fn(),
  cancelMutate: vi.fn(),
  refetchProject: vi.fn(),
  refetchAccess: vi.fn(),
  refetchStoryboards: vi.fn(),
  refetchDelivery: vi.fn(),
}))

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: mocks.useProjectData,
}))

vi.mock('@/lib/query/hooks/useProjectAccess', () => ({
  useProjectAccess: mocks.useProjectAccess,
}))

vi.mock('@/lib/query/hooks/useStoryboards', () => ({
  useStoryboards: mocks.useStoryboards,
}))

vi.mock('@/lib/query/hooks/useEpisodeDelivery', () => ({
  useEpisodeDelivery: mocks.useEpisodeDelivery,
  resolveSafeDeliveryDownloadUrl: (candidate: string | null) => {
    if (!candidate) return null
    if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate
    const url = new URL(candidate, window.location.origin)
    if (url.origin === window.location.origin || url.protocol === 'https:') {
      return url.href
    }
    return null
  },
}))

vi.mock('@/lib/query/hooks/useGenerationJobs', () => ({
  useGenerationJobs: mocks.useGenerationJobs,
}))

vi.mock('@/lib/query/mutations/task-mutations', () => ({
  useCancelGenerationJob: mocks.useCancelGenerationJob,
}))

vi.mock('@/lib/query/mutations/episode-stitch-mutations', () => ({
  useStitchEpisodeMp4: mocks.useStitchEpisodeMp4,
}))

vi.mock(
  '@/app/[locale]/v2/workspace/[projectId]/hooks/useCurrentEpisode',
  () => ({
    useCurrentEpisode: () => ({
      currentEpisodeId: 'episode-1',
      currentEpisode: {
        id: 'episode-1',
        episodeNumber: 1,
        name: '第一集',
      },
    }),
  }),
)

vi.mock(
  '@/app/[locale]/v2/workspace/[projectId]/hooks/useEpisodePreservingHref',
  () => ({
    useEpisodePreservingHref: () => (href: string) => href,
  }),
)

import { V2FinalClient } from '@/app/[locale]/v2/workspace/[projectId]/final/V2FinalClient'

function finalElement(locale: 'zh' | 'en' = 'zh') {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ v2Final: locale === 'en' ? enFinal : zhFinal }}
    >
      <V2FinalClient projectId="project-1" locale={locale} />
    </NextIntlClientProvider>
  )
}

function renderFinal(locale: 'zh' | 'en' = 'zh') {
  return render(finalElement(locale))
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

function buildDeliveryJob(
  overrides: Partial<{
    id: string
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    progress: number
    createdAt: string
    updatedAt: string
    canCancel: boolean
    stageLabel: string
  }> = {},
) {
  return {
    id: overrides.id ?? 'delivery-task-1',
    type: 'episode_stitch_mp4',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'NovelPromotionEpisode',
    targetId: 'episode-1',
    status: overrides.status ?? 'running',
    progress: overrides.progress ?? 42,
    createdAt: overrides.createdAt ?? '2026-08-10T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-08-10T10:01:00.000Z',
    canCancel: overrides.canCancel ?? true,
    stageLabel: overrides.stageLabel ?? 'Packaging assets',
  }
}

function buildReadyDeliveryResponse(taskId = 'delivery-task-ready') {
  return {
    success: true as const,
    input: {
      canCreate: true,
      selectedVideoCount: 1,
      imageCount: 1,
      multiShotVideoCount: 0,
      voiceAudioCount: 2,
      missingVoiceAudioCount: 1,
    },
    delivery: {
      status: 'ready' as const,
      filename: 'episode-1-assets.zip',
      downloadUrl:
        '/api/novel-promotion/project-1/episodes/episode-1/delivery/download',
      version: 'v1' as const,
      taskId,
      createdAt: '2026-08-10T10:02:00.000Z',
      sourceFingerprint: 'a'.repeat(64),
      stale: false,
      manifest: {
        version: 1 as const,
        fileCount: 8,
        selectedVideoCount: 1,
        multiShotVideoCount: 0,
        imageCount: 1,
        voiceAudioCount: 2,
        excludedVoiceLineCount: 1,
        scriptIncluded: true as const,
        checksumAlgorithm: 'sha256' as const,
      },
    },
  }
}

describe('V2FinalClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refetchDelivery.mockResolvedValue({
      data: undefined,
      isSuccess: true,
      isError: false,
    })
    mocks.useProjectData.mockReturnValue({
      data: {
        novelPromotionData: { videoRatio: '9:16', targetDuration: 60 },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchProject,
    })
    mocks.useProjectAccess.mockReturnValue({
      allowed: true,
      role: 'editor',
      canEdit: true,
      canView: true,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchAccess,
    })
    mocks.useStoryboards.mockReturnValue({
      data: {
        storyboards: [
          {
            id: 'storyboard-1',
            panels: [
              {
                id: 'panel-1',
                panelIndex: 0,
                imageUrl: '/shot.jpg',
                videoUrl: '/shot.mp4',
                multiShotGroupId: null,
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchStoryboards,
    })
    mocks.useEpisodeDelivery.mockReturnValue({
      data: buildReadyDeliveryResponse(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })
    mocks.useGenerationJobs.mockReturnValue({
      data: { pages: [{ tasks: [] }] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useCancelGenerationJob.mockReturnValue({
      mutate: mocks.cancelMutate,
      isPending: false,
      isError: false,
      error: null,
    })
    mocks.useStitchEpisodeMp4.mockReturnValue({
      mutate: mocks.mutate,
      isPending: false,
      isError: false,
      error: null,
    })
  })

  it('ready delivery -> 顯示素材交付 ZIP 並只使用 delivery downloadUrl', () => {
    renderFinal()

    expect(
      screen.getByRole('heading', { name: '素材交付' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '素材交付 ZIP' }),
    ).toBeInTheDocument()
    const download = screen.getByRole('link', { name: '下載素材交付 ZIP' })
    expect(download).toHaveAttribute(
      'href',
      '/api/novel-promotion/project-1/episodes/episode-1/delivery/download',
    )
    expect(download).toHaveAttribute('download', 'episode-1-assets.zip')
    expect(document.body).not.toHaveTextContent('Final Cut')
    expect(document.body).toHaveTextContent('素材交付 ZIP 不等於 MP4 成片')
  })

  it('不安全的 cross-origin HTTP downloadUrl -> 不建立下載連結', () => {
    const ready = buildReadyDeliveryResponse()
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        ...ready,
        delivery: {
          ...ready.delivery,
          filename: 'unsafe.zip',
          downloadUrl: 'http://evil.example/private.zip',
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })

    renderFinal()

    expect(
      screen.queryByRole('link', { name: '下載素材交付 ZIP' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('下載連結無法安全驗證')
  })

  it('initial source loading -> 顯示 aria-busy，不以 9:16、60 秒或 0% 冒充資料', () => {
    mocks.useProjectData.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: mocks.refetchProject,
    })

    renderFinal()

    expect(screen.getByLabelText('正在載入素材交付資料')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(document.body).not.toHaveTextContent('9:16')
    expect(document.body).not.toHaveTextContent('60s')
    expect(document.body).not.toHaveTextContent('0%')
  })

  it('project/storyboard/access error 且無快取 -> 顯示明確錯誤與 retry，不顯示空狀態', () => {
    mocks.useProjectData.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('project 503'),
      refetch: mocks.refetchProject,
    })
    mocks.useStoryboards.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('storyboard 503'),
      refetch: mocks.refetchStoryboards,
    })
    mocks.useProjectAccess.mockReturnValue({
      allowed: false,
      role: null,
      canEdit: false,
      canView: false,
      isLoading: false,
      isError: true,
      error: new Error('access 503'),
      refetch: mocks.refetchAccess,
    })

    renderFinal()

    expect(screen.getByText('素材交付資料載入失敗')).toBeInTheDocument()
    expect(screen.getByText(/專案資料：project 503/)).toBeInTheDocument()
    expect(screen.getByText(/分鏡資料：storyboard 503/)).toBeInTheDocument()
    expect(screen.getByText(/存取權限：access 503/)).toBeInTheDocument()
    expect(screen.queryByText('尚無可交付的鏡頭')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(mocks.refetchProject).toHaveBeenCalledTimes(1)
    expect(mocks.refetchStoryboards).toHaveBeenCalledTimes(1)
    expect(mocks.refetchAccess).toHaveBeenCalledTimes(1)
  })

  it('背景刷新失敗但有快取 -> 標示 cached stale 並保留預覽', () => {
    mocks.useStoryboards.mockReturnValue({
      data: {
        storyboards: [
          {
            id: 'storyboard-1',
            panels: [
              {
                id: 'panel-1',
                panelIndex: 0,
                imageUrl: '/cached.jpg',
                videoUrl: null,
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: true,
      error: new Error('refresh 503'),
      refetch: mocks.refetchStoryboards,
    })

    renderFinal()

    expect(screen.getByText(/上次成功載入的資料/)).toBeInTheDocument()
    expect(screen.getByAltText('目前分鏡預覽')).toHaveAttribute(
      'src',
      '/cached.jpg',
    )
  })

  it('已載入但沒有分鏡 -> 顯示真正 empty state，不顯示虛構進度', () => {
    mocks.useStoryboards.mockReturnValue({
      data: { storyboards: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchStoryboards,
    })

    renderFinal()

    expect(screen.getByText('尚無可交付的鏡頭')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('0%')
  })

  it('voice-only + no panels -> 預覽顯示 empty，但仍可建立素材交付 ZIP', () => {
    mocks.useStoryboards.mockReturnValue({
      data: { storyboards: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchStoryboards,
    })
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        success: true,
        input: {
          canCreate: true,
          selectedVideoCount: 0,
          imageCount: 0,
          multiShotVideoCount: 0,
          voiceAudioCount: 2,
          missingVoiceAudioCount: 1,
        },
        delivery: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })

    renderFinal()

    expect(screen.getByText('尚無可交付的鏡頭')).toBeInTheDocument()
    expect(screen.getByText('2 段已生成配音')).toBeInTheDocument()
    const create = screen.getByRole('button', { name: '建立素材交付 ZIP' })
    expect(create).toBeEnabled()
    fireEvent.click(create)
    expect(mocks.mutate).toHaveBeenCalledWith(
      { episodeId: 'episode-1' },
      expect.any(Object),
    )
  })

  it('existing delivery + no panels -> 預覽顯示 empty，但仍可下載素材包', () => {
    mocks.useStoryboards.mockReturnValue({
      data: { storyboards: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchStoryboards,
    })

    renderFinal()

    expect(screen.getByText('尚無可交付的鏡頭')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '下載素材交付 ZIP' }),
    ).toHaveAttribute(
      'href',
      '/api/novel-promotion/project-1/episodes/episode-1/delivery/download',
    )
  })

  it('比例與目標時長缺失 -> 明示尚未設定，不套用 9:16 或 60 秒預設', () => {
    mocks.useProjectData.mockReturnValue({
      data: { novelPromotionData: {} },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchProject,
    })

    renderFinal()

    expect(screen.getAllByText('尚未設定').length).toBeGreaterThan(0)
    expect(document.body).not.toHaveTextContent('9:16')
    expect(document.body).not.toHaveTextContent('60s')
    expect(document.querySelector('[data-aspect-ratio="unknown"]')).toBeInTheDocument()
  })

  it('delivery status 無快取且失敗 -> 只允許重新讀取狀態，不建立重複交付', () => {
    mocks.useEpisodeDelivery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('delivery 503'),
      refetch: mocks.refetchDelivery,
    })

    renderFinal()

    expect(screen.getByText('目前無法讀取素材交付狀態。')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '建立素材交付 ZIP' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新載入交付狀態' }))
    expect(mocks.refetchDelivery).toHaveBeenCalledTimes(1)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('viewer -> 可預覽與下載，但建立與重試 controls 同時 disabled 且 handler fail-closed', () => {
    mocks.useProjectAccess.mockReturnValue({
      allowed: true,
      role: 'viewer',
      canEdit: false,
      canView: true,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchAccess,
    })

    renderFinal()

    expect(document.querySelector('video')).toHaveAttribute('src', '/shot.mp4')
    expect(
      screen.getByRole('link', { name: '下載素材交付 ZIP' }),
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: '重新建立素材交付 ZIP' })
    expect(retry).toBeDisabled()
    expect(retry).toHaveAccessibleDescription('你目前是唯讀檢視者；需要編輯權限才能建立或重新建立素材交付 ZIP。')
    fireEvent.click(retry)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('refresh/reopen 時已有 durable active job -> 恢復 taskId/progress 並禁止第二次 submit', () => {
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-active',
                status: 'running',
                progress: 58,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    expect(screen.getByText('delivery-task-active')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: '素材交付 ZIP 建立進度' }),
    ).toHaveAttribute('aria-valuenow', '58')
    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '重新建立素材交付 ZIP' }),
    ).not.toBeInTheDocument()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('最新 durable job failed 且舊 package 存在 -> 明示失敗並只稱上一版', () => {
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-failed',
                status: 'failed',
                progress: 19,
                canCancel: false,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    expect(screen.getByText('最新一次建立失敗')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('素材交付 ZIP 已就緒')).not.toBeInTheDocument()
  })

  it('viewer + active job -> cancel control disabled，點擊不送出 cancel 或 package request', () => {
    mocks.useProjectAccess.mockReturnValue({
      allowed: true,
      role: 'viewer',
      canEdit: false,
      canView: true,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchAccess,
    })
    mocks.useGenerationJobs.mockReturnValue({
      data: { pages: [{ tasks: [buildDeliveryJob()] }] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    const cancel = screen.getByRole('button', { name: '取消建立素材交付 ZIP' })
    expect(cancel).toBeDisabled()
    fireEvent.click(cancel)
    expect(mocks.cancelMutate).not.toHaveBeenCalled()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('active durable truth -> 覆蓋 POST transport error，不顯示誤導性的送出失敗', () => {
    mocks.useGenerationJobs.mockReturnValue({
      data: { pages: [{ tasks: [buildDeliveryJob()] }] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useStitchEpisodeMp4.mockReturnValue({
      mutate: mocks.mutate,
      isPending: false,
      isError: true,
      error: new Error('HTTP 503'),
    })

    renderFinal()

    expect(screen.getByText('delivery-task-1')).toBeInTheDocument()
    expect(screen.queryByText('HTTP 503')).not.toBeInTheDocument()
  })

  it('server input counts -> receipt 顯示精確數字且 canCreate=false 時 CTA disabled', () => {
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        success: true,
        input: {
          canCreate: false,
          selectedVideoCount: 3,
          imageCount: 5,
          multiShotVideoCount: 2,
          voiceAudioCount: 7,
          missingVoiceAudioCount: 4,
        },
        delivery: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })

    renderFinal()

    expect(screen.getByText('3 個已選影片')).toBeInTheDocument()
    expect(screen.getByText('5 張參考圖')).toBeInTheDocument()
    expect(screen.getByText('2 段多鏡頭影片')).toBeInTheDocument()
    const create = screen.getByRole('button', { name: '建立素材交付 ZIP' })
    expect(create).toBeDisabled()
    fireEvent.click(create)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('voice-only receipt -> 只信 server canCreate，可建立含配音的素材包', () => {
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        success: true,
        input: {
          canCreate: true,
          selectedVideoCount: 0,
          imageCount: 0,
          multiShotVideoCount: 0,
          voiceAudioCount: 1,
          missingVoiceAudioCount: 3,
        },
        delivery: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })

    renderFinal()

    expect(screen.getByText('1 段已生成配音')).toBeInTheDocument()
    expect(screen.getByText('3 段尚未生成配音')).toBeInTheDocument()
    const create = screen.getByRole('button', { name: '建立素材交付 ZIP' })
    expect(create).toBeEnabled()
    fireEvent.click(create)
    expect(mocks.mutate).toHaveBeenCalledWith(
      { episodeId: 'episode-1' },
      expect.any(Object),
    )
  })

  it('建立前 receipt -> 顯示影片、圖片、已生成/未生成配音，並明示 ZIP 不執行 AI 或收費', () => {
    renderFinal()

    expect(screen.getByText('1 個已選影片')).toBeInTheDocument()
    expect(screen.getByText('1 張參考圖')).toBeInTheDocument()
    expect(screen.getByText('2 段已生成配音')).toBeInTheDocument()
    expect(screen.getByText('1 段尚未生成配音')).toBeInTheDocument()
    expect(document.body).toHaveTextContent(
      '素材交付 ZIP 不等於 MP4 成片；建立素材包只整理既有檔案，不會執行 AI 生成，也不會產生 AI 費用。',
    )
    expect(screen.getByLabelText('建立前素材收據').tagName).toBe('DL')
  })

  it('v1 ready -> 顯示 task/version/createdAt、manifest counts 與 checksum', () => {
    renderFinal()

    expect(screen.getByText('delivery-task-ready')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(
      document.querySelector('time[datetime="2026-08-10T10:02:00.000Z"]'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        new Intl.DateTimeFormat('zh-TW', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date('2026-08-10T10:02:00.000Z')),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('8 個檔案')).toBeInTheDocument()
    expect(screen.getByText('2 段配音')).toBeInTheDocument()
    expect(screen.getByText('1 段排除配音')).toBeInTheDocument()
    expect(screen.getByText('SHA-256')).toBeInTheDocument()
    expect(screen.getByText('包含劇本')).toBeInTheDocument()
    expect(screen.getByLabelText('交付 manifest 摘要').tagName).toBe('DL')
  })

  it('stale v1 -> 明示來源已變更、下載只稱上一版，editor 可建立新版', () => {
    const ready = buildReadyDeliveryResponse()
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        ...ready,
        delivery: { ...ready.delivery, stale: true },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })

    renderFinal()

    const staleStatus = screen.getByText(
      '來源已變更，這是上一版素材包。',
    ).closest('[role="status"]')
    expect(staleStatus).toHaveAttribute('aria-live', 'polite')
    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
    const createLatest = screen.getByRole('button', {
      name: '建立新版素材交付 ZIP',
    })
    expect(createLatest).toBeEnabled()
    fireEvent.click(createLatest)
    expect(mocks.mutate).toHaveBeenCalledWith(
      { episodeId: 'episode-1' },
      expect.any(Object),
    )
  })

  it('viewer + stale v1 -> 可下載上一版，但建立新版 disabled 且 handler fail-closed', () => {
    const ready = buildReadyDeliveryResponse()
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        ...ready,
        delivery: { ...ready.delivery, stale: true },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })
    mocks.useProjectAccess.mockReturnValue({
      allowed: true,
      role: 'viewer',
      canEdit: false,
      canView: true,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchAccess,
    })

    renderFinal()

    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
    const createLatest = screen.getByRole('button', {
      name: '建立新版素材交付 ZIP',
    })
    expect(createLatest).toBeDisabled()
    fireEvent.click(createLatest)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('explicit legacy -> 可下載但明示沒有 manifest，不稱已驗證', () => {
    const ready = buildReadyDeliveryResponse()
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        ...ready,
        delivery: {
          status: 'ready',
          filename: 'legacy-assets.zip',
          downloadUrl: '/api/legacy-delivery/download',
          version: 'legacy',
          taskId: null,
          createdAt: '2026-08-01T10:00:00.000Z',
          sourceFingerprint: null,
          stale: null,
          manifest: null,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })

    renderFinal()

    expect(
      screen.getByRole('link', { name: '下載舊版素材交付 ZIP' }),
    ).toBeInTheDocument()
    expect(document.body).toHaveTextContent(
      '這是舊版素材包，沒有 manifest；可以下載，但不會標示為已驗證。',
    )
    expect(document.body).not.toHaveTextContent('素材包已驗證')
    expect(screen.queryByLabelText('交付 manifest 摘要')).not.toBeInTheDocument()
  })

  it('最新 completed durable job -> 重新讀取 delivery receipt', async () => {
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-completed',
                status: 'completed',
                progress: 100,
                canCancel: false,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    await waitFor(() => expect(mocks.refetchDelivery).toHaveBeenCalledTimes(1))
  })

  it('completed + cached old ready + refetch pending -> 舊連結維持上一版，不提前標 current', async () => {
    mocks.refetchDelivery.mockReturnValue(new Promise(() => undefined))
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-new-completed',
                status: 'completed',
                progress: 100,
                canCancel: false,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    await waitFor(() => expect(mocks.refetchDelivery).toHaveBeenCalledTimes(1))
    expect(screen.getByText('正在確認最新素材包')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '下載素材交付 ZIP' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '重新載入交付狀態' }),
    ).toBeDisabled()
  })

  it('completed + cached old ready + refetch failure -> 舊連結維持上一版並允許 retry', async () => {
    mocks.refetchDelivery.mockResolvedValue({
      data: buildReadyDeliveryResponse(),
      isSuccess: false,
      isError: true,
    })
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-new-completed',
                status: 'completed',
                progress: 100,
                canCancel: false,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '重新載入交付狀態' }),
      ).toBeEnabled()
    })
    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('素材交付 ZIP 已就緒')).not.toBeInTheDocument()
  })

  it('completed + cached old ready + refetch success -> 成功後才升級為 current ZIP', async () => {
    let resolveRefetch: ((value: {
      data: ReturnType<typeof buildReadyDeliveryResponse>
      isSuccess: true
      isError: false
    }) => void) | null = null
    mocks.refetchDelivery.mockReturnValue(
      new Promise((resolve) => {
        resolveRefetch = resolve
      }),
    )
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-new-completed',
                status: 'completed',
                progress: 100,
                canCancel: false,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
    await act(async () => {
      resolveRefetch?.({
        data: buildReadyDeliveryResponse('delivery-task-new-completed'),
        isSuccess: true,
        isError: false,
      })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: '下載素材交付 ZIP' }),
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).not.toBeInTheDocument()
  })

  it.each([1, Date.parse('2099-01-01T00:00:00.000Z')])(
    'completed + ready receipt -> client dataUpdatedAt=%s 不影響 current ZIP 判定',
    async (dataUpdatedAt) => {
      mocks.refetchDelivery.mockResolvedValue({
        data: buildReadyDeliveryResponse('delivery-task-completed'),
        isSuccess: true,
        isError: false,
      })
      mocks.useEpisodeDelivery.mockReturnValue({
        data: buildReadyDeliveryResponse('delivery-task-completed'),
        dataUpdatedAt,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mocks.refetchDelivery,
      })
      mocks.useGenerationJobs.mockReturnValue({
        data: {
          pages: [
            {
              tasks: [
                buildDeliveryJob({
                  id: 'delivery-task-completed',
                  status: 'completed',
                  progress: 100,
                  canCancel: false,
                  updatedAt: '2050-01-01T00:00:00.000Z',
                }),
              ],
            },
          ],
        },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      })

      renderFinal()

      await waitFor(() => {
        expect(screen.getByText('素材交付 ZIP 已就緒')).toBeInTheDocument()
        expect(
          screen.getByRole('link', { name: '下載素材交付 ZIP' }),
        ).toBeInTheDocument()
      })
      expect(
        screen.queryByRole('link', { name: '下載上一版素材交付 ZIP' }),
      ).not.toBeInTheDocument()
    },
  )

  it('confirmed completed receipt + source change -> server stale truth replaces local confirmation', async () => {
    const current = buildReadyDeliveryResponse('delivery-task-completed')
    let currentQueryData = current
    mocks.refetchDelivery.mockResolvedValue({
      data: current,
      isSuccess: true,
      isError: false,
    })
    mocks.useEpisodeDelivery.mockImplementation(() => ({
      data: currentQueryData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    }))
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-completed',
                status: 'completed',
                progress: 100,
                canCancel: false,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    const { rerender } = renderFinal()
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: '下載素材交付 ZIP' }),
      ).toBeInTheDocument()
    })

    currentQueryData = {
      ...current,
      delivery: { ...current.delivery, stale: true },
    }
    rerender(finalElement())

    expect(
      screen.getByText('來源已變更，這是上一版素材包。'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '下載上一版素材交付 ZIP' }),
    ).toBeInTheDocument()
  })

  it('completed + delivery null -> 保持 awaiting 並提供 receipt retry', async () => {
    mocks.useEpisodeDelivery.mockReturnValue({
      data: {
        success: true,
        input: {
          canCreate: true,
          selectedVideoCount: 1,
          imageCount: 1,
          multiShotVideoCount: 0,
          voiceAudioCount: 2,
          missingVoiceAudioCount: 1,
        },
        delivery: null,
      },
      dataUpdatedAt: Date.parse('2099-01-01T00:00:00.000Z'),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: mocks.refetchDelivery,
    })
    mocks.useGenerationJobs.mockReturnValue({
      data: {
        pages: [
          {
            tasks: [
              buildDeliveryJob({
                id: 'delivery-task-completed',
                status: 'completed',
                progress: 100,
                canCancel: false,
              }),
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })

    renderFinal()

    expect(screen.getByText('正在確認最新素材包')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /下載.*素材交付 ZIP/ }),
    ).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: '重新載入交付狀態' })
    await waitFor(() => expect(retry).toBeEnabled())
    fireEvent.click(retry)
    await waitFor(() => {
      expect(mocks.refetchDelivery).toHaveBeenCalledTimes(2)
    })
  })

  it.each([
    ['9:16', 'aspect-[9/16]'],
    ['1:1', 'aspect-square'],
    ['16:9', 'aspect-video'],
  ])('%s -> 預覽使用真實比例 class', (ratio, expectedClass) => {
    mocks.useProjectData.mockReturnValue({
      data: { novelPromotionData: { videoRatio: ratio, targetDuration: 60 } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchProject,
    })

    const { container } = renderFinal()

    expect(
      container.querySelector(`[data-aspect-ratio="${ratio}"]`),
    ).toHaveClass(expectedClass)
  })

  it('timeline -> 具備 progressbar、可讀名稱、ready 狀態與 aria-pressed', () => {
    renderFinal()

    expect(screen.getByRole('progressbar', { name: '影片素材完成度' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    const shot = screen.getByRole('button', {
      name: '鏡頭 1：影片已就緒',
    })
    expect(shot).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('同時有 lip-sync 與 base video -> 預覽與 ready 計數使用 server 選定的 lip-sync', () => {
    mocks.useStoryboards.mockReturnValue({
      data: {
        storyboards: [
          {
            id: 'storyboard-1',
            panels: [
              {
                id: 'panel-1',
                panelIndex: 0,
                imageUrl: '/shot.jpg',
                lipSyncVideoUrl: '/shot-lip-sync.mp4',
                videoUrl: '/shot-base.mp4',
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchStoryboards,
    })

    renderFinal()

    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      '/shot-lip-sync.mp4',
    )
    expect(
      screen.getByRole('progressbar', { name: '影片素材完成度' }),
    ).toHaveAttribute('aria-valuenow', '100')
    expect(
      screen.getByRole('button', { name: '鏡頭 1：影片已就緒' }),
    ).toBeInTheDocument()
  })

  it('lip-sync key 為空字串且 base 存在 -> nullish contract fail-closed，不回退 base 或標示 ready', () => {
    mocks.useStoryboards.mockReturnValue({
      data: {
        storyboards: [
          {
            id: 'storyboard-1',
            panels: [
              {
                id: 'panel-1',
                panelIndex: 0,
                imageUrl: '/shot.jpg',
                lipSyncVideoUrl: '',
                videoUrl: '/shot-base.mp4',
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.refetchStoryboards,
    })

    renderFinal()

    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(document.body).not.toContainHTML('/shot-base.mp4')
    expect(
      screen.getByRole('progressbar', { name: '影片素材完成度' }),
    ).toHaveAttribute('aria-valuenow', '0')
    expect(
      screen.getByRole('button', { name: '鏡頭 1：目前只有參考圖' }),
    ).toBeInTheDocument()
  })

  it.each([390, 768, 1440])('%ipx DOM -> 核心預覽與交付操作保持可達', (width) => {
    setViewport(width)
    renderFinal()

    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '鏡頭預覽' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '素材交付 ZIP' })).toBeInTheDocument()
  })

  it('English locale -> uses Asset Delivery language without Final Cut or MP4 claims', () => {
    renderFinal('en')

    expect(
      screen.getByRole('heading', { name: 'Asset Delivery' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Asset Delivery ZIP' }),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Final Cut')
    expect(document.body).toHaveTextContent(
      'An Asset Delivery ZIP is not an MP4 movie',
    )
    expect(
      screen.getByText(
        new Intl.DateTimeFormat('en', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date('2026-08-10T10:02:00.000Z')),
      ),
    ).toBeInTheDocument()
  })
})

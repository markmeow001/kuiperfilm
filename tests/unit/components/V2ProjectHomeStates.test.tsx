import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { V2HomeClient } from '@/app/[locale]/v2/workspace/[projectId]/V2HomeClient'
import type {
  ProjectHomeEpisode,
  ProjectHomeModel,
} from '@/app/[locale]/v2/workspace/[projectId]/project-home-model'
import enProduction from '../../../messages/en/v2Production.json'
import zhProduction from '../../../messages/zh/v2Production.json'

const mocks = vi.hoisted(() => ({
  useProjectData: vi.fn(),
  useProjectAccess: vi.fn(),
  useProjectProps: vi.fn(),
  useProjectHomeEpisodes: vi.fn(),
}))

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: mocks.useProjectData,
}))

vi.mock('@/lib/query/hooks/useProjectAccess', () => ({
  useProjectAccess: mocks.useProjectAccess,
}))

vi.mock('@/lib/query/hooks/useProjectAssets', () => ({
  useProjectProps: mocks.useProjectProps,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/useProjectHomeEpisodes', () => ({
  useProjectHomeEpisodes: mocks.useProjectHomeEpisodes,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/ProjectHomeContent', () => ({
  ProjectHomeContent: ({
    episodes,
    model,
    partialIssues,
  }: {
    episodes: readonly ProjectHomeEpisode[] | null
    model: ProjectHomeModel
    partialIssues: readonly string[]
  }) => (
    <div>
      <span>專案首頁內容</span>
      <span>集數資料：{episodes?.map((episode) => episode.name).join('、') ?? '未知'}</span>
      <span>道具數：{model.counts.props ?? '未知'}</span>
      <span>問題：{partialIssues.join('｜')}</span>
    </div>
  ),
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/V2ProjectSettingsPanel', () => ({
  V2ProjectSettingsPanel: () => <div>專案設定</div>,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/ProjectCollaboratorsModal', () => ({
  ProjectCollaboratorsModal: () => <div>協作者視窗</div>,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/ProjectAuditLogModal', () => ({
  ProjectAuditLogModal: () => <div>活動紀錄視窗</div>,
}))

const idleSupplementalQuery = {
  isLoading: false,
  isError: false,
  data: [],
  error: null,
}

const cachedProject = {
  id: 'project-1',
  name: '雨夜車站',
  description: '一場重逢。',
  createdAt: '2026-08-08T00:00:00.000Z',
  novelPromotionData: {
    novelText: '雨落在月台上。',
    characters: [],
    locations: [],
  },
}

const cachedEpisode: ProjectHomeEpisode = {
  id: 'episode-1',
  episodeNumber: 1,
  name: '已快取的第一集',
  description: null,
  novelText: '月台上的故事。',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
  thumbnailUrl: null,
  progress: {
    scriptDone: 1,
    scriptTotal: 1,
    storyboardDone: 0,
    storyboardTotal: 1,
    videoDone: 0,
    videoTotal: 1,
  },
}

const allowedAccess = {
  isLoading: false,
  isError: false,
  allowed: true,
  canEdit: true,
  role: 'OWNER',
  refetch: vi.fn(),
}

function renderHome(locale: 'en' | 'zh' = 'zh') {
  const productionMessages = locale === 'en' ? enProduction : zhProduction
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ v2Production: productionMessages }}
    >
      <V2HomeClient projectId="project-1" locale={locale} />
    </NextIntlClientProvider>,
  )
}

describe('V2 Project Home state orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProjectProps.mockReturnValue(idleSupplementalQuery)
    mocks.useProjectHomeEpisodes.mockReturnValue(idleSupplementalQuery)
  })

  it('權限或專案仍在讀取 -> 顯示 loading 狀態', () => {
    mocks.useProjectAccess.mockReturnValue({
      isLoading: true,
      allowed: false,
      refetch: vi.fn(),
    })
    mocks.useProjectData.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    })

    renderHome()

    expect(screen.getByText('正在載入專案首頁')).toBeInTheDocument()
    expect(screen.getByText('正在確認權限並讀取已保存的專案資料。')).toBeInTheDocument()
  })

  it('沒有專案權限 -> 顯示 permission 狀態與重新確認入口', () => {
    mocks.useProjectAccess.mockReturnValue({
      isLoading: false,
      allowed: false,
      refetch: vi.fn(),
    })
    mocks.useProjectData.mockReturnValue({
      isLoading: false,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    })

    renderHome()

    expect(screen.getByText('無法開啟這個專案')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新確認權限' })).toBeInTheDocument()
  })

  it('權限服務 5xx -> 顯示 retry error 而不是 permission 狀態', () => {
    const refetch = vi.fn()
    mocks.useProjectAccess.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('Project access fetch failed: HTTP 503'),
      allowed: false,
      refetch,
    })
    mocks.useProjectData.mockReturnValue({
      isLoading: false,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    })

    renderHome()

    expect(screen.getByText('權限檢查失敗')).toBeInTheDocument()
    expect(
      screen.getByText('Project access fetch failed: HTTP 503'),
    ).toBeInTheDocument()
    expect(screen.queryByText('無法開啟這個專案')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新檢查權限' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('專案 API 失敗 -> 顯示原始錯誤且不渲染首頁內容', () => {
    mocks.useProjectAccess.mockReturnValue({
      isLoading: false,
      allowed: true,
      canEdit: true,
      role: 'OWNER',
      refetch: vi.fn(),
    })
    mocks.useProjectData.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error('HTTP 503'),
      refetch: vi.fn(),
    })

    renderHome()

    expect(screen.getByText('專案首頁載入失敗')).toBeInTheDocument()
    expect(screen.getByText('HTTP 503')).toBeInTheDocument()
    expect(screen.queryByText('專案首頁內容')).not.toBeInTheDocument()
  })

  it('專案背景重抓失敗但有快取 -> 保留首頁並標示 partial', () => {
    mocks.useProjectAccess.mockReturnValue(allowedAccess)
    mocks.useProjectData.mockReturnValue({
      isLoading: false,
      isError: true,
      data: cachedProject,
      error: new Error('HTTP 503'),
      refetch: vi.fn(),
    })

    renderHome()

    expect(screen.getByText('專案首頁內容')).toBeInTheDocument()
    expect(screen.queryByText('專案首頁載入失敗')).not.toBeInTheDocument()
    expect(screen.getByText(/問題：專案基本資料：HTTP 503/)).toBeInTheDocument()
  })

  it('劇集背景重抓失敗但有快取 -> 沿用快取集數且標示 partial', () => {
    mocks.useProjectAccess.mockReturnValue(allowedAccess)
    mocks.useProjectData.mockReturnValue({
      isLoading: false,
      isError: false,
      data: cachedProject,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useProjectHomeEpisodes.mockReturnValue({
      isLoading: false,
      isError: true,
      data: [cachedEpisode],
      error: new Error('HTTP 502'),
    })

    renderHome()

    expect(screen.getByText('集數資料：已快取的第一集')).toBeInTheDocument()
    expect(screen.getByText(/問題：劇集進度：HTTP 502/)).toBeInTheDocument()
  })

  it('道具背景重抓失敗但有快取 -> 沿用快取數量且標示 partial', () => {
    mocks.useProjectAccess.mockReturnValue(allowedAccess)
    mocks.useProjectData.mockReturnValue({
      isLoading: false,
      isError: false,
      data: cachedProject,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useProjectProps.mockReturnValue({
      isLoading: false,
      isError: true,
      data: [{ id: 'prop-1' }, { id: 'prop-2' }],
      error: new Error('HTTP 504'),
    })

    renderHome()

    expect(screen.getByText('道具數：2')).toBeInTheDocument()
    expect(screen.getByText(/問題：道具統計：HTTP 504/)).toBeInTheDocument()
  })

  it('English locale -> 專案狀態與 UiStatePanel 預設標籤使用英文', () => {
    mocks.useProjectAccess.mockReturnValue({
      isLoading: true,
      allowed: false,
      refetch: vi.fn(),
    })
    mocks.useProjectData.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    })

    renderHome('en')

    expect(screen.getByText('Loading Project Home')).toBeInTheDocument()
    expect(screen.getByText('Checking access and loading saved project data.')).toBeInTheDocument()
    expect(screen.getByText('Processing')).toBeInTheDocument()
  })
})

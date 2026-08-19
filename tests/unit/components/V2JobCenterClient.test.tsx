import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zhJobs from '../../../messages/zh/v2Jobs.json'
import type { JobView } from '@/lib/task/job-view'

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  useGenerationJobs: vi.fn(),
  useProjectAccess: vi.fn(),
  useCancelGenerationJob: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}))

vi.mock('@/lib/query/hooks/useGenerationJobs', () => ({
  useGenerationJobs: mocks.useGenerationJobs,
}))

vi.mock('@/lib/query/hooks/useProjectAccess', () => ({
  useProjectAccess: mocks.useProjectAccess,
}))

vi.mock('@/lib/query/mutations/task-mutations', () => ({
  useCancelGenerationJob: mocks.useCancelGenerationJob,
}))

vi.mock('@/app/[locale]/v2/V2StudioUtilityShell', () => ({
  V2StudioUtilityShell: ({ children }: { children: ReactNode }) => (
    <div data-studio-theme="dark">{children}</div>
  ),
}))

import { V2JobCenterClient } from '@/app/[locale]/v2/jobs/V2JobCenterClient'

const globalWithFetch = globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }

function activeJob(): JobView {
  return {
    id: 'task-active',
    type: 'video_panel',
    title: 'Video Panel',
    typeLabel: 'Video Panel',
    targetType: 'StoryboardPanel',
    targetId: 'panel-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status: 'running',
    progress: 36,
    model: 'atlascloud::seedance-2.0-r2v',
    cost: { estimated: 1.5, actual: null, currency: 'CNY' },
    billingStatus: 'reserved',
    refund: { status: 'not_refunded', amount: null },
    error: null,
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:01:00.000Z',
    queuedAt: '2026-08-08T10:00:00.000Z',
    startedAt: '2026-08-08T10:00:10.000Z',
    finishedAt: null,
    durationMs: null,
    attempt: 1,
    maxAttempts: 3,
    stageLabel: 'Rendering',
    canCancel: true,
  }
}

function queryResult(jobs: JobView[] = []) {
  return {
    data: { pages: [{ tasks: jobs, nextCursor: null }] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }
}

function accessResult(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    role: 'editor',
    canEdit: true,
    canView: true,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(async () => undefined),
    ...overrides,
  }
}

function renderClient(initialProjectId: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="zh" messages={{ v2Jobs: zhJobs }}>
        <V2JobCenterClient locale="zh" initialProjectId={initialProjectId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  )
}

describe('V2JobCenterClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalWithFetch.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        projects: [{ id: 'project-1', name: '雨夜車站', canEdit: true }],
        nextCursor: null,
      }),
    }))
    mocks.useProjectAccess.mockReturnValue(accessResult())
    mocks.useGenerationJobs.mockReturnValue(queryResult([activeJob()]))
    mocks.useCancelGenerationJob.mockReturnValue({ mutateAsync: vi.fn() })
  })

  it('真實任務 -> 顯示模型、費用、進度與深色工作室語意', async () => {
    renderClient()

    expect(document.querySelector('[data-studio-theme="dark"]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '生成任務中心' })).toBeInTheDocument()
    expect(screen.getByText('atlascloud::seedance-2.0-r2v')).toBeInTheDocument()
    expect(screen.getByText('36%')).toBeInTheDocument()
    expect(screen.getByText(/CNY\s*1\.50/)).toBeInTheDocument()
    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    expect(globalWithFetch.fetch).toHaveBeenCalledWith(
      '/api/projects/options?limit=200',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('專案權限查詢失敗 -> 顯示可重試錯誤，不誤顯示無權限', () => {
    const refetch = vi.fn(async () => undefined)
    mocks.useProjectAccess.mockReturnValue(accessResult({
      allowed: false,
      canEdit: false,
      canView: false,
      isError: true,
      error: new Error('HTTP 503'),
      refetch,
    }))
    mocks.useGenerationJobs.mockReturnValue(queryResult())

    renderClient('project-1')

    expect(screen.getByText('任務清單載入失敗')).toBeInTheDocument()
    expect(screen.getByText('HTTP 503')).toBeInTheDocument()
    expect(screen.queryByText('無法讀取這個專案的任務')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('Viewer 專案範圍 -> 可看團隊任務但不能取消', () => {
    mocks.useProjectAccess.mockReturnValue(accessResult({ role: 'viewer', canEdit: false }))

    renderClient('project-1')

    expect(screen.getByText('生成中')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消任務' })).not.toBeInTheDocument()
  })

  it('個人範圍中的已撤權專案任務 -> 不顯示必然失敗的取消操作', async () => {
    globalWithFetch.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], nextCursor: null }),
    }))

    renderClient()

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    expect(screen.getByText('生成中')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消任務' })).not.toBeInTheDocument()
  })

  it('套用狀態篩選 -> query 使用 server-side active filter 並顯示 filtered-empty', () => {
    mocks.useGenerationJobs.mockReturnValue(queryResult())
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: '進行中' }))

    expect(mocks.useGenerationJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({ statuses: ['active'] }),
    )
    expect(screen.getByText('沒有符合篩選的任務')).toBeInTheDocument()
  })
})

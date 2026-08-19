import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationSummary } from '@/lib/query/hooks/useNotificationSummary'

const hookMock = vi.hoisted(() => ({
  state: {
    data: undefined as NotificationSummary | undefined,
    error: null as Error | null,
    isError: false,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}))

const translations: Record<string, string> = {
  title: '通知',
  labelDefault: '通知',
  labelWithCount: '通知（{count} 個待處理）',
  titleWithCount: '{count} 個待處理通知',
  loading: '正在載入通知…',
  loadErrorTitle: '無法載入通知',
  loadErrorBody: '通知服務目前沒有回應。你的通知沒有被清除。',
  retry: '重新載入',
  reloading: '重新載入中…',
  sectionIncoming: '收到的編輯請求（{count}）',
  sectionMyRequests: '你的請求',
  sectionAdminDeletions: '你的專案被管理員刪除',
  incomingDescription: '@{name} 想編輯《{project}》',
  anonymousActor: '匿名',
  untitledProject: '未命名',
  messagePrefix: '留言：',
  actionApprove: '批准',
  actionApproving: '批准中…',
  actionDeny: '拒絕',
  actionDenying: '拒絕中…',
  actionRestore: '復原',
  actionRestoring: '復原中…',
  mutationErrorRequest: '無法更新編輯請求。未送出變更。',
  mutationErrorRestore: '無法復原專案。未送出變更。',
  retryAction: '重試這個動作',
  dismissError: '關閉錯誤訊息',
  statusApproved: '已批准',
  statusDenied: '已拒絕',
  statusExpired: '已逾期',
  statusPending: '等待回應…',
  deletedExpired: '已逾期，無法復原',
  deletedDaysLeft: '剩 {days} 天可復原',
  deletedProjectUnavailable: '復原後才能開啟這個專案',
  empty: '目前沒有新通知',
  viewAll: '查看所有專案',
  openProject: '開啟《{project}》',
}

vi.mock('@/lib/query/hooks/useNotificationSummary', () => ({
  useNotificationSummary: () => hookMock.state,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, variables?: Record<string, string | number>) => {
    let value = translations[key] ?? key
    for (const [name, replacement] of Object.entries(variables ?? {})) {
      value = value.replace(`{${name}}`, String(replacement))
    }
    return value
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { name: string }) => <span aria-hidden="true">{name}</span>,
}))

import { NotificationBell } from '@/components/v2/NotificationBell'

const emptySummary: NotificationSummary = {
  badgeCount: 0,
  incomingRequests: [],
  myRequests: [],
  adminDeletions: [],
}

function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell locale="zh" />
      <button type="button">通知外的控制</button>
    </QueryClientProvider>,
  )
}

function openBell() {
  fireEvent.click(screen.getByRole('button', { name: /^通知(?:（.*）)?$/ }))
  return screen.getByRole('dialog', { name: '通知' })
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookMock.state = {
      data: emptySummary,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    }
    vi.stubGlobal('fetch', vi.fn())
  })

  it('載入中 -> 顯示方向明確的 loading，不誤顯示空通知', () => {
    hookMock.state = { ...hookMock.state, data: undefined, isPending: true }
    renderBell()

    const dialog = openBell()
    expect(within(dialog).getByRole('status')).toHaveTextContent('正在載入通知…')
    expect(within(dialog).queryByText('目前沒有新通知')).not.toBeInTheDocument()
  })

  it('摘要失敗 -> 顯示錯誤與 44px 重試，不偽裝成空通知', () => {
    hookMock.state = {
      ...hookMock.state,
      data: undefined,
      error: new Error('HTTP 500'),
      isError: true,
    }
    renderBell()

    const dialog = openBell()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('無法載入通知')
    expect(within(dialog).queryByText('目前沒有新通知')).not.toBeInTheDocument()
    const retry = within(dialog).getByRole('button', { name: '重新載入' })
    expect(retry).toHaveClass('min-h-11')
    fireEvent.click(retry)
    expect(hookMock.state.refetch).toHaveBeenCalledTimes(1)
  })

  it('成功且沒有資料 -> 顯示真正的空狀態', () => {
    renderBell()
    expect(within(openBell()).getByText('目前沒有新通知')).toBeInTheDocument()
  })

  it('有通知 -> 專案 deep link 與總覽路徑都保留 locale', () => {
    hookMock.state = {
      ...hookMock.state,
      data: {
        badgeCount: 1,
        incomingRequests: [{
          id: 'request-1',
          projectId: 'project-incoming',
          project: { id: 'project-incoming', name: '進件專案' },
          requester: { id: 'user-1', name: 'Lin', displayName: '小林' },
          message: null,
          createdAt: '2026-08-09T00:00:00.000Z',
        }],
        myRequests: [{
          id: 'request-2',
          projectId: 'project-mine',
          project: { id: 'project-mine', name: '我的申請專案' },
          status: 'approved',
          message: null,
          createdAt: '2026-08-09T00:00:00.000Z',
          resolvedAt: '2026-08-09T00:01:00.000Z',
        }],
        adminDeletions: [],
      },
    }
    renderBell()

    const dialog = openBell()
    expect(within(dialog).getByRole('link', { name: '開啟《進件專案》' })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-incoming',
    )
    expect(within(dialog).getByRole('link', { name: '開啟《我的申請專案》' })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-mine',
    )
    expect(within(dialog).getByRole('link', { name: '查看所有專案' })).toHaveAttribute(
      'href',
      '/zh/v2',
    )
  })

  it('Escape 或外點關閉 -> 焦點回到通知按鈕', async () => {
    renderBell()
    const trigger = screen.getByRole('button', { name: /^通知(?:（.*）)?$/ })
    trigger.focus()
    openBell()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '通知' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '通知' })).toBeInTheDocument()
    const outside = screen.getByRole('button', { name: '通知外的控制' })
    fireEvent.mouseDown(outside)
    outside.focus()

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog', { name: '通知' })).not.toBeInTheDocument()
  })

  it('摘要重試中 -> 按鈕呈現忙碌且不能重複送出', () => {
    hookMock.state = {
      ...hookMock.state,
      data: undefined,
      error: new Error('HTTP 500'),
      isError: true,
      isFetching: true,
    }
    renderBell()

    const retry = within(openBell()).getByRole('button', { name: '重新載入中…' })
    expect(retry).toBeDisabled()
    expect(retry).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(retry)
    expect(hookMock.state.refetch).not.toHaveBeenCalled()
  })

  it('批准失敗 -> 防止重送、顯示錯誤並可重試同一個動作', async () => {
    hookMock.state = {
      ...hookMock.state,
      data: {
        ...emptySummary,
        badgeCount: 1,
        incomingRequests: [{
          id: 'request-1',
          projectId: 'project-1',
          project: { id: 'project-1', name: '測試專案' },
          requester: { id: 'user-1', name: 'Lin', displayName: null },
          message: null,
          createdAt: '2026-08-09T00:00:00.000Z',
        }],
      },
    }

    let rejectFirst: ((value: { ok: boolean; status: number }) => void) | undefined
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: boolean; status: number }>((resolve) => {
        rejectFirst = resolve
      }))
      .mockResolvedValueOnce({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    renderBell()
    const dialog = openBell()
    const approve = within(dialog).getByRole('button', { name: '批准' })

    fireEvent.click(approve)
    fireEvent.click(approve)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: '批准中…' })).toBeDisabled()

    rejectFirst?.({ ok: false, status: 500 })
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        '無法更新編輯請求。未送出變更。',
      )
    })

    const retryAction = within(dialog).getByRole('button', { name: '重試這個動作' })
    expect(retryAction).toHaveClass('min-h-11')
    fireEvent.click(retryAction)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/edit-requests/request-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
  })

  it('管理員刪除通知 -> 不猜測不可用連結，復原失敗有明確狀態', async () => {
    hookMock.state = {
      ...hookMock.state,
      data: {
        ...emptySummary,
        adminDeletions: [{
          projectId: 'deleted-project',
          projectName: '待復原專案',
          deletedAt: '2026-08-09T00:00:00.000Z',
          deletedBy: 'admin-1',
        }],
      },
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    renderBell()

    const dialog = openBell()
    expect(within(dialog).getByText('復原後才能開啟這個專案')).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: '開啟《待復原專案》' }))
      .not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '復原' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        '無法復原專案。未送出變更。',
      )
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/deleted-project/restore', {
      method: 'POST',
    })
  })
})

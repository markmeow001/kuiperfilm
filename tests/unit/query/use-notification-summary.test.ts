import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchNotificationSummary,
  NotificationSummaryRequestError,
  type NotificationSummary,
} from '@/lib/query/hooks/useNotificationSummary'

const summary: NotificationSummary = {
  badgeCount: 1,
  incomingRequests: [],
  myRequests: [],
  adminDeletions: [],
}

describe('fetchNotificationSummary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('API 成功 -> 保留 credentials 並回傳通知摘要', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => summary,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchNotificationSummary()).resolves.toEqual(summary)
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/summary', {
      credentials: 'include',
    })
  })

  it.each([401, 403, 500])('API 回傳 %s -> 明確失敗，不偽裝成空通知', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status,
    }))

    const request = fetchNotificationSummary()
    await expect(request).rejects.toBeInstanceOf(NotificationSummaryRequestError)
    await expect(request).rejects.toMatchObject({ status })
  })
})

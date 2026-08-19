import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  requireProjectAccess: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('server-only', () => ({}))

vi.mock('next-auth/next', () => ({
  getServerSession: authMocks.getServerSession,
}))

vi.mock('next/navigation', () => ({
  redirect: authMocks.redirect,
  notFound: authMocks.notFound,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: { testAuthOptions: true },
}))

vi.mock('@/lib/api-auth', () => ({
  requireProjectAccess: authMocks.requireProjectAccess,
}))

import {
  requireAuthenticatedPageAccess,
  requireProjectPageReadAccess,
} from '@/lib/auth/page-access'

describe('server page access', () => {
  beforeEach(() => {
    authMocks.getServerSession.mockReset()
    authMocks.requireProjectAccess.mockReset()
    authMocks.redirect.mockClear()
    authMocks.notFound.mockClear()
  })

  it('未登入且帶多值 query -> 導向同語系登入並完整保留 callback', async () => {
    authMocks.getServerSession.mockResolvedValue(null)

    await expect(requireAuthenticatedPageAccess({
      locale: 'zh',
      pathname: '/zh/v2/new',
      searchParams: {
        skill: 'story-to-video',
        ws: 'workspace 1',
        reference: ['actor-a', 'actor-b'],
        episode: 'episode-7',
        startAt: 'storyboard',
        stay: '1',
        omitted: undefined,
      },
    })).rejects.toThrow(
      'NEXT_REDIRECT:/zh/auth/signin?callbackUrl=%2Fzh%2Fv2%2Fnew%3Fskill%3Dstory-to-video%26ws%3Dworkspace%2B1%26reference%3Dactor-a%26reference%3Dactor-b%26episode%3Depisode-7%26startAt%3Dstoryboard%26stay%3D1',
    )

    expect(authMocks.getServerSession).toHaveBeenCalledWith({ testAuthOptions: true })
    expect(authMocks.redirect).toHaveBeenCalledWith(
      '/zh/auth/signin?callbackUrl=%2Fzh%2Fv2%2Fnew%3Fskill%3Dstory-to-video%26ws%3Dworkspace%2B1%26reference%3Dactor-a%26reference%3Dactor-b%26episode%3Depisode-7%26startAt%3Dstoryboard%26stay%3D1',
    )
  })

  it('已登入 -> 回傳原 session 且不導頁', async () => {
    const session = {
      user: {
        id: 'user-1',
        name: 'Josh',
      },
      expires: '2099-01-01T00:00:00.000Z',
    }
    authMocks.getServerSession.mockResolvedValue(session)

    await expect(requireAuthenticatedPageAccess({
      locale: 'en',
      pathname: '/en/v2',
      searchParams: { stay: '1' },
    })).resolves.toBe(session)

    expect(authMocks.redirect).not.toHaveBeenCalled()
  })

  it('讀取 session 發生非預期錯誤 -> 原樣拋出且不改道', async () => {
    const sessionError = new Error('SESSION_STORE_UNAVAILABLE')
    authMocks.getServerSession.mockRejectedValue(sessionError)

    await expect(requireAuthenticatedPageAccess({
      locale: 'zh',
      pathname: '/zh/v2',
    })).rejects.toBe(sessionError)

    expect(authMocks.redirect).not.toHaveBeenCalled()
  })

  it('viewer 具讀取權限 -> 回傳 session 與 viewer effective role', async () => {
    const session = {
      user: { id: 'viewer-1' },
      expires: '2099-01-01T00:00:00.000Z',
    }
    authMocks.getServerSession.mockResolvedValue(session)
    authMocks.requireProjectAccess.mockResolvedValue({
      allowed: true,
      effectiveRole: 'viewer',
    })

    await expect(requireProjectPageReadAccess({
      locale: 'zh',
      pathname: '/zh/v2/workspace/project-1/storyboard',
      projectId: 'project-1',
      searchParams: { episode: ['ep-1', 'ep-2'] },
    })).resolves.toEqual({
      kind: 'allowed',
      session,
      effectiveRole: 'viewer',
    })

    expect(authMocks.requireProjectAccess).toHaveBeenCalledWith(
      'project-1',
      'viewer-1',
      'read',
    )
  })

  it('已登入但無專案權限 -> 回傳不含專案資料的 forbidden 狀態', async () => {
    authMocks.getServerSession.mockResolvedValue({
      user: { id: 'user-2' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    authMocks.requireProjectAccess.mockResolvedValue({
      allowed: false,
      reason: 'NO_ACCESS',
    })

    await expect(requireProjectPageReadAccess({
      locale: 'en',
      pathname: '/en/v2/workspace/private-project',
      projectId: 'private-project',
    })).resolves.toEqual({ kind: 'forbidden' })

    expect(authMocks.notFound).not.toHaveBeenCalled()
  })

  it('專案不存在 -> 委派 Next notFound', async () => {
    authMocks.getServerSession.mockResolvedValue({
      user: { id: 'user-1' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    authMocks.requireProjectAccess.mockResolvedValue({
      allowed: false,
      reason: 'NOT_FOUND',
    })

    await expect(requireProjectPageReadAccess({
      locale: 'zh',
      pathname: '/zh/v2/workspace/missing-project/final',
      projectId: 'missing-project',
    })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(authMocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('專案權限查詢失敗 -> 原樣拋出而不是偽裝成 forbidden', async () => {
    const accessError = new Error('PROJECT_ACCESS_DB_UNAVAILABLE')
    authMocks.getServerSession.mockResolvedValue({
      user: { id: 'user-1' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    authMocks.requireProjectAccess.mockRejectedValue(accessError)

    await expect(requireProjectPageReadAccess({
      locale: 'zh',
      pathname: '/zh/v2/workspace/project-1/voice',
      projectId: 'project-1',
    })).rejects.toBe(accessError)

    expect(authMocks.redirect).not.toHaveBeenCalled()
    expect(authMocks.notFound).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

vi.stubGlobal('React', React)

const accessMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/page-access', () => ({
  requireAuthenticatedPageAccess: accessMock,
}))

vi.mock('@/app/[locale]/v2/V2HomeClient', () => ({
  V2HomeClient: 'v2-home-client',
}))

vi.mock('@/app/[locale]/v2/new/V2NewProjectClient', () => ({
  V2NewProjectClient: 'v2-new-project-client',
}))

import V2RootPage from '@/app/[locale]/v2/page'
import V2NewProjectPage from '@/app/[locale]/v2/new/page'

describe('protected v2 entry pages', () => {
  beforeEach(() => {
    accessMock.mockReset()
    accessMock.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('/v2 帶 query -> render client 前以精確 pathname 與 query 驗證登入', async () => {
    const searchParams = { stay: '1', filter: ['mine', 'recent'] }

    const rendered = await V2RootPage({
      params: Promise.resolve({ locale: 'zh' }),
      searchParams: Promise.resolve(searchParams),
    })

    expect(accessMock).toHaveBeenCalledWith({
      locale: 'zh',
      pathname: '/zh/v2',
      searchParams,
    })
    expect(rendered).toMatchObject({
      type: 'v2-home-client',
      props: { locale: 'zh' },
    })
  })

  it('/v2/new 帶 skill 與 ws -> render client 前把兩者交給登入保護', async () => {
    const searchParams = { skill: 'story-to-video', ws: 'workspace-1' }

    const rendered = await V2NewProjectPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(searchParams),
    })

    expect(accessMock).toHaveBeenCalledWith({
      locale: 'en',
      pathname: '/en/v2/new',
      searchParams,
    })
    expect(rendered).toMatchObject({
      type: 'v2-new-project-client',
      props: { locale: 'en' },
    })
  })

  it('登入保護拒絕 -> 不回傳 page client', async () => {
    accessMock.mockRejectedValue(new Error('NEXT_REDIRECT'))

    await expect(V2RootPage({
      params: Promise.resolve({ locale: 'zh' }),
      searchParams: Promise.resolve({ stay: '1' }),
    })).rejects.toThrow('NEXT_REDIRECT')
  })
})

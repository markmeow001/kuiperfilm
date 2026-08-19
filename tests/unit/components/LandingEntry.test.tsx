import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionMock = vi.hoisted(() => ({ data: null as null | { user: { name: string; role: string } } }))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: sessionMock.data }),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'zh' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    eyebrow: 'AI 影像製作系統',
    heroTitle: '把創作意圖，變成可追蹤的製作流程',
    heroBody: '從劇本到交付，每一個決定都有來源。',
    enterWorkspace: '進入工作區',
    getStarted: '建立第一個專案',
    signIn: '登入工作室',
    invitationOnly: '邀請制工作室',
    continueProject: '繼續最近專案',
    pipelineTitle: 'Production lineage',
    pipelineDescription: '每個素材知道自己從哪裡來。',
    projectLabel: '專案',
    episodeLabel: '集數',
    sceneLabel: '場景',
    shotLabel: '鏡頭',
    takeLabel: '版本',
    deliveryLabel: '交付',
    capabilityScript: '劇本與拆解',
    capabilityScriptBody: '場景、角色與道具保持連動。',
    capabilityVisual: '視覺製作',
    capabilityVisualBody: '分鏡、版本與生成任務集中管理。',
    capabilityFinish: '剪輯與交付',
    capabilityFinishBody: '把選定素材帶進剪輯與交付。',
    statusLabel: '目前狀態',
    statusValue: 'Private beta · Invite only',
    footerLine: 'From script to delivery',
  })[key] ?? key,
}))

import Home from '@/app/[locale]/page'

describe('landing entry', () => {
  beforeEach(() => {
    sessionMock.data = null
  })

  it('未登入 -> 顯示 locale-preserving 的登入與註冊入口', () => {
    render(<Home />)

    expect(screen.getByRole('heading', {
      name: '把創作意圖，變成可追蹤的製作流程',
    })).toBeInTheDocument()
    const signInLinks = screen.getAllByRole('link', { name: '登入工作室' })
    expect(signInLinks).not.toHaveLength(0)
    for (const link of signInLinks) {
      expect(link).toHaveAttribute('href', '/zh/auth/signin')
    }
    expect(screen.getByRole('link', { name: /建立第一個專案/ })).toHaveAttribute(
      'href',
      '/zh/auth/signup',
    )
    expect(screen.getByTestId('landing-root')).toHaveClass(
      'bg-[#070B0F]',
      '[--primary-400:#55AFC0]',
    )
  })

  it('已登入 -> 主要 CTA 直接回到專案工作區', () => {
    sessionMock.data = { user: { name: 'Josh', role: 'admin' } }
    render(<Home />)

    const workspaceLinks = screen.getAllByRole('link', { name: '進入工作區' })
    expect(workspaceLinks).not.toHaveLength(0)
    for (const link of workspaceLinks) {
      expect(link).toHaveAttribute('href', '/zh/v2')
    }
  })
})

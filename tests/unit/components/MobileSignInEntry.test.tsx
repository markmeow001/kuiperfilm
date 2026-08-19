import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({ signIn: vi.fn() }))
const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('next-auth/react', () => ({ signIn: authMock.signIn }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navigationMock.push,
    refresh: navigationMock.refresh,
  }),
  useParams: () => ({ locale: 'zh' }),
  useSearchParams: () => navigationMock.searchParams,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    welcomeBack: '歡迎回來',
    phoneNumber: '帳號',
    phoneNumberPlaceholder: '輸入帳號',
    password: '密碼',
    passwordPlaceholder: '輸入密碼',
    loginFailed: '登入失敗',
    loginError: '登入錯誤',
    loginButton: '登入',
    loginButtonLoading: '登入中',
  })[key] ?? key,
}))

import MobileSignIn from '@/app/[locale]/m/auth/signin/page'

describe('mobile sign-in entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMock.searchParams = new URLSearchParams()
  })

  it('使用與桌面相同的 night-blue、blue action 與 cyan focus', () => {
    render(<MobileSignIn />)

    expect(screen.getByRole('main')).toHaveClass('bg-[#070B0F]', '[--primary-400:#55AFC0]')
    expect(screen.getByRole('textbox', { name: '帳號' })).toHaveClass(
      'min-h-12',
      'bg-[#0D141B]',
      'focus:border-[#55AFC0]',
    )
    expect(screen.getByRole('button', { name: '登入' })).toHaveClass(
      'min-h-12',
      'bg-[#3E73B9]',
    )
  })

  it('登入成功且有 callback -> 回到原始 mobile 深連結', async () => {
    navigationMock.searchParams = new URLSearchParams(
      'callbackUrl=%2Fzh%2Fm%2Fprojects%2Fproject-1%2Fepisodes%2Fep-2',
    )
    authMock.signIn.mockResolvedValue({ error: null })
    render(<MobileSignIn />)

    fireEvent.change(screen.getByRole('textbox', { name: '帳號' }), {
      target: { value: 'reviewer' },
    })
    fireEvent.change(screen.getByLabelText('密碼'), {
      target: { value: 'secret' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '登入' }).closest('form')!)

    await waitFor(() => {
      expect(navigationMock.push).toHaveBeenCalledWith(
        '/zh/m/projects/project-1/episodes/ep-2',
      )
    })
  })
})

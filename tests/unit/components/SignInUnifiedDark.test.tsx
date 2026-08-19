import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  signIn: vi.fn(),
}))

const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  locale: 'zh',
  searchParams: new URLSearchParams(),
}))

vi.mock('next-auth/react', () => ({
  signIn: authMock.signIn,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navigationMock.push,
    refresh: navigationMock.refresh,
  }),
  useParams: () => ({ locale: navigationMock.locale }),
  useSearchParams: () => navigationMock.searchParams,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    welcomeBack: '歡迎回來',
    loginTo: '登入工作室',
    phoneNumber: '帳號',
    phoneNumberPlaceholder: '輸入帳號',
    password: '密碼',
    passwordPlaceholder: '輸入密碼',
    loginFailed: '登入失敗',
    loginError: '登入錯誤',
    loginButton: '登入',
    loginButtonLoading: '登入中',
    noAccount: '沒有帳號',
    signupNow: '立即註冊',
    backToHome: '返回首頁',
    createAccount: '建立帳號',
    joinPlatform: '加入工作室',
    inviteCode: '邀請碼',
    inviteCodePlaceholder: '輸入邀請碼',
    confirmPassword: '確認密碼',
    confirmPasswordPlaceholder: '再次輸入密碼',
    passwordMinPlaceholder: '至少六個字元',
    inviteRequired: '請輸入邀請碼',
    passwordMismatch: '密碼不一致',
    passwordTooShort: '密碼太短',
    signupSuccess: '註冊成功',
    signupFailed: '註冊失敗',
    signupError: '註冊錯誤',
    signupButton: '建立帳號',
    signupButtonLoading: '建立中',
    hasAccount: '已有帳號',
    signinNow: '立即登入',
  })[key] ?? key,
}))

import SignIn from '@/app/[locale]/auth/signin/page'
import SignUp from '@/app/[locale]/auth/signup/page'

beforeEach(() => {
  vi.clearAllMocks()
  navigationMock.locale = 'zh'
  navigationMock.searchParams = new URLSearchParams()
})

describe('SignIn unified dark DOM contract', () => {
  it('renders accessible controls with blue action, cyan focus, and mobile touch floors', () => {
    render(<SignIn />)

    const username = screen.getByRole('textbox', { name: '帳號' })
    const password = screen.getByLabelText('密碼')
    const submit = screen.getByRole('button', { name: '登入' })

    expect(username).toHaveClass('min-h-12', 'bg-[#0D141B]', 'focus:border-[#55AFC0]')
    expect(username).toHaveAttribute('autocomplete', 'username')
    expect(password).toHaveClass('min-h-12', 'focus:ring-[#55AFC0]/25')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(submit).toHaveClass('min-h-12', 'bg-[#3E73B9]', 'focus-visible:ring-[#55AFC0]')
    expect(screen.getByRole('main').parentElement).toHaveClass(
      'overflow-x-hidden',
      'bg-[#070B0F]',
      '[--primary-400:#55AFC0]',
    )
    expect(screen.getByRole('link', { name: '立即註冊' })).toHaveClass('min-h-11')
  })

  it('登入成功且有安全 callback -> 回到原始專案深連結', async () => {
    navigationMock.searchParams = new URLSearchParams(
      'callbackUrl=%2Fzh%2Fv2%2Fworkspace%2Fproject-1%2Fstoryboard%3Fepisode%3Dep-2',
    )
    authMock.signIn.mockResolvedValue({ error: null })
    render(<SignIn />)

    fireEvent.change(screen.getByRole('textbox', { name: '帳號' }), {
      target: { value: 'director' },
    })
    fireEvent.change(screen.getByLabelText('密碼'), {
      target: { value: 'secret' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '登入' }).closest('form')!)

    await waitFor(() => {
      expect(navigationMock.push).toHaveBeenCalledWith(
        '/zh/v2/workspace/project-1/storyboard?episode=ep-2',
      )
    })
  })

  it('登入成功但 callback 是外部網址 -> 回到 locale 專案首頁', async () => {
    navigationMock.locale = 'en'
    navigationMock.searchParams = new URLSearchParams(
      'callbackUrl=https%3A%2F%2Fevil.example%2Fphish',
    )
    authMock.signIn.mockResolvedValue({ error: null })
    render(<SignIn />)

    fireEvent.change(screen.getByRole('textbox', { name: '帳號' }), {
      target: { value: 'director' },
    })
    fireEvent.change(screen.getByLabelText('密碼'), {
      target: { value: 'secret' },
    })
    fireEvent.submit(screen.getByRole('button', { name: '登入' }).closest('form')!)

    await waitFor(() => {
      expect(navigationMock.push).toHaveBeenCalledWith('/en/v2')
    })
  })
})

describe('SignUp unified dark DOM contract', () => {
  it('uses the shared night palette, semantic autocomplete, and 44px touch floors', () => {
    render(<SignUp />)

    const invite = screen.getByRole('textbox', { name: '邀請碼' })
    const username = screen.getByRole('textbox', { name: '帳號' })
    const password = screen.getByLabelText('密碼')
    const confirmation = screen.getByLabelText('確認密碼')
    const submit = screen.getByRole('button', { name: '建立帳號' })

    expect(invite).toHaveClass('min-h-12', 'bg-[#0D141B]', 'focus:border-[#55AFC0]')
    expect(invite).toHaveAttribute('autocomplete', 'off')
    expect(username).toHaveAttribute('autocomplete', 'username')
    expect(username).toHaveAttribute('inputmode', 'text')
    expect(username).toHaveAttribute('autocapitalize', 'off')
    expect(username).toHaveAttribute('spellcheck', 'false')
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    expect(confirmation).toHaveAttribute('autocomplete', 'new-password')
    expect(submit).toHaveClass('min-h-12', 'bg-[#3E73B9]', 'focus-visible:ring-[#55AFC0]')
    expect(screen.getByRole('main').parentElement).toHaveClass(
      'overflow-x-hidden',
      'bg-[#070B0F]',
      '[--primary-400:#55AFC0]',
    )
    expect(screen.getByRole('link', { name: '立即登入' })).toHaveClass('min-h-11')
  })

  it('announces validation failures as alerts', async () => {
    render(<SignUp />)

    fireEvent.submit(screen.getByRole('button', { name: '建立帳號' }).closest('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent('請輸入邀請碼')
  })

  it('由受保護頁進入註冊 -> 登入連結保留 callback', () => {
    navigationMock.searchParams = new URLSearchParams(
      'callbackUrl=%2Fzh%2Fcanvas%3Fcanvas%3Dcanvas-1',
    )
    render(<SignUp />)

    expect(screen.getByRole('link', { name: '立即登入' })).toHaveAttribute(
      'href',
      '/zh/auth/signin?callbackUrl=%2Fzh%2Fcanvas%3Fcanvas%3Dcanvas-1',
    )
  })
})

import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({
  session: null as null | { user: { role: string } },
  signOut: vi.fn(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: authState.session }),
  signOut: authState.signOut,
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (namespace: string) => (key: string) => {
    const copy: Record<string, string> = {
      workspace: 'Workspace',
      workspaces: 'Workspaces & Team',
      assetHub: 'Asset Hub',
      profile: 'Profile',
      admin: 'Admin',
      signin: 'Sign in',
      signup: 'Sign up',
      logout: 'Logout',
      betaVersion: 'Beta',
    }
    return namespace === 'common' && key === 'betaVersion' ? 'Beta' : (copy[key] ?? key)
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/components/LanguageSwitcher', () => ({ default: () => <span>Language</span> }))
vi.mock('@/components/ThemeToggle', () => ({ default: () => <span>Theme</span> }))

import Navbar from '@/components/Navbar'

beforeEach(() => {
  authState.session = null
  authState.signOut.mockReset()
})

describe('Navbar brand and locale continuity', () => {
  it('keeps signed-out entry links in the active locale', () => {
    render(<Navbar />)

    expect(screen.getByRole('link', { name: 'Kuiper 影界 production home' })).toHaveAttribute('href', '/en')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/en/auth/signin')
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/en/auth/signup')
  })

  it('keeps member navigation and sign-out return in the active locale', () => {
    authState.session = { user: { role: 'member' } }
    render(<Navbar />)

    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/en/v2')
    expect(screen.getByRole('link', { name: 'Workspaces & Team' })).toHaveAttribute('href', '/en/workspaces')
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(authState.signOut).toHaveBeenCalledWith({ callbackUrl: '/en' })
  })

  it('keeps administrator tools in the active locale', () => {
    authState.session = { user: { role: 'admin' } }
    render(<Navbar />)

    expect(screen.getByRole('link', { name: 'Asset Hub' })).toHaveAttribute('href', '/en/workspace/asset-hub')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/en/profile')
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/en/admin')
  })
})

import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  signOut: vi.fn(),
}))

const translations: Record<string, string> = {
  signIn: 'Sign in',
  fallbackUser: 'User',
  fallbackRole: 'MEMBER',
  workspaces: 'Workspaces and team',
  workspacesHint: 'Manage organizations and members',
  settings: 'Settings',
  settingsHint: 'Provider keys and default models',
  admin: 'Admin console',
  adminHint: 'Users, jobs, and invitation codes',
  signOut: 'Sign out',
  accountMenu: 'Account and team menu',
}

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: {
        name: 'Alex Director',
        email: 'alex@example.test',
        role: 'admin',
      },
    },
    status: 'authenticated',
  }),
  signOut: authMock.signOut,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => translations[key] ?? key,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { UserMenu } from '@/components/v2/UserMenu'

describe('UserMenu global navigation', () => {
  it('English locale -> account actions use translated labels and locale-safe routes', () => {
    render(<UserMenu locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Alex Director · admin' }))

    expect(screen.getByRole('link', { name: /Workspaces and team/ })).toHaveAttribute(
      'href',
      '/en/workspaces',
    )
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute(
      'href',
      '/en/profile',
    )
    expect(screen.getByRole('link', { name: /Admin console/ })).toHaveAttribute(
      'href',
      '/en/admin',
    )
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveClass('min-h-11')
  })

  it('Escape -> closes account menu and restores focus to its trigger', () => {
    render(<UserMenu locale="zh" />)
    const trigger = screen.getByRole('button', { name: 'Alex Director · admin' })
    trigger.focus()
    fireEvent.click(trigger)
    const workspaces = screen.getByRole('link', { name: /Workspaces and team/ })
    workspaces.focus()
    expect(workspaces).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('navigation', { name: 'Account and team menu' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

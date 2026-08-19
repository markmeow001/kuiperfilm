import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/lib/query/hooks/useSkills', () => ({
  useSkills: () => ({ data: { skills: [] }, isLoading: false }),
}))

vi.mock('@/app/[locale]/v2/V2HomeRail', () => ({
  V2HomeRail: () => <nav data-testid="home-rail" />,
}))

import { V2NewProjectClient } from '@/app/[locale]/v2/new/V2NewProjectClient'

describe('V2 new project wizard', () => {
  beforeEach(() => {
    push.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ workspaces: [] }),
    })))
  })

  it('reveals the project, production, and script steps in order', () => {
    render(<V2NewProjectClient locale="zh" />)

    expect(document.querySelector('[data-studio-theme="dark"]')).toBeInTheDocument()
    expect(screen.getByText('form.nameLabel')).toBeInTheDocument()
    expect(screen.queryByText('form.modeLabel')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('form.namePlaceholder'), {
      target: { value: '雨夜車站' },
    })
    fireEvent.click(screen.getByRole('button', { name: /wizard.next/ }))

    expect(screen.getByText('form.modeLabel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /form.modeR2vTitle/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText('upload.label')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /wizard.next/ }))
    expect(screen.getByText('upload.label')).toBeInTheDocument()
  })
})

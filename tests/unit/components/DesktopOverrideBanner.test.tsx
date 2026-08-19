import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/zh/m/projects',
}))

import { DesktopOverrideBanner } from '@/app/[locale]/m/DesktopOverrideBanner'

describe('DesktopOverrideBanner', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    })
  })

  it('uses the unified studio palette and 44px mobile controls', async () => {
    render(<DesktopOverrideBanner />)

    const switchButton = await screen.findByRole('button', { name: '切到桌面版' })
    const dismissButton = screen.getByRole('button', { name: '關閉提示' })

    await waitFor(() => expect(switchButton).toBeVisible())
    expect(switchButton).toHaveClass('min-h-11', 'border-[#31505D]', 'text-[#79C7D4]')
    expect(dismissButton).toHaveClass('min-h-11', 'min-w-11')
    expect(switchButton.className).not.toContain('amber')
  })
})

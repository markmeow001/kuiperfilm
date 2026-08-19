import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import enStoryboard from '../../../messages/en/v2Storyboard.json'
import zhStoryboard from '../../../messages/zh/v2Storyboard.json'
import { StoryboardEpisodeAppearanceNotice } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/StoryboardEpisodeAppearanceNotice'

function renderNotice(
  locale: 'zh' | 'en',
  gate: Parameters<typeof StoryboardEpisodeAppearanceNotice>[0]['gate'],
  onRetry = vi.fn(),
) {
  const messages = locale === 'zh' ? zhStoryboard : enStoryboard
  render(
    <NextIntlClientProvider locale={locale} messages={{ v2Storyboard: messages }}>
      <StoryboardEpisodeAppearanceNotice gate={gate} onRetry={onRetry} />
    </NextIntlClientProvider>,
  )
  return onRetry
}

describe('StoryboardEpisodeAppearanceNotice', () => {
  it('[bindings are loading] -> shows a visible generation block without a retry action', () => {
    renderNotice('zh', { status: 'loading' })

    expect(screen.getByRole('status')).toHaveTextContent('正在確認本集角色造型')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('[cached bindings have an error] -> keeps generation blocked and offers an explicit retry', () => {
    const onRetry = renderNotice('en', { status: 'error' })

    expect(screen.getByRole('alert')).toHaveTextContent(/episode character looks failed to load/i)
    fireEvent.click(screen.getByRole('button', { name: /reload episode looks/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('[binding is missing] -> names the affected character and does not imply fallback', () => {
    renderNotice('zh', {
      status: 'binding-missing',
      characterId: 'character-1',
      characterName: '林真',
    })

    expect(screen.getByRole('alert')).toHaveTextContent('林真')
    expect(screen.getByRole('alert')).toHaveTextContent('缺少本集造型綁定')
  })
})

import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import enPlayground from '../../../messages/en/playground.json'
import zhPlayground from '../../../messages/zh/playground.json'

const mocks = vi.hoisted(() => ({
  setOutputType: vi.fn(),
  isBusy: false,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/[locale]/playground/usePlaygroundController', () => ({
  usePlaygroundController: () => ({
    isBusy: mocks.isBusy,
    setOutputType: mocks.setOutputType,
  }),
}))

vi.mock('@/components/v2/CreativeToolShell', () => ({
  CreativeToolShell: ({
    eyebrow,
    title,
    backHref,
    backLabel,
    actions,
    children,
  }: {
    eyebrow: ReactNode
    title: ReactNode
    backHref: string
    backLabel: string
    actions?: ReactNode
    children: ReactNode
  }) => (
    <section data-creative-tool-shell="studio" data-studio-theme="dark">
      <a href={backHref} aria-label={backLabel}>{backLabel}</a>
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <div data-creative-tool-actions>{actions}</div>
      <main data-creative-tool-content>{children}</main>
    </section>
  ),
}))

vi.mock('@/app/[locale]/playground/PlaygroundWorkspacePicker', () => ({
  PlaygroundWorkspacePicker: ({
    label,
    personalLabel,
  }: {
    label: string
    personalLabel: string
  }) => <button type="button" aria-label={label}>{personalLabel}</button>,
}))

vi.mock('@/app/[locale]/playground/ImageStudio', () => ({
  ImageStudio: () => <section aria-label="image-studio" />,
}))
vi.mock('@/app/[locale]/playground/VideoStudio', () => ({
  VideoStudio: () => <section aria-label="video-studio" />,
}))
vi.mock('@/app/[locale]/playground/ReconstructionStudio', () => ({
  ReconstructionStudio: () => <section aria-label="reconstruction-studio" />,
}))
vi.mock('@/app/[locale]/playground/DiscussionStudio', () => ({
  DiscussionStudio: () => <section aria-label="discussion-studio" />,
}))
vi.mock('@/app/[locale]/playground/ResultLightbox', () => ({
  ResultLightbox: () => <div data-testid="result-lightbox" />,
}))

import { V2PlaygroundClient } from '@/app/[locale]/playground/V2PlaygroundClient'

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
}

function renderPlayground(locale: 'zh' | 'en' = 'zh') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ playground: locale === 'en' ? enPlayground : zhPlayground }}
    >
      <V2PlaygroundClient locale={locale} />
    </NextIntlClientProvider>,
  )
}

describe('V2PlaygroundClient CreativeToolShell migration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isBusy = false
    setViewport(1440)
  })

  it('[繁中預設模式] -> 共用深色 shell 顯示繁中頁首且圖片模式可辨識', () => {
    const { container } = renderPlayground('zh')

    expect(container.querySelector('[data-creative-tool-shell="studio"]')).toHaveAttribute(
      'data-studio-theme',
      'dark',
    )
    expect(screen.getByRole('heading', { name: '創作 Playground' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到專案' })).toHaveAttribute('href', '/zh/v2')
    expect(screen.queryByText('创作 Playground')).not.toBeInTheDocument()
    expect(screen.queryByText('图片')).not.toBeInTheDocument()

    const modeGroup = screen.getByRole('group', { name: '創作 Playground' })
    expect(within(modeGroup).getByRole('button', { name: /圖片/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('region', { name: 'image-studio' })).toBeInTheDocument()
    expect(screen.getByTestId('result-lightbox')).toBeInTheDocument()
  })

  it('[切換影片、實拍重建與劇本討論] -> 保留既有 outputType 與結果燈箱邊界', () => {
    renderPlayground('zh')
    const modeGroup = screen.getByRole('group', { name: '創作 Playground' })

    fireEvent.click(within(modeGroup).getByRole('button', { name: /影片/ }))
    expect(mocks.setOutputType).toHaveBeenLastCalledWith('video')
    expect(screen.getByRole('region', { name: 'video-studio' })).toBeInTheDocument()
    expect(screen.getByTestId('result-lightbox')).toBeInTheDocument()

    fireEvent.click(within(modeGroup).getByRole('button', { name: /實拍重建/ }))
    expect(mocks.setOutputType).toHaveBeenLastCalledWith('video')
    expect(screen.getByRole('region', { name: 'reconstruction-studio' })).toBeInTheDocument()
    expect(screen.queryByTestId('result-lightbox')).not.toBeInTheDocument()

    mocks.setOutputType.mockClear()
    fireEvent.click(within(modeGroup).getByRole('button', { name: /劇本討論/ }))
    expect(mocks.setOutputType).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'discussion-studio' })).toBeInTheDocument()
    expect(screen.queryByTestId('result-lightbox')).not.toBeInTheDocument()
  })

  it.each([390, 768, 1440])(
    '[%ipx] -> 四個模式控制保持 44px、可聚焦且不靠顏色表達選取',
    (width) => {
      setViewport(width)
      renderPlayground('zh')

      const modeGroup = screen.getByRole('group', { name: '創作 Playground' })
      const controls = within(modeGroup).getAllByRole('button')
      expect(controls).toHaveLength(4)
      for (const control of controls) {
        expect(control).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:ring-2')
        expect(control).toHaveAttribute('aria-pressed')
      }
      expect(modeGroup).toHaveClass('max-w-full', 'overflow-x-auto')
    },
  )

  it('[英文 locale] -> shell 與所有模式標籤不回退成中文', () => {
    renderPlayground('en')

    expect(screen.getByRole('heading', { name: 'Creative Playground' })).toBeInTheDocument()
    const modeGroup = screen.getByRole('group', { name: 'Creative Playground' })
    expect(within(modeGroup).getByRole('button', { name: /Image/ })).toBeInTheDocument()
    expect(within(modeGroup).getByRole('button', { name: /Video/ })).toBeInTheDocument()
    expect(within(modeGroup).getByRole('button', { name: /Live-action rebuild/ })).toBeInTheDocument()
    expect(within(modeGroup).getByRole('button', { name: /Script room/ })).toBeInTheDocument()
    expect(screen.queryByText(/實拍重建|劇本討論|圖片/)).not.toBeInTheDocument()
  })

  it('[繁中內容與觸控] -> 圖片工作台不殘留簡體，重置操作保留 44px', () => {
    const imageStudioSource = readFileSync('src/app/[locale]/playground/ImageStudio.tsx', 'utf8')

    expect(zhPlayground.image.emptyTitle).toBe('描述一個畫面，或從製作任務開始')
    expect(zhPlayground.image.emptyDescription).toContain('貼上圖片作為參考')
    expect(zhPlayground.image.estimatedCost).toBe('預估成本')
    expect(zhPlayground.image.noModel).toContain('尚未啟用圖片模型')
    expect(JSON.stringify(zhPlayground)).not.toMatch(/一个|画面|贴上|视觉|场景|电影|图片|设定|进阶|预估|启用|请到|参考|张|提示词|排队/)
    expect(imageStudioSource).toContain('min-h-11 min-w-11')
  })

  it('[影片模式 390/768] -> 三欄改為可捲動單欄，操作維持 44px', () => {
    const source = readFileSync('src/app/[locale]/playground/VideoStudio.tsx', 'utf8')
    const elementsModal = readFileSync('src/app/[locale]/playground/ElementsModal.tsx', 'utf8')
    const css = readFileSync('src/app/[locale]/playground/VideoStudio.module.css', 'utf8')

    expect(source).toContain('flex-col overflow-y-auto')
    expect(source).toContain('lg:flex-row lg:overflow-hidden')
    expect(source).toContain('w-full min-w-0 flex-none')
    expect(source).toContain('min-h-11')
    expect(source).not.toMatch(/hover:border-(?:accent|violet|purple|pink|magenta|fuchsia)/i)
    expect(source).not.toMatch(/(?:bg|border|text)-stone-/)
    expect(source).not.toMatch(/>\s*Elements(?:\s|<)/)
    expect(source).not.toContain("? 'On' : 'Off'")
    expect(source).not.toContain('prompt 打')
    expect(elementsModal).toContain('role="dialog"')
    expect(elementsModal).toContain('aria-modal="true"')
    expect(elementsModal).toContain('min-h-11 min-w-11')
    expect(elementsModal).not.toContain('（Elements）')
    expect(elementsModal).not.toMatch(/(?:bg|border|text)-stone-/)
    expect(zhPlayground.video.elements).toBe('主體')
    expect(zhPlayground.video.enabled).toBe('開')
    expect(zhPlayground.video.disabled).toBe('關')
    expect(zhPlayground.video.prompt).toBe('描述詞')
    expect(JSON.stringify(zhPlayground.video)).not.toMatch(/\b(?:Elements|On|Off|Prompt|Result)\b/)
    expect(css).toContain('height: 100%')
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).toContain('min-height: 44px')
  })

  it('[頁面語意] -> 共用工具殼保留唯一 main，模式工作區不再巢狀 main', () => {
    for (const file of ['ImageStudio.tsx', 'DiscussionStudio.tsx', 'ReconstructionStudio.tsx']) {
      const source = readFileSync(`src/app/[locale]/playground/${file}`, 'utf8')
      expect(source).not.toContain('<main')
    }
  })
})

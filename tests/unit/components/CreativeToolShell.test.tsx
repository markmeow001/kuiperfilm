// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreativeToolShell } from '@/components/v2/CreativeToolShell'

describe('CreativeToolShell', () => {
  it('完整工具頁 -> 提供單一品牌、返回操作與可命名工作區', () => {
    render(
      <CreativeToolShell
        locale="zh"
        eyebrow="Creative tool 07"
        title="無限畫布"
        description="把鏡頭串成完整製作流程"
        backHref="/zh/v2"
        backLabel="返回製作首頁"
        actions={<button type="button">資產庫</button>}
      >
        <div>畫布內容</div>
      </CreativeToolShell>,
    )

    expect(screen.getByRole('heading', { name: '無限畫布', level: 1 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Kuiper 影界 製作首頁' })).toHaveAttribute(
      'href',
      '/zh/v2',
    )
    expect(screen.getByRole('link', { name: '返回製作首頁' })).toHaveAttribute(
      'href',
      '/zh/v2',
    )
    expect(screen.getByRole('button', { name: '資產庫' })).toBeTruthy()
    expect(screen.getByRole('main')).toHaveTextContent('畫布內容')
    expect(screen.getByText('把鏡頭串成完整製作流程')).toBeTruthy()
  })

  it('English route -> keeps locale-aware production navigation', () => {
    render(
      <CreativeToolShell
        locale="en"
        eyebrow="Creative tool"
        title="Playground"
        backHref="/en/v2/jobs"
        backLabel="Back to jobs"
      >
        <div>Workspace</div>
      </CreativeToolShell>,
    )

    expect(screen.getByRole('link', { name: 'Kuiper 影界 production home' })).toHaveAttribute(
      'href',
      '/en/v2',
    )
    expect(screen.getByRole('link', { name: 'Back to jobs' })).toHaveAttribute(
      'href',
      '/en/v2/jobs',
    )
  })

  it('省略可選內容 -> 不渲染空的說明與操作容器', () => {
    const { container } = render(
      <CreativeToolShell
        locale="en"
        eyebrow="Creative tool"
        title="Playground"
        backHref="/en/v2"
        backLabel="Back to production"
      >
        <div>Workspace</div>
      </CreativeToolShell>,
    )

    expect(container.querySelector('[data-creative-tool-description]')).toBeNull()
    expect(container.querySelector('[data-creative-tool-actions]')).toBeNull()
  })

  it('visual contract -> uses only darkroom/cyan shell tokens and responsive accessibility rules', () => {
    const css = readFileSync('src/components/v2/CreativeToolShell.module.css', 'utf8')

    expect(css).toContain('var(--darkroom-canvas')
    expect(css).toContain('var(--darkroom-surface')
    expect(css).toContain('var(--process-cyan')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).toContain('@media (max-width: 390px)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).not.toMatch(/magenta|violet|pink|purple/i)
    expect(css).not.toContain('font-family')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Live Composite CreativeToolShell contract', () => {
  it('[Live Composite 入口] -> 使用共用製作工具外殼且不保留自建頁首', () => {
    const source = readFileSync(
      'src/app/[locale]/live-composite/LiveCompositeClient.tsx',
      'utf8',
    )

    expect(source).toContain(
      "import { CreativeToolShell } from '@/components/v2/CreativeToolShell'",
    )
    expect(source).toContain('eyebrow="創作工具"')
    expect(source).toContain('title="AI 實拍重製"')
    expect(source).toContain('backLabel="返回製作首頁"')
    expect(source).toContain('data-live-composite-workspace')
    expect(source).toContain('data-live-composite-source-status')
    expect(source).not.toContain("import Link from 'next/link'")
    expect(source).not.toContain('className="kuiper-studio-page flex h-dvh')
    expect(source).not.toContain('<header className=')
  })

  it('[模式導覽] -> 只在共用頁首呈現，資產側欄不保留第二份選擇器', () => {
    const client = readFileSync(
      'src/app/[locale]/live-composite/LiveCompositeClient.tsx',
      'utf8',
    )
    const assetPanel = readFileSync(
      'src/app/[locale]/live-composite/CompositeAssetPanel.tsx',
      'utf8',
    )

    expect(client).toMatch(/actions=\{\s*<LiveCompositeModeSelector/)
    expect(assetPanel).not.toContain('import { LiveCompositeModeSelector')
    expect(assetPanel).not.toContain('<LiveCompositeModeSelector')
    expect(assetPanel).not.toContain('onModeChange')
  })

  it('[外殼色票] -> 專屬樣式只使用夜藍、青色與 44px 操作契約', () => {
    const css = readFileSync(
      'src/app/[locale]/live-composite/LiveCompositeShell.module.css',
      'utf8',
    )
    const selector = readFileSync(
      'src/app/[locale]/live-composite/LiveCompositeModeSelector.tsx',
      'utf8',
    )

    expect(css).toContain('var(--darkroom-canvas)')
    expect(css).toContain('var(--darkroom-border)')
    expect(css).toContain('var(--process-cyan)')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media (max-width: 390px)')
    expect(`${css}\n${selector}`).not.toMatch(
      /magenta|violet|pink|purple|fuchsia/i,
    )
  })

  it('[390px 工作區] -> 設定與預覽改為垂直排列，不把右側結果裁掉', () => {
    const client = readFileSync(
      'src/app/[locale]/live-composite/LiveCompositeClient.tsx',
      'utf8',
    )
    const css = readFileSync(
      'src/app/[locale]/live-composite/LiveCompositeShell.module.css',
      'utf8',
    )

    expect(client).toContain('styles.stageColumn')
    expect(css).toContain('.workspaceBody > aside')
    expect(css).toContain('flex-direction: column')
    expect(css).toContain('overflow-y: auto')
    expect(css).toContain('min-height: 480px')
  })
})

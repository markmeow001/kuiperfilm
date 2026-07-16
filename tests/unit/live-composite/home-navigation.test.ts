import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('live composite home navigation', () => {
  it('專案首頁主要工具列 -> 顯示 AI 實拍合成入口', () => {
    const source = readFileSync(
      'src/app/[locale]/v2/V2HomeRail.tsx',
      'utf8',
    )

    expect(source).toContain('href: `/${locale}/live-composite`')
    expect(source).toContain("icon: 'video'")
    expect(source).toContain("label: t('compositeLabel')")
    expect(source).toContain("shortLabel: t('composite')")
    expect(source).toContain('aria-label={item.label}')
  })
})

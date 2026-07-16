import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('live composite home navigation', () => {
  it('專案首頁頂部工具列 -> 顯示 AI 實拍合成入口', () => {
    const source = readFileSync(
      'src/app/[locale]/v2/V2HomeClient.tsx',
      'utf8',
    )

    expect(source).toContain('href={`/${locale}/live-composite`}')
    expect(source).toContain('aria-label="AI 實拍合成"')
    expect(source).toContain('AI 實拍合成')
    expect(source).toContain('<AppIcon name="video"')
    expect(source).toContain('<span className="hidden 2xl:inline">AI 實拍合成</span>')
  })
})

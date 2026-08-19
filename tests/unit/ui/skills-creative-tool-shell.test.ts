import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const libraryPath = 'src/app/[locale]/skills/SkillsLibraryClient.tsx'
const detailPath = 'src/app/[locale]/skills/[slug]/SkillDetailClient.tsx'
const cssPath = 'src/app/[locale]/skills/SkillsPresentation.module.css'

function leafKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('Skills CreativeToolShell presentation contract', () => {
  it('[shared shell] -> removes the legacy stone/amber page chrome', () => {
    const source = [readFileSync(libraryPath, 'utf8'), readFileSync(detailPath, 'utf8')].join('\n')

    expect(source.match(/CreativeToolShell/g)?.length).toBeGreaterThanOrEqual(4)
    expect(source).toContain("useTranslations('skills')")
    expect(source).toContain("import styles from './SkillsPresentation.module.css'")
    expect(source).toContain('toLocaleString(locale)')
    expect(source).not.toMatch(/(?:bg|border|text|accent)-(?:stone|amber|violet|purple|pink|magenta|fuchsia)-/)
    expect(source).not.toContain('<main')
  })

  it('[390px and accessibility] -> keeps content scrollable with 44px controls and cyan focus', () => {
    expect(existsSync(cssPath)).toBe(true)
    if (!existsSync(cssPath)) return

    const css = readFileSync(cssPath, 'utf8')
    expect(css).toContain('@media (max-width: 390px)')
    expect(css).toContain('overflow-y: auto')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('min-width: 44px')
    expect(css).toContain('var(--process-cyan)')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('[translations] -> keeps complete Traditional Chinese and English key parity', () => {
    const zhPath = 'messages/zh/skills.json'
    const enPath = 'messages/en/skills.json'
    expect(existsSync(zhPath)).toBe(true)
    expect(existsSync(enPath)).toBe(true)
    if (!existsSync(zhPath) || !existsSync(enPath)) return

    const zh = JSON.parse(readFileSync(zhPath, 'utf8')) as unknown
    const en = JSON.parse(readFileSync(enPath, 'utf8')) as unknown
    expect(leafKeys(zh).sort()).toEqual(leafKeys(en).sort())
    expect(JSON.stringify(zh)).not.toMatch(/视频|画面|启用|设置|阶段|库中|加载|创建/)
  })
})

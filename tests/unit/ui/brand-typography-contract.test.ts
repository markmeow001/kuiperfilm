import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

const layoutSource = read('src/app/[locale]/layout.tsx')
const globalStyles = read('src/app/globals.css')
const brandSource = read('src/components/v2/ProductionBrand.tsx')
const creativeToolShellSource = read('src/components/v2/CreativeToolShell.tsx')
const previewSource = read('src/app/[locale]/preview/page.tsx')
const globalErrorSource = read('src/app/global-error.tsx')
const narrativeHighlighterSource = read(
  'src/app/[locale]/v2/workspace/[projectId]/storyboard/NarrativeHighlighter.tsx',
)
const projectGraphStyles = read('src/components/v2/project-graph/ProjectGraphPanel.module.css')

const directBrandEntryPoints = [
  'src/app/[locale]/page.tsx',
  'src/app/[locale]/auth/signin/page.tsx',
  'src/app/[locale]/auth/signup/page.tsx',
  'src/app/[locale]/m/auth/signin/page.tsx',
  'src/components/Navbar.tsx',
  'src/components/system/SystemStateScreen.tsx',
]

const creativeToolEntryPoints = [
  'src/app/[locale]/skills/SkillsLibraryClient.tsx',
  'src/app/[locale]/skills/[slug]/SkillDetailClient.tsx',
]

const publicMessageFiles = [
  'messages/zh/auth.json',
  'messages/en/auth.json',
  'messages/zh/common.json',
  'messages/en/common.json',
  'messages/zh/landing.json',
  'messages/en/landing.json',
  'messages/zh/layout.json',
  'messages/en/layout.json',
  'messages/en/v2Script.json',
  'messages/en/v2Production.json',
]

describe('Kuiper brand and typography contract', () => {
  it('uses one shared Kuiper 影界 wordmark across formal entry points', () => {
    expect(brandSource).toContain('Kuiper')
    expect(brandSource).toContain('影界')
    expect(brandSource).toContain('AI · MANHUA · STUDIO')
    expect(brandSource).not.toMatch(/Kuiperfilm|Production OS|>\s*KF\s*</)

    for (const path of directBrandEntryPoints) {
      const source = read(path)
      expect(source, path).toContain('ProductionBrand')
      expect(source, path).not.toMatch(/Production OS|KUIPER FILM AI LAB/)
    }

    expect(creativeToolShellSource).toContain('ProductionBrand')
    for (const path of creativeToolEntryPoints) {
      const source = read(path)
      expect(source, path).toContain('CreativeToolShell')
      expect(source, path).not.toMatch(/Production OS|KUIPER FILM AI LAB/)
    }
  })

  it('loads one Traditional Chinese UI font plus the Kuiper wordmark face', () => {
    expect(layoutSource).toContain('Noto_Sans_TC')
    expect(layoutSource).toContain('Cormorant_Garamond')
    expect(layoutSource).not.toMatch(/Noto_Serif_TC|Poppins|Open_Sans/)

    expect(globalStyles).toContain('var(--font-kuiper-sans)')
    expect(globalStyles).toMatch(
      /\.font-kuiper-wordmark\s*\{[^}]*font-family:\s*var\(--font-kuiper-brand\)/,
    )
    for (const alias of ['font-sans', 'font-serif', 'font-mono', 'font-heading', 'font-body', 'font-serif-cn', 'font-display', 'font-fraunces']) {
      expect(globalStyles, alias).toMatch(
        new RegExp(`\\.${alias}[\\s\\S]*?font-family:\\s*var\\(--font-kuiper-sans\\)`),
      )
    }
    for (const retiredEditorialAlias of ['font-serif-cn', 'font-display', 'font-fraunces']) {
      expect(globalStyles, retiredEditorialAlias).toMatch(
        new RegExp(`\\.${retiredEditorialAlias}[\\s\\S]*?font-style:\\s*normal`),
      )
    }
    expect(globalStyles).not.toMatch(/--font-kuiper-serif/)
    expect(globalStyles).not.toMatch(/Noto (?:Sans|Serif) SC|PingFang SC|Hiragino Sans GB|Microsoft YaHei/)
  })

  it('keeps Cormorant inside the shared English wordmark and renders 影界 in the UI sans', () => {
    expect(brandSource).toContain('font-kuiper-wordmark')
    expect(brandSource).toMatch(/font-kuiper-wordmark[^>]*>\s*Kuiper\s*<\/span>/)
    expect(brandSource).toMatch(/font-sans[^>]*>\s*影界\s*<\/span>/)
    expect(brandSource).not.toMatch(/\bfont-(?:serif-cn|fraunces|display|mono)\b/)
  })

  it('keeps standalone failures and production editors on the same UI face', () => {
    expect(globalErrorSource).toContain('Noto_Sans_TC')
    expect(globalErrorSource).toMatch(/className=\{globalErrorFont\.className\}/)
    expect(narrativeHighlighterSource).toContain('var(--font-kuiper-sans)')
    expect(narrativeHighlighterSource).not.toMatch(/font-kuiper-serif|Noto Serif/)
    expect(projectGraphStyles).toContain('var(--font-kuiper-sans)')
    expect(projectGraphStyles).not.toMatch(/font-geist-(?:sans|mono)/)
  })

  it('keeps the old workflow mock clearly marked as a design reference', () => {
    expect(previewSource).toContain('ProductionBrand')
    expect(previewSource).toContain('DESIGN REFERENCE')
    expect(previewSource).toContain('設計參考')
    expect(previewSource).not.toMatch(/kino|@import\s+url|Noto (?:Sans|Serif) SC/i)
  })

  it('does not expose retired product names in public messages', () => {
    for (const path of publicMessageFiles) {
      const source = read(path)
      expect(source, path).not.toMatch(/Kino|Kuiperfilm|KuiperAI|Production OS/)
    }
  })
})

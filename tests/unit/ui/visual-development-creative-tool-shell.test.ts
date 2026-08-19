import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import enVisualDevelopment from '../../../messages/en/visualDevelopment.json'
import zhVisualDevelopment from '../../../messages/zh/visualDevelopment.json'

describe('Visual Development creative-tool shell contract', () => {
  it('route shell -> uses the shared studio frame and keeps one main landmark', () => {
    const client = readFileSync(
      'src/app/[locale]/visual-development/VisualDevelopmentClient.tsx',
      'utf8',
    )
    const stage = readFileSync(
      'src/app/[locale]/visual-development/StageWorkspace.tsx',
      'utf8',
    )
    const candidateModal = readFileSync(
      'src/app/[locale]/visual-development/CandidatePromptControlModal.tsx',
      'utf8',
    )

    expect(client).toContain(
      "import { CreativeToolShell } from '@/components/v2/CreativeToolShell'",
    )
    expect(client).toContain('description={t(\'header.description\')}')
    expect(client).toContain('backHref={`/${locale}/v2`}')
    expect(client).toContain('styles.workspaceViewport')
    expect(client).toContain('styles.workspaceGrid')
    expect(client).not.toContain('className="kuiper-stage')
    expect(stage).toContain('data-visual-development-stage')
    expect(stage).not.toContain('<main')
    expect(candidateModal).not.toContain('<main')
  })

  it('outer chrome -> removes the duplicate legacy header and hard-coded English navigation', () => {
    const toolbar = readFileSync(
      'src/app/[locale]/visual-development/VisualDevelopmentHeader.tsx',
      'utf8',
    )
    const rail = readFileSync(
      'src/app/[locale]/visual-development/DevelopmentRail.tsx',
      'utf8',
    )
    const inspector = readFileSync(
      'src/app/[locale]/visual-development/DevelopmentInspector.tsx',
      'utf8',
    )

    expect(toolbar).not.toContain("import Link from 'next/link'")
    expect(toolbar).not.toContain('<header')
    expect(toolbar).not.toContain('<h1')
    expect(toolbar).toContain('aria-live="polite"')
    expect(toolbar).toContain('aria-expanded={exportOpen && Boolean(projectId)}')
    expect(toolbar).toContain('aria-label={labels.close}')
    expect(rail).not.toContain('DEVELOPMENT SPINE')
    expect(rail).not.toContain('Phase {stage.code}')
    expect(rail).not.toContain('Playground\n')
    expect(rail).toContain('min-h-11')
    expect(inspector).not.toContain('SYSTEM INSPECTOR')
  })

  it('390/768/1440 layout -> contains scrolling and uses only darkroom/cyan outer tokens', () => {
    const css = readFileSync(
      'src/app/[locale]/visual-development/VisualDevelopmentShell.module.css',
      'utf8',
    )

    expect(css).toContain('min-width: 0')
    expect(css).toContain('min-height: 0')
    expect(css).toContain('overflow-y: auto')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('@media (max-width: 390px)')
    expect(css).toContain('@media (min-width: 1024px)')
    expect(css).toContain('@media (min-width: 1280px)')
    expect(css).toContain('var(--studio-chrome)')
    expect(css).toContain('var(--darkroom-canvas)')
    expect(css).toContain('var(--process-cyan)')
    expect(css).not.toMatch(/magenta|pink|purple|violet/i)
  })

  it('locale copy -> keeps matching shell keys and Traditional Chinese chrome', () => {
    expect(Object.keys(zhVisualDevelopment.header).sort()).toEqual(
      Object.keys(enVisualDevelopment.header).sort(),
    )
    expect(Object.keys(zhVisualDevelopment.rail).sort()).toEqual(
      Object.keys(enVisualDevelopment.rail).sort(),
    )
    expect(Object.keys(zhVisualDevelopment.inspector).sort()).toEqual(
      Object.keys(enVisualDevelopment.inspector).sort(),
    )
    expect(zhVisualDevelopment.header.eyebrow).toBe('創作工具')
    expect(zhVisualDevelopment.header.description).toContain('逐階段')
    expect(zhVisualDevelopment.rail.kicker).toBe('視覺開發流程')
    expect(zhVisualDevelopment.rail.phase).toBe('階段')
    expect(zhVisualDevelopment.inspector.kicker).toBe('系統檢查')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import enPlayground from '../../../messages/en/playground.json'
import zhPlayground from '../../../messages/zh/playground.json'

const componentPaths = [
  'src/app/[locale]/playground/ReferencePanel.tsx',
  'src/app/[locale]/playground/VideoMediaModules.tsx',
  'src/app/[locale]/playground/ReconstructionBriefForm.tsx',
  'src/app/[locale]/playground/ReconstructionGenerationControls.tsx',
  'src/app/[locale]/playground/ResultLightbox.tsx',
]

function leafKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('PLAYGROUND-UI-02 presentation contract', () => {
  it('uses the shared darkroom/cyan interaction language without removing semantic status colors', () => {
    for (const path of componentPaths) {
      const source = readFileSync(path, 'utf8')
      expect(source).toContain("useTranslations('playground.")
      expect(source).toContain('styles.touchSurface')
      expect(source).not.toMatch(/(?:violet|purple|pink|magenta|fuchsia)-/)
    }

    const referenceSources = componentPaths
      .slice(0, 2)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(referenceSources).toContain('elementDotClass')

    const statusSources = componentPaths
      .slice(2)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(statusSources).toMatch(/(?:amber|red|rose)-/)
  })

  it('enforces 44px touch targets at phone and tablet widths and keeps the lightbox responsive', () => {
    const css = readFileSync(
      'src/app/[locale]/playground/PlaygroundPresentation.module.css',
      'utf8',
    )
    const lightbox = readFileSync(
      'src/app/[locale]/playground/ResultLightbox.tsx',
      'utf8',
    )

    expect(css).toContain('@media (max-width: 900px)')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('min-width: 44px')
    expect(css).toContain('var(--process-cyan)')
    expect(lightbox).toContain('aria-modal="true"')
    expect(lightbox).toContain('flex-col')
    expect(lightbox).toContain('lg:flex-row')
    expect(lightbox).toContain('w-full lg:w-[360px]')
  })

  it('keeps all three non-video studios inside the shared shell at 390px', () => {
    const image = readFileSync('src/app/[locale]/playground/ImageStudio.tsx', 'utf8')
    const reconstruction = readFileSync(
      'src/app/[locale]/playground/ReconstructionStudio.tsx',
      'utf8',
    )
    const discussion = readFileSync(
      'src/app/[locale]/playground/DiscussionStudio.tsx',
      'utf8',
    )

    expect(image).toContain('h-full min-h-0 overflow-hidden')
    expect(reconstruction).toContain('h-full min-h-0 flex-col overflow-y-auto')
    expect(reconstruction).toContain('w-full shrink-0')
    expect(reconstruction).toContain('lg:w-[430px]')
    expect(discussion).toContain('h-full min-h-0 overflow-y-auto')
    expect(discussion).toContain('lg:overflow-hidden')
    expect(discussion).toContain('min-h-11')
  })

  it('keeps complete Traditional Chinese and English copy key parity', () => {
    expect(leafKeys(zhPlayground).sort()).toEqual(leafKeys(enPlayground).sort())

    for (const namespace of [
      'reference',
      'videoMedia',
      'reconstructionBrief',
      'reconstructionControls',
      'resultLightbox',
    ]) {
      expect(leafKeys(zhPlayground)).toContain(`${namespace}.title`)
      expect(leafKeys(enPlayground)).toContain(`${namespace}.title`)
    }
  })

  it('localizes every internal mode and keeps secondary actions on the shared touch/color contract', () => {
    const image = readFileSync('src/app/[locale]/playground/ImageStudio.tsx', 'utf8')
    const video = readFileSync('src/app/[locale]/playground/VideoStudio.tsx', 'utf8')
    const prompt = readFileSync('src/app/[locale]/playground/PromptComposer.tsx', 'utf8')
    const elements = readFileSync('src/app/[locale]/playground/ElementBindingsPanel.tsx', 'utf8')
    const reconstruction = readFileSync(
      'src/app/[locale]/playground/ReconstructionStudio.tsx',
      'utf8',
    )
    const result = readFileSync(
      'src/app/[locale]/playground/ReconstructionResultStage.tsx',
      'utf8',
    )

    expect(image).toContain('aspectLabels')
    expect(image).not.toMatch(/accent-/)
    expect(video).toContain('aspectLabels')
    expect(prompt).toContain("useTranslations('playground.video')")
    expect(prompt).toContain('min-h-11')
    expect(elements).toContain("useTranslations('playground.video')")
    expect(reconstruction).toContain("t.raw('steps')")
    expect(reconstruction).not.toContain("['影片', '設定', '分析', '定裝', '生成']")
    expect(result).toContain("useTranslations('playground.reconstructionResult')")
    expect(result.match(/min-h-11/g)).toHaveLength(2)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const panelPaths = [
  'src/app/[locale]/live-composite/AiMaskPanel.tsx',
  'src/app/[locale]/live-composite/DepthRebuildPanel.tsx',
  'src/app/[locale]/live-composite/DepthSceneReferenceGallery.tsx',
  'src/app/[locale]/live-composite/DepthReferenceBudget.tsx',
  'src/app/[locale]/live-composite/VirtualCharacterPanel.tsx',
  'src/app/[locale]/live-composite/CharacterMotionPanel.tsx',
  'src/app/[locale]/live-composite/FacePerformancePanel.tsx',
] as const

describe('LIVE-COMPOSITE-UI-02 inner panel contract', () => {
  it('[一般控制介面] -> 只使用 darkroom/cyan 操作色，且不殘留 violet、fuchsia、teal 或 rose', () => {
    for (const path of panelPaths) {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toMatch(/(?:violet|fuchsia|teal|rose)-/)
    }
  })

  it('[鍵盤與觸控] -> 互動控制具有 44px 觸控高度與一致的 focus-visible 青色焦點', () => {
    const source = panelPaths.map((path) => readFileSync(path, 'utf8')).join('\n')

    expect(source).not.toMatch(/\bh-10\b/)
    expect(source).toContain('min-h-11')
    expect(source).toContain('focus-visible:ring-2')
    expect(source).toContain('focus-visible:ring-cyan-300/70')
  })

  it('[語意狀態] -> 保留錯誤、警示與成功色，不把狀態誤改成一般青色', () => {
    const source = panelPaths.map((path) => readFileSync(path, 'utf8')).join('\n')

    expect(source).toMatch(/red-/)
    expect(source).toMatch(/amber-/)
    expect(source).toMatch(/emerald-/)
  })
})

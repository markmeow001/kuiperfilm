import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('Live Composite internal presentation contract', () => {
  it('[工作區控制] -> 專案列、工具列與舞台控制使用 44px 觸控尺寸與青色焦點', () => {
    const css = read('src/app/[locale]/live-composite/LiveCompositeShell.module.css')
    const project = read('src/app/[locale]/live-composite/ProjectPanel.tsx')
    const toolbar = read('src/app/[locale]/live-composite/CompositeToolbar.tsx')
    const stage = read('src/app/[locale]/live-composite/MaskStage.tsx')

    expect(css).toContain('.workspace :global(button)')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain(':focus-visible')
    expect(project).toContain('data-live-composite-project-controls')
    expect(toolbar).toContain('data-live-composite-toolbar')
    expect(stage).toContain('data-live-composite-playback')
  })

  it('[range 與 checkbox 控制] -> 全部可見特殊控制都有 44px 點擊包裝與焦點回饋', () => {
    const css = read('src/app/[locale]/live-composite/LiveCompositeShell.module.css')
    const controls = [
      'src/app/[locale]/live-composite/CompositeToolbar.tsx',
      'src/app/[locale]/live-composite/CompositeExportPanel.tsx',
      'src/app/[locale]/live-composite/CharacterAppearancePanel.tsx',
      'src/app/[locale]/live-composite/MaskStage.tsx',
      'src/app/[locale]/live-composite/DepthRebuildGuidePlanPanel.tsx',
    ].map(read)

    for (const source of controls) {
      expect(source).toContain('data-live-composite-control-hit-area')
    }
    expect(css).toMatch(/\.specialControlHitArea\s*\{[\s\S]*?min-height:\s*44px/)
    expect(css).toContain('.specialControlHitArea:focus-within')
  })

  it('[768px 工作區] -> 提早切成單欄且工具群可換行，不裁掉預覽與時間軸', () => {
    const css = read('src/app/[locale]/live-composite/LiveCompositeShell.module.css')
    const toolbar = read('src/app/[locale]/live-composite/CompositeToolbar.tsx')
    const rail = read('src/app/[locale]/live-composite/MaskKeyframeRail.tsx')

    expect(css).toContain('@media (max-width: 900px)')
    expect(css).toMatch(/\.workspaceBody[\s\S]*flex-direction: column/)
    expect(toolbar).toContain('data-live-composite-toolbar-scroll')
    expect(rail).toContain('data-live-composite-keyframe-actions')
  })

  it('[共用 chrome] -> 流程、工具列與訊號軌不使用非語意紫色或桃紅色', () => {
    const sources = [
      'src/app/[locale]/live-composite/LiveCompositeWorkflowGuide.tsx',
      'src/app/[locale]/live-composite/CompositeToolbar.tsx',
      'src/app/[locale]/live-composite/DepthSignalRail.tsx',
    ].map(read).join('\n')

    expect(sources).not.toMatch(/violet|purple|fuchsia|pink/i)
  })

  it('[資產庫視窗] -> 使用共用 Modal 並在 390px 將操作改為可觸控的單欄', () => {
    const dialog = read('src/app/[locale]/live-composite/SaveToLibraryDialog.tsx')
    const css = read('src/app/[locale]/live-composite/LiveCompositeShell.module.css')

    expect(dialog).toContain("import { Modal } from '@/components/v2/Modal'")
    expect(dialog).toContain('<Modal open')
    expect(dialog).toContain('data-live-composite-library-actions')
    expect(css).toContain('.libraryActions')
    expect(css).toContain('flex-direction: column-reverse')
  })

  it('[Portal 資產庫視窗] -> 輸入、選擇與操作按鈕有獨立的 process-cyan focus-visible', () => {
    const css = read('src/app/[locale]/live-composite/LiveCompositeShell.module.css')

    expect(css).toContain('.libraryControl:focus-visible')
    expect(css).toContain('.librarySecondary:focus-visible')
    expect(css).toContain('.libraryPrimary:focus-visible')
    expect(css).toMatch(/\.libraryControl:focus-visible[\s\S]*?outline:\s*2px solid var\(--process-cyan\)/)
  })

  it('[動態偏好] -> 內部工作區尊重 reduced motion', () => {
    const css = read('src/app/[locale]/live-composite/LiveCompositeShell.module.css')

    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation-duration: 0.01ms')
    expect(css).toContain('transition-duration: 0.01ms')
  })
})

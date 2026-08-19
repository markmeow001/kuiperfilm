import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Canvas creative-tool shell contract', () => {
  it('畫布入口 -> 使用共用 Studio 工具外殼且不保留舊浮動標頭', () => {
    const source = readFileSync('src/app/[locale]/canvas/CanvasClient.tsx', 'utf8')

    expect(source).toContain("import { CreativeToolShell } from '@/components/v2/CreativeToolShell'")
    expect(source).toContain('eyebrow="創作工具"')
    expect(source).toContain('title="無限畫布"')
    expect(source).toContain('backLabel="返回製作首頁"')
    expect(source).toContain('畫布與工作流')
    expect(source).toContain('styles.canvasViewport')
    expect(source).not.toContain('className="fixed inset-0 overflow-hidden"')
    expect(source).not.toContain('LibTV floating capsule')
    expect(source).not.toContain("import Link from 'next/link'")
  })

  it('畫布基礎色票 -> 只以夜藍與青色表示表面、選取和工作中連線', () => {
    const tokens = readFileSync('src/app/[locale]/canvas/lib/canvas-tokens.ts', 'utf8')

    expect(tokens).toContain("canvas: '#070B0F'")
    expect(tokens).toContain("panel: '#111B24'")
    expect(tokens).toContain("popover: '#17232D'")
    expect(tokens).toContain("accent: '#55AFC0'")
    expect(tokens).toContain("selectedRing: '#55AFC0'")
    expect(tokens).toContain("lit: '#55AFC0'")
    expect(tokens).not.toContain('rgba(216,70,239')
    expect(tokens).not.toContain("accent: '#E052E8'")
  })

  it('窄螢幕 -> 外殼與浮動控制保留 44px 操作、焦點和水平邊界', () => {
    const source = readFileSync('src/app/[locale]/canvas/CanvasClient.tsx', 'utf8')
    const css = readFileSync('src/app/[locale]/canvas/CanvasShell.module.css', 'utf8')

    expect(css).toContain('min-width: 0')
    expect(css).toContain('overflow: hidden')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@media (max-width: 390px)')
    expect(css).toContain('max-width: calc(100vw - 24px)')
    expect(css).toContain('transform: translateX(-50%)')
    expect(css).toContain('transform: none !important')
    expect(source).not.toContain('styles.primaryDock} absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2')
  })

  it('390px 空白畫布 -> 工具列維持單列捲動，內容可讀且不建立第二個主標題', () => {
    const source = readFileSync('src/app/[locale]/canvas/CanvasClient.tsx', 'utf8')
    const css = readFileSync('src/app/[locale]/canvas/CanvasShell.module.css', 'utf8')

    expect(source).toContain('styles.emptyStateLauncher')
    expect(source).toContain('styles.emptyStateCard')
    expect(source).toContain('<h2 className="text-lg font-semibold"')
    expect(source).not.toContain('<h1 className="text-lg font-semibold"')
    expect(css).toContain('white-space: nowrap')
    expect(css).toContain('flex: 0 0 auto')
    expect(css).toContain('overflow-y: auto')
    expect(css).toContain('padding-bottom: 100px')
  })

  it('390px 畫布資源選單 -> 不超出視窗且所有操作保留 44px', () => {
    const source = readFileSync('src/app/[locale]/canvas/CanvasResourceMenu.tsx', 'utf8')

    expect(source).toContain('w-[calc(100vw-24px)]')
    expect(source).toContain('max-w-[420px]')
    expect(source).toContain('min-h-11')
    expect(source).toContain('min-w-11')
    expect(source).toContain('畫布與工作流')
    expect(source).toContain('新增空白畫布')
    expect(source).not.toMatch(/关闭|画布|新建|储存|打开|删除/)
  })

  it('空白畫布與新增選單 -> 節點、範本與連線提示使用一致繁中', () => {
    const tokens = readFileSync('src/app/[locale]/canvas/lib/canvas-tokens.ts', 'utf8')
    const toolbox = readFileSync('src/app/[locale]/canvas/lib/canvas-toolbox.ts', 'utf8')
    const connections = readFileSync('src/app/[locale]/canvas/lib/canvas-connections.ts', 'utf8')

    expect(tokens).toContain("image: { label: '圖片'")
    expect(tokens).toContain("video: { label: '影片'")
    expect(tokens).toContain("director: { label: '導演台'")
    expect(tokens).toContain("audio: { label: '音訊'")
    expect(tokens).toContain("composition: { label: '影片合成'")
    expect(toolbox).toContain("label: '故事腳本 → 分鏡'")
    expect(toolbox).toContain("label: '首幀圖生影片'")
    expect(toolbox).toContain("label: '實拍畫面 → 遮罩'")
    expect(toolbox).toContain("hint: '完整短劇一鏡鏈路'")
    expect(connections).toContain('節點使用')
    expect(connections).toContain('導演台沒有普通連線輸出')
  })
})

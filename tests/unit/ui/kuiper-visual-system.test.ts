import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Kuiper visual system', () => {
  it('uses the dark stage and signal magenta tokens as the global v2 foundation', () => {
    const tokens = readFileSync('src/styles/tokens-v2.css', 'utf8')
    const globals = readFileSync('src/app/globals.css', 'utf8')

    expect(tokens).toContain('--surface-canvas:  #050506')
    expect(tokens).toContain('--primary-500: #FF2EAF')
    expect(tokens).toContain('--border-primary: rgba(255, 46, 175, 0.46)')
    expect(globals).toContain('--background: var(--surface-canvas)')
    expect(globals).toContain('.kuiper-panel-interactive')
    expect(globals).toContain('.kuiper-primary-button')
  })

  it('enforces a readable global type scale for dense production screens', () => {
    const tokens = readFileSync('src/styles/tokens-v2.css', 'utf8')
    const globals = readFileSync('src/app/globals.css', 'utf8')

    expect(tokens).toContain('--text-ui-micro:   11px')
    expect(tokens).toContain('--text-ui-small:   14px')
    expect(globals).toContain('--text-xs: 0.875rem')
    expect(globals).toContain('--text-base: 1.0625rem')
    expect(globals).toContain('font-size: 17px')
    expect(globals).toContain('.text-\\[8px\\],')
    expect(globals).toContain('.text-\\[14px\\]')
  })

  it('uses a compact canvas-first workspace shell on desktop and mobile', () => {
    const sidebar = readFileSync('src/components/v2/Sidebar.tsx', 'utf8')
    const topbar = readFileSync('src/components/v2/TopBar.tsx', 'utf8')
    const shell = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/V2WorkspaceShell.tsx',
      'utf8',
    )

    expect(sidebar).toContain('w-[88px]')
    expect(sidebar).toContain('aria-label="製作流程"')
    expect(sidebar).toContain('aria-label="行動版製作流程"')
    expect(sidebar).toContain('grid-cols-6')
    expect(topbar).toContain('min-h-[72px]')
    expect(topbar).toContain('sticky top-0')
    expect(shell).toContain('kuiper-stage')
    expect(shell).toContain('kuiper-workspace')
    expect(shell).toContain('pb-20 lg:pb-0')
  })

  it('uses the shared workspace editor foundation on the script surface', () => {
    const globals = readFileSync('src/app/globals.css', 'utf8')
    const script = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/script/V2ScriptClient.tsx',
      'utf8',
    )
    const episodeTabs = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/V2EpisodeTabBar.tsx',
      'utf8',
    )

    expect(globals).toContain('.kuiper-workspace-page')
    expect(globals).toContain('.kuiper-editor-surface')
    expect(globals).toContain('.kuiper-inspector')
    expect(script).toContain('xl:grid-cols-[minmax(0,1fr)_340px]')
    expect(script).toContain('min-h-[520px]')
    expect(script).toContain('kuiper-primary-button')
    expect(episodeTabs).toContain('border-primary-500/50')
  })

  it('uses the shared production surfaces across subjects and storyboard views', () => {
    const globals = readFileSync('src/app/globals.css', 'utf8')
    const subjects = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx',
      'utf8',
    )
    const subjectGrid = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/SubjectGrid.tsx',
      'utf8',
    )
    const gallery = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGalleryView.tsx',
      'utf8',
    )
    const timeline = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineView.tsx',
      'utf8',
    )

    expect(globals).toContain('.kuiper-surface-card')
    expect(globals).toContain('.kuiper-modal-surface')
    expect(globals).toContain('.kuiper-segmented-control')
    expect(subjects).toContain('kuiper-workspace-page')
    expect(subjectGrid).toContain('kuiper-surface-card')
    expect(gallery).toContain('kuiper-storyboard-shell')
    expect(gallery).toContain('xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]')
    expect(timeline).toContain('xl:grid-cols-12')
  })

  it('uses responsive production workspaces for voice casting and final delivery', () => {
    const voice = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/voice/V2VoiceClient.tsx',
      'utf8',
    )
    const finalDelivery = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/final/V2FinalClient.tsx',
      'utf8',
    )

    expect(voice).toContain('kuiper-workspace-page')
    expect(voice).toContain('xl:grid-cols-[260px_minmax(0,1fr)_300px]')
    expect(voice).toContain('kuiper-surface-card')
    expect(voice).toContain('voicesQuery.isError')
    expect(finalDelivery).toContain('kuiper-workspace-page')
    expect(finalDelivery).toContain('xl:grid-cols-[minmax(0,1fr)_340px]')
    expect(finalDelivery).toContain('videoProgress')
    expect(finalDelivery).toContain('kuiper-primary-button')
  })

  it('does not reintroduce legacy amber or stone utilities in redesigned production areas', () => {
    const redesignedFiles = [
      'src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/subjects/SubjectGrid.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGalleryView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGroupsView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/voice/V2VoiceClient.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/final/V2FinalClient.tsx',
    ]

    for (const file of redesignedFiles) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/(?:amber|stone)-/)
    }
  })

  it('starts the home experience from production intent instead of tool names', () => {
    const launcher = readFileSync(
      'src/app/[locale]/v2/V2WorkflowLauncher.tsx',
      'utf8',
    )
    const home = readFileSync('src/app/[locale]/v2/V2HomeClient.tsx', 'utf8')

    expect(launcher).toContain("t('storyboard.title')")
    expect(launcher).toContain("t('director.title')")
    expect(launcher).toContain("t('composite.title')")
    expect(launcher).toContain("t('playground.title')")
    expect(home).toContain('<V2WorkflowLauncher locale={locale} />')
  })

  it('uses one Playground shell with an intent-led image composer', () => {
    const shell = readFileSync(
      'src/app/[locale]/playground/V2PlaygroundClient.tsx',
      'utf8',
    )
    const imageStudio = readFileSync(
      'src/app/[locale]/playground/ImageStudio.tsx',
      'utf8',
    )

    expect(shell).toContain("type PlaygroundMode = 'image' | 'video' | 'discussion'")
    expect(shell).toContain("useTranslations('playground.header')")
    expect(shell).toContain('min-h-[72px]')
    expect(imageStudio).toContain("useTranslations('playground.image')")
    expect(imageStudio).toContain("t('emptyTitle')")
    expect(imageStudio).toContain('kuiper-canvas-grid')
    expect(imageStudio).toContain('maxLength={4000}')
    expect(imageStudio).toContain('kuiper-primary-button')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Kuiper visual system', () => {
  it('uses one unified dark production palette while isolating legacy magenta routes', () => {
    const tokens = readFileSync('src/styles/tokens-v2.css', 'utf8')
    const globals = readFileSync('src/app/globals.css', 'utf8')

    expect(tokens).toContain('--surface-canvas:  #050506')
    expect(tokens).toContain('--primary-100: #FFE6F6')
    expect(tokens).toContain('--primary-200: #FFC2E8')
    expect(tokens).toContain('--primary-500: #FF2EAF')
    expect(tokens).toContain('--border-primary: rgba(255, 46, 175, 0.46)')
    expect(tokens).toContain('--production-paper:       #070B0F')
    expect(tokens).toContain('--production-surface:     #111B24')
    expect(tokens).toContain('--production-muted:       #17232D')
    expect(tokens).toContain('--production-ink:         #F2F6F7')
    expect(tokens).toContain('--production-blue:        #3E73B9')
    expect(tokens).toContain('--studio-chrome:    #0D141B')
    expect(tokens).toContain('--darkroom-canvas:  #070B0F')
    expect(tokens).toContain('--darkroom-surface: #111B24')
    expect(tokens).toContain('--darkroom-raised:  #17232D')
    expect(tokens).toContain('--darkroom-border:')
    expect(tokens).toContain('--darkroom-text:')
    expect(tokens).toContain('--darkroom-muted:')
    expect(tokens).toContain('--process-cyan:     #55AFC0')
    expect(globals).toContain('--background: var(--surface-canvas)')
    expect(globals).toContain('--color-surface-raised: var(--surface-raised)')
    expect(globals).toContain('--color-surface-overlay: var(--surface-overlay)')
    expect(globals).toContain('--color-surface-inset: var(--surface-inset)')
    expect(globals).toContain('--color-border-primary: var(--border-primary)')
    expect(globals).toContain('--color-primary-100: var(--primary-100)')
    expect(globals).toContain('--color-primary-200: var(--primary-200)')
    expect(globals).toContain('.kuiper-panel-interactive')
    expect(globals).toContain('.kuiper-primary-button')
    expect(globals).toContain('.kuiper-dashboard')
    expect(globals).toContain('.kuiper-dashboard-card')
    expect(globals).toContain('.kuiper-shell-rail')
    expect(globals).toContain('.kuiper-shell-topbar')
    expect(globals).toContain('.kuiper-shell-nav-item[data-active=\'true\']::before')
    expect(globals).toContain('.kuiper-workspace.kuiper-stage')
    expect(globals).toMatch(
      /\.kuiper-stage\s*\{[\s\S]*?rgba\(255, 46, 175, 0\.09\)[\s\S]*?var\(--surface-canvas\)/,
    )
    expect(globals).toMatch(
      /\.kuiper-workspace\.kuiper-stage\s*\{[\s\S]*?rgba\(85, 175, 192, 0\.08\)[\s\S]*?var\(--darkroom-canvas\)/,
    )
    expect(globals).not.toContain(
      'box-shadow: 0 0 0 3px rgba(255, 46, 175, 0.08)',
    )
    expect(globals).toContain('@media (prefers-reduced-motion: reduce)')
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

  it('uses an expanded production rail, tablet rail, and mobile step switcher', () => {
    const sidebar = readFileSync('src/components/v2/Sidebar.tsx', 'utf8')
    const topbar = readFileSync('src/components/v2/TopBar.tsx', 'utf8')
    const userMenu = readFileSync('src/components/v2/UserMenu.tsx', 'utf8')
    const shell = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/V2WorkspaceShell.tsx',
      'utf8',
    )

    expect(sidebar).toContain('w-[76px]')
    expect(sidebar).toContain('xl:w-[284px]')
    expect(sidebar).toContain('ProductionProgress')
    expect(sidebar).toContain('aria-label={presentation.flowTitle}')
    expect(sidebar).toContain('aria-label={presentation.mobileFlowLabel}')
    expect(sidebar).toContain('{presentation.switchStage}')
    expect(sidebar).toContain('presentation.previousStage(previousStep.label)')
    expect(topbar).toContain('min-h-[76px]')
    expect(topbar).toContain('ProductionProgress')
    expect(topbar).toContain('sticky top-0')
    expect(topbar).toContain('kuiper-shell-topbar')
    expect(topbar).toContain('tone="dark"')
    expect(topbar).toContain('buildProjectSwitchHref')
    expect(topbar).toContain('h-11 w-11')
    expect(topbar).toContain('hidden items-center md:flex')
    expect(topbar).toContain('fixed left-3 right-3')
    expect(userMenu).toContain('min-h-11 min-w-11')
    expect(userMenu).toContain('var(--process-cyan)')
    expect(userMenu).toContain('var(--darkroom-raised)')
    expect(userMenu).not.toContain('primary-500')
    expect(shell).toContain('kuiper-stage')
    expect(shell).toContain('kuiper-workspace')
    expect(shell).toContain('pb-20 lg:pb-0')
  })

  it('keeps dashboard content on layered dark surfaces inside dark global chrome', () => {
    const homeRail = readFileSync('src/app/[locale]/v2/V2HomeRail.tsx', 'utf8')
    const home = readFileSync('src/app/[locale]/v2/V2HomeClient.tsx', 'utf8')
    const newProject = readFileSync(
      'src/app/[locale]/v2/new/V2NewProjectClient.tsx',
      'utf8',
    )

    expect(homeRail).toContain('kuiper-shell-rail')
    expect(homeRail).toContain('tone="dark"')
    expect(homeRail).toContain('data-active={active}')
    expect(home).toContain('kuiper-dashboard')
    expect(home).toContain('kuiper-dashboard-topbar')
    expect(home).toContain('kuiper-dashboard-main')
    expect(newProject).toContain('kuiper-dashboard')
    expect(newProject).toContain('kuiper-dashboard-topbar')
    expect(newProject).toContain('kuiper-dashboard-main')
  })

  it('uses the shared workspace editor foundation on the script surface', () => {
    const script = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/script/V2ScriptClient.tsx',
      'utf8',
    )
    const workspace = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/script/ScreenplayWorkspace.tsx',
      'utf8',
    )
    const page = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/script/page.tsx',
      'utf8',
    )
    const episodeTabs = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/V2EpisodeTabBar.tsx',
      'utf8',
    )

    expect(script).toContain('ScreenplayWorkspace')
    expect(script).toContain('styles.planningRoot')
    expect(script).toContain('tone="studio"')
    expect(workspace).toContain('kuiper-screenplay')
    expect(workspace).toContain('StickyNextStep')
    expect(workspace).toContain('role="tablist"')
    expect(workspace).toContain('aria-controls={controls}')
    expect(workspace).toContain('role="tabpanel"')
    expect(workspace).toContain('tabIndex={active ? 0 : -1}')
    expect(page).toContain('tone="darkroom"')
    expect(page).not.toContain('tone="paper"')
    expect(episodeTabs).toContain("tone?: 'darkroom' | 'paper'")
    expect(episodeTabs).toContain('sm:focus-visible:opacity-100')
    expect(episodeTabs).toContain('bg-[var(--production-surface)]')
    expect(episodeTabs).toContain("useTranslations('v2Script.episodes')")
    expect(episodeTabs).toContain("aria-label={t('delete', { name: episode.name })}")
    expect(episodeTabs).not.toContain('hidden h-4 w-4')
  })

  it('uses the shared production surfaces across subjects and storyboard views', () => {
    const globals = readFileSync('src/app/globals.css', 'utf8')
    const subjects = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx',
      'utf8',
    )
    const entityWorkstation = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/EntityWorkstation.tsx',
      'utf8',
    )
    const subjectGrid = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/SubjectGrid.tsx',
      'utf8',
    )
    const subjectsPage = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/page.tsx',
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
    const groups = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2GroupsLayout.tsx',
      'utf8',
    )
    const storyboardClient = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardClient.tsx',
      'utf8',
    )

    expect(globals).toContain('.kuiper-surface-card')
    expect(globals).toContain('.kuiper-modal-surface')
    expect(globals).toContain('.kuiper-segmented-control')
    expect(subjects).toContain('EntityWorkstation')
    expect(entityWorkstation).toContain('EntityListPanel')
    expect(entityWorkstation).toContain('UiStatePanel')
    expect(entityWorkstation).toContain('PageHeader')
    expect(entityWorkstation).toContain('styles.studioRoot')
    expect(subjectsPage).toContain('tone="darkroom"')
    expect(subjectsPage).not.toContain('tone="paper"')
    expect(subjectGrid).toContain('bg-[var(--production-surface)]')
    expect(gallery).toContain('kuiper-storyboard-shell')
    expect(gallery).toContain('[&_button]:min-h-11')
    expect(gallery).toContain('[&_button]:min-w-11')
    expect(gallery).toContain(
      'xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]',
    )
    expect(timeline).toContain('[&_button]:min-h-11')
    expect(groups).toContain('[&_button]:min-h-11')
    expect(timeline).toContain('xl:grid-cols-12')
    expect(storyboardClient).toContain(
      'projectQuery.isError || storyboardsQuery.isError',
    )
    expect(storyboardClient).toContain('StoryboardLoadErrorState')
    expect(
      storyboardClient.indexOf(
        'projectQuery.isError || storyboardsQuery.isError',
      ),
    ).toBeLessThan(
      storyboardClient.indexOf(
        'projectQuery.isLoading || storyboardsQuery.isLoading',
      ),
    )
    expect(storyboardClient).not.toContain('min-h-9')
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
    expect(voice).toContain('xl:grid-cols-[250px_minmax(0,1fr)_310px]')
    expect(voice).toContain('kuiper-surface-card')
    expect(voice).toContain('bindSelectedVoice')
    expect(voice).toContain('generateAll')
    expect(finalDelivery).toContain('kuiper-workspace-page')
    expect(finalDelivery).toContain('xl:grid-cols-[minmax(0,1fr)_340px]')
    expect(finalDelivery).toContain('videoProgress')
    expect(finalDelivery).toContain('mediaWorkspaceClasses.deliverAction')
    expect(finalDelivery).toContain('mediaWorkspaceClasses.deliveryPanel')
  })

  it('keeps visual development inside the shared creative shell while workspaces scroll', () => {
    const shell = readFileSync(
      'src/app/[locale]/visual-development/VisualDevelopmentClient.tsx',
      'utf8',
    )
    const header = readFileSync(
      'src/app/[locale]/visual-development/VisualDevelopmentHeader.tsx',
      'utf8',
    )
    const rail = readFileSync(
      'src/app/[locale]/visual-development/DevelopmentRail.tsx',
      'utf8',
    )
    const stage = readFileSync(
      'src/app/[locale]/visual-development/StageWorkspace.tsx',
      'utf8',
    )
    const inspector = readFileSync(
      'src/app/[locale]/visual-development/DevelopmentInspector.tsx',
      'utf8',
    )
    const layout = readFileSync(
      'src/app/[locale]/visual-development/VisualDevelopmentShell.module.css',
      'utf8',
    )

    expect(shell).toContain('<CreativeToolShell')
    expect(shell).toContain('styles.workspaceViewport')
    expect(shell).toContain('styles.workspaceGrid')
    expect(header).toContain('styles.toolbar')
    expect(header).not.toContain('<header')
    expect(rail).toContain('xl:h-full xl:overflow-hidden')
    expect(stage).toContain('xl:overflow-y-auto xl:overscroll-y-contain')
    expect(stage).not.toContain('<main')
    expect(inspector).toContain('xl:h-full xl:min-h-0 xl:overflow-y-auto')
    expect(layout).toContain('grid-template-columns: 248px minmax(0, 1fr) 304px')
    expect(layout).toContain('overflow-y: auto')
  })

  it('does not reintroduce legacy stone or non-semantic amber utilities in redesigned production areas', () => {
    const redesignedFiles = [
      'src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/subjects/EntityWorkstation.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/subjects/SubjectGrid.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGalleryView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGroupsView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/voice/V2VoiceClient.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/voice/VoiceSpeakerRail.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/voice/VoiceLibrary.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/voice/VoiceInspector.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/voice/VoiceLinePanel.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/voice/VoiceLineCard.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/final/V2FinalClient.tsx',
    ]

    for (const file of redesignedFiles) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/stone-/)

      const amberLines = source
        .split('\n')
        .filter((line) => /amber-/.test(line))

      if (file.endsWith('/voice/VoiceLinePanel.tsx')) {
        expect(amberLines).toHaveLength(1)
        expect(amberLines[0]).toContain('role="alert"')
        expect(amberLines[0]).toContain('border-amber-500/30')
        expect(amberLines[0]).toContain('bg-amber-500/10')
        expect(amberLines[0]).toContain('text-amber-100')
      } else {
        expect(amberLines).toEqual([])
      }
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

  it('uses the shared creative-tool shell with an intent-led image composer', () => {
    const shell = readFileSync(
      'src/app/[locale]/playground/V2PlaygroundClient.tsx',
      'utf8',
    )
    const imageStudio = readFileSync(
      'src/app/[locale]/playground/ImageStudio.tsx',
      'utf8',
    )

    expect(shell).toContain(
      "type PlaygroundMode = 'image' | 'video' | 'reconstruction' | 'discussion'",
    )
    expect(shell).toContain("label: t('reconstruction')")
    expect(shell).toContain("useTranslations('playground.header')")
    expect(shell).toContain('CreativeToolShell')
    expect(shell).toContain('data-playground-mode-nav')
    expect(shell).toContain('aria-pressed={active}')
    expect(shell).toContain('min-h-11 min-w-11')
    expect(shell).toContain('var(--process-cyan)')
    expect(shell).not.toMatch(/(?:violet|magenta|primary-[0-9]|#050506|kuiper-stage)/)
    expect(imageStudio).toContain("useTranslations('playground.image')")
    expect(imageStudio).toContain("t('emptyTitle')")
    expect(imageStudio).toContain('kuiper-canvas-grid')
    expect(imageStudio).toContain('maxLength={4000}')
    expect(imageStudio).toContain('kuiper-primary-button')
  })

  it('requires explicit generation controls and prompt review for live-action reconstruction', () => {
    const studio = readFileSync(
      'src/app/[locale]/playground/ReconstructionStudio.tsx',
      'utf8',
    )
    const controls = readFileSync(
      'src/app/[locale]/playground/ReconstructionGenerationControls.tsx',
      'utf8',
    )
    const resultStage = readFileSync(
      'src/app/[locale]/playground/ReconstructionResultStage.tsx',
      'utf8',
    )
    const brief = readFileSync(
      'src/app/[locale]/playground/ReconstructionBriefForm.tsx',
      'utf8',
    )
    const controller = readFileSync(
      'src/app/[locale]/playground/usePlaygroundController.ts',
      'utf8',
    )
    const zhMessages = readFileSync('messages/zh/playground.json', 'utf8')
    const enMessages = readFileSync('messages/en/playground.json', 'utf8')

    expect(studio).toContain('ReconstructionGenerationControls')
    expect(studio).toContain('ReconstructionPromptReview')
    expect(studio).toContain(
      "audioMode === 'preserve-original' && durationMode !== 'source'",
    )
    expect(controls).toContain("useTranslations('playground.reconstructionControls')")
    expect(controls).toContain("aria-label={t('modelAria')}")
    expect(controls).toContain("aria-label={t('durationAria')}")
    expect(controls).toContain("{t('title')}")
    expect(controls).toContain("{t('performanceLocked')}")
    expect(controls).toContain("{t('uploadCharacterStep')}")
    expect(controls).toContain("{t('keyframeStep')}")
    expect(zhMessages).toContain('"modelAria": "實拍重建模型"')
    expect(enMessages).toContain('"modelAria": "Live-action rebuild model"')
    expect(zhMessages).toContain('"durationAria": "實拍重建輸出秒數"')
    expect(enMessages).toContain('"durationAria": "Live-action rebuild duration"')
    expect(controls).not.toContain('重建策略')
    expect(studio).toContain('buildReconstructionKeyframePrompt')
    expect(studio).toContain("strategy: 'keyframe-guided'")
    expect(studio).toContain('referenceImages: targetKeyframe')
    expect(studio).toContain('key: targetKeyframe.signedUrl')
    expect(studio).toContain('setIsGeneratingKeyframe(true)')
    expect(controller).toContain('submittedRefImages')
    expect(brief).toContain('placeholder:text-text-tertiary/70')
    expect(brief).toContain("placeholder={t('eraPlaceholder')}")
    expect(zhMessages).toContain('"eraPlaceholder": "例如：1930 年代民國"')
    expect(enMessages).toContain('"eraPlaceholder": "For example: 1930s Shanghai"')
    expect(controls).toContain("{t('promptReviewTitle')}")
    expect(controls).toContain("t('confirmGenerate')")
    expect(studio).toContain('URL.createObjectURL(file)')
    expect(studio).toContain('previewUrl ?? characterReference?.signedUrl')
    expect(controls).toContain(
      'props.asset.previewUrl || props.asset.signedUrl',
    )
    expect(controls).toContain("{t('previewFailed')}")
    expect(resultStage).toContain("{t('referencesReady')}")
    expect(zhMessages).toContain('"referencesReady": "參考圖片已就緒"')
    expect(enMessages).toContain('"referencesReady": "Reference images ready"')
    expect(resultStage).toContain('characterReferenceUrl')
  })
})

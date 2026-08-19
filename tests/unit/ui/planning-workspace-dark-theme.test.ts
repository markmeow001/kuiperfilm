import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('planning workspace dark studio contract', () => {
  it('uses one layered dark palette with readable long-form text', () => {
    const styles = read(
      'src/app/[locale]/v2/workspace/[projectId]/PlanningWorkspace.module.css',
    )

    expect(styles).toContain('--production-paper: #070b0f')
    expect(styles).toContain('--production-surface: #111b24')
    expect(styles).toContain('--production-raised: #17232d')
    expect(styles).toContain('--production-border: #263642')
    expect(styles).toContain('--production-ink: #f2f6f7')
    expect(styles).toContain('--production-ink-muted: #a7b3bc')
    expect(styles).toContain('--production-tool: #55afc0')
    expect(styles).toContain('color-scheme: dark')
    expect(styles).toContain('background: var(--production-raised, #17232d)')
    expect(styles).not.toContain('#fffef9')
    expect(styles).not.toContain('#e5dfd3')
    expect(styles).not.toContain('color-scheme: light')
  })

  it('removes the paper shell tone from screenplay and subjects routes', () => {
    const scriptPage = read(
      'src/app/[locale]/v2/workspace/[projectId]/script/page.tsx',
    )
    const subjectsPage = read(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/page.tsx',
    )
    const scriptClient = read(
      'src/app/[locale]/v2/workspace/[projectId]/script/V2ScriptClient.tsx',
    )

    expect(scriptPage).toContain('tone="darkroom"')
    expect(subjectsPage).toContain('tone="darkroom"')
    expect(scriptPage).not.toContain('tone="paper"')
    expect(subjectsPage).not.toContain('tone="paper"')
    expect(scriptClient).toContain('tone="studio"')
    expect(scriptClient).not.toContain('tone="paper"')
  })

  it('keeps cyan for tools, blue for primary actions, and gold for lock state', () => {
    const home = read(
      'src/app/[locale]/v2/workspace/[projectId]/ProjectHomeContent.tsx',
    )
    const screenplay = read(
      'src/app/[locale]/v2/workspace/[projectId]/script/ScreenplayWorkspace.tsx',
    )
    const subjectGrid = read(
      'src/app/[locale]/v2/workspace/[projectId]/subjects/SubjectGrid.tsx',
    )

    expect(home).toContain('text-[var(--production-tool)]')
    expect(home).toContain('min-h-11')
    expect(screenplay).toContain('focus-visible:ring-[var(--production-focus)]')
    expect(screenplay).toContain('kuiper-dashboard-primary')
    expect(subjectGrid).toContain('bg-[var(--production-blue)]')
    expect(subjectGrid).toContain("item.isLocked ? 'text-[var(--production-gold)]'")
    expect(home).not.toContain('bg-white')
    expect(screenplay).not.toContain('bg-[#fbfaf7]')
  })

  it('styles project settings directly instead of flattening states through bridge selectors', () => {
    const settings = read(
      'src/app/[locale]/v2/workspace/[projectId]/V2ProjectSettingsPanel.tsx',
    )
    const styles = read(
      'src/app/[locale]/v2/workspace/[projectId]/PlanningWorkspace.module.css',
    )

    expect(settings).toContain('var(--production-surface)')
    expect(settings).toContain('var(--process-cyan)')
    expect(settings).toContain('focus-visible:ring-[var(--production-focus)]')
    expect(settings).toContain('aria-pressed={active}')
    expect(settings).not.toMatch(/(?:stone|border-amber|bg-amber|text-amber)/)
    expect(styles).not.toContain(".settingsBridge [class*=")
    expect(styles).not.toContain('.settingsBridge :where(')
  })

  it('uses the shared accessible modal contract and compact-screen layout for collaboration flows', () => {
    const collaborators = read(
      'src/app/[locale]/v2/workspace/[projectId]/ProjectCollaboratorsModal.tsx',
    )
    const audit = read(
      'src/app/[locale]/v2/workspace/[projectId]/ProjectAuditLogModal.tsx',
    )
    const request = read('src/components/v2/RequestEditAccessModal.tsx')
    const mobileBanner = read('src/app/[locale]/v2/MobileRevertBanner.tsx')

    for (const source of [collaborators, audit, request]) {
      expect(source).toContain('<Modal')
      expect(source).toContain('closeAriaLabel=')
      expect(source).not.toContain('bg-stone')
      expect(source).not.toContain('border-stone')
      expect(source).not.toContain('text-stone')
    }
    expect(audit).toContain('flex-col items-start')
    expect(audit).toContain('sm:flex-row')
    expect(mobileBanner).toContain('min-h-11')
    expect(mobileBanner).toContain('bg-[var(--production-blue)]')
  })

  it('keeps V2 editing accents on process cyan and blue without rainbow group ribbons', () => {
    const accentFiles = [
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/GroupCard.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/GroupReferenceVideoSlot.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/MultiShotBindingsRail.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGalleryView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGroupsView.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineStrip.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearancesPanel.tsx',
      'src/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterEditModal.tsx',
    ]

    for (const file of accentFiles) {
      const source = read(file)
      expect(source).not.toContain('violet')
      expect(source).toMatch(/(?:process-cyan|production-blue|production-focus)/)
    }

    const ribbonFiles = [
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/storyboard-client-helpers.ts',
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2GroupsLayout.tsx',
    ]
    for (const file of ribbonFiles) {
      const source = read(file)
      expect(source).toContain('border-l-[var(--production-blue)]')
      expect(source).toContain('border-l-[var(--process-cyan-strong)]')
      expect(source).not.toMatch(/border-l-(?:amber|rose|emerald|sky|violet|orange)-/)
    }

    const groupCard = read(
      'src/app/[locale]/v2/workspace/[projectId]/storyboard/GroupCard.tsx',
    )
    expect(groupCard).toContain('border-emerald-500/30')
  })

  it('uses production-muted copy for the bulk episode overflow summary', () => {
    const bulkUpload = read(
      'src/app/[locale]/v2/workspace/[projectId]/script/BulkEpisodeUploadButton.tsx',
    )

    expect(bulkUpload).toContain(
      '<li className="px-4 py-2 font-mono text-[12px] text-[var(--production-ink-muted)]">',
    )
    expect(bulkUpload).not.toContain(
      '<li className="px-4 py-2 font-mono text-[11px] text-stone-600">',
    )
  })
})

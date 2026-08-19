import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('studio shell dark theme contract', () => {
  it('uses one three-level dark neutral system across dashboard and workspace shells', () => {
    const theme = read('src/app/[locale]/v2/StudioShell.module.css')
    const dashboard = read('src/app/[locale]/v2/V2HomeClient.tsx')
    const newProject = read('src/app/[locale]/v2/new/V2NewProjectClient.tsx')
    const workspace = read(
      'src/app/[locale]/v2/workspace/[projectId]/V2WorkspaceShell.tsx',
    )

    expect(theme).toContain('--production-paper: #070b0f')
    expect(theme).toContain('--production-surface: #111b24')
    expect(theme).toContain('--production-muted: #17232d')
    expect(theme).toContain('--production-blue: #3e73b9')
    expect(theme).toContain('--production-focus: #55afc0')
    expect(theme).toContain('--surface-raised: var(--darkroom-surface)')
    expect(theme).toContain('--surface-overlay: var(--darkroom-raised)')
    expect(theme).toContain('--text-tertiary: #7f9099')
    expect(theme).toContain('--border-soft: var(--production-border)')
    expect(theme).toContain('--primary-100: #e2f5f8')
    expect(theme).toContain('--primary-200: #b7e2e9')
    expect(theme).toContain('--primary-300: #91d2dc')
    expect(theme).toContain('--primary-400: var(--process-cyan-strong)')
    expect(theme).toContain('--primary-500: var(--process-cyan)')
    expect(theme).toContain('--primary-600: #4b98a7')
    expect(theme).toContain('--primary-700: var(--process-cyan-deep)')
    expect(theme).toContain('--primary-900: #153941')
    expect(theme).not.toMatch(
      /#(?:ffe6f6|ffc2e8|ff8ad8|ff58c5|ff2eaf|d9188c|a9136d|4c0b32)/i,
    )
    expect(theme).toContain('color-scheme: dark')
    expect(theme).not.toMatch(/#f5f3ee|#ffffff/i)

    for (const source of [dashboard, newProject, workspace]) {
      expect(source).toContain('studioStyles.studioRoot')
      expect(source).toContain('data-studio-theme="dark"')
    }
    expect(workspace).toContain('bg-[var(--darkroom-canvas)]')
    expect(workspace).not.toContain("background: 'var(--production-paper)'")
  })

  it('keeps cyan for process state, blue for primary actions, and gold out of navigation', () => {
    const files = [
      'src/app/[locale]/v2/V2HomeClient.tsx',
      'src/app/[locale]/v2/V2HomeRail.tsx',
      'src/app/[locale]/v2/V2WorkflowLauncher.tsx',
      'src/app/[locale]/v2/WorkspaceCollabIntroBanner.tsx',
      'src/app/[locale]/v2/new/V2NewProjectClient.tsx',
      'src/components/v2/Sidebar.tsx',
      'src/components/v2/TopBar.tsx',
    ]
    const sources = files.map(read).join('\n')

    expect(sources).toContain('var(--process-cyan)')
    expect(sources).toContain('kuiper-dashboard-primary')
    expect(sources).not.toMatch(/(?:amber|production-gold|editorial-)/)
    expect(read('src/app/[locale]/v2/new/V2NewProjectClient.tsx')).not.toMatch(
      /(?:stone|bg-white)/,
    )
  })

  it('preserves compact-screen targets, keyboard state, and reduced motion', () => {
    const theme = read('src/app/[locale]/v2/StudioShell.module.css')
    const dashboard = read('src/app/[locale]/v2/V2HomeClient.tsx')
    const newProject = read('src/app/[locale]/v2/new/V2NewProjectClient.tsx')

    expect(theme).toContain('@media (max-width: 390px)')
    expect(theme).toContain('@media (prefers-reduced-motion: reduce)')
    expect(theme).toContain('outline: 2px solid var(--process-cyan)')
    expect(theme).toContain('min-height: 44px')
    expect(dashboard).toContain('h-11 w-11')
    expect(newProject).toContain('aria-pressed={generationMode === opt.v}')
    expect(newProject).toContain('aria-pressed={openingPacing === opt.v}')
    expect(newProject).toContain('aria-pressed={originSkillId === opt.id}')
    expect(newProject).toContain('grid-cols-1 gap-2 sm:grid-cols-2')
  })
})

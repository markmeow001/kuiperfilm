import type { ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enSkills from '../../../messages/en/skills.json'

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  push: vi.fn(),
  uninstall: vi.fn(),
  update: vi.fn(),
  skillsQuery: {
    data: undefined as
      | {
          skills: Array<Record<string, unknown>>
        }
      | undefined,
    isError: false,
    isLoading: false,
  },
  skillQuery: {
    data: undefined as
      | {
          skill: Record<string, unknown>
        }
      | undefined,
    isError: false,
    isLoading: false,
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/lib/query/hooks/useSkills', () => ({
  useSkills: () => mocks.skillsQuery,
  useSkill: () => mocks.skillQuery,
  useInstallSkill: () => ({ mutate: mocks.install }),
  useUpdateSkillInstallation: () => ({ mutate: mocks.update }),
  useUninstallSkill: () => ({ mutate: mocks.uninstall }),
}))

vi.mock('@/components/v2/CreativeToolShell', () => ({
  CreativeToolShell: ({
    title,
    eyebrow,
    description,
    backHref,
    backLabel,
    actions,
    children,
  }: {
    title: ReactNode
    eyebrow: ReactNode
    description?: ReactNode
    backHref: string
    backLabel: string
    actions?: ReactNode
    children: ReactNode
  }) => (
    <section data-creative-tool-shell="studio" data-studio-theme="dark">
      <a href={backHref} aria-label={backLabel}>{backLabel}</a>
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      <div data-creative-tool-actions>{actions}</div>
      <main>{children}</main>
    </section>
  ),
}))

import { SkillsLibraryClient } from '@/app/[locale]/skills/SkillsLibraryClient'
import { SkillDetailClient } from '@/app/[locale]/skills/[slug]/SkillDetailClient'

const installedSkill = {
  id: 'skill-1',
  slug: 'continuity-lab',
  name: '連戲工作流',
  nameEn: 'Continuity Lab',
  description: '鎖定角色與場景連戲。',
  descriptionEn: 'Keep characters and locations consistent.',
  thumbnailUrl: null,
  authorType: 'official',
  authorDisplay: 'Kuiper',
  isFeatured: true,
  popularityScore: 10,
  installCount: 12,
  installed: true,
  installationId: 'installation-1',
  enabled: true,
  installedAt: '2026-08-12T00:00:00.000Z',
  status: 'published',
  config: {
    version: 1,
    input: {},
    pipeline: [{ stage: 'analyze_script', model: 'story-model' }],
    defaults: { aspectRatio: '9:16', audioMode: 'voiced' },
    constraints: { forcePortrait: true },
  },
}

const browseSkill = {
  ...installedSkill,
  id: 'skill-2',
  slug: 'product-film',
  name: '商品影片',
  nameEn: 'Product Film',
  description: '建立商品短片。',
  descriptionEn: 'Build a short product film.',
  installed: false,
  installationId: null,
  enabled: false,
}

function renderWithIntl(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: enSkills }}>
      {node}
    </NextIntlClientProvider>,
  )
}

describe('Skills presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.skillsQuery.data = { skills: [installedSkill, browseSkill] }
    mocks.skillsQuery.isError = false
    mocks.skillsQuery.isLoading = false
    mocks.skillQuery.data = { skill: installedSkill }
    mocks.skillQuery.isError = false
    mocks.skillQuery.isLoading = false
  })

  it('[English library] -> uses the shared shell and localized catalog content', () => {
    const { container } = renderWithIntl(<SkillsLibraryClient locale="en" />)

    expect(container.querySelector('[data-creative-tool-shell="studio"]')).toHaveAttribute(
      'data-studio-theme',
      'dark',
    )
    expect(screen.getByRole('heading', { name: 'Skill Library' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to production' })).toHaveAttribute('href', '/en/v2')
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/en/v2/new')
    expect(screen.getByRole('tablist', { name: 'Skill library views' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continuity Lab' })).toBeInTheDocument()
    expect(screen.getByText('Keep characters and locations consistent.')).toBeInTheDocument()
    expect(screen.queryByText('連戲工作流')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Featured Skills/ }))
    const card = screen.getByRole('article', { name: 'Product Film' })
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }))
    expect(mocks.install).toHaveBeenCalledWith('skill-2', expect.objectContaining({
      onSettled: expect.any(Function),
      onSuccess: expect.any(Function),
    }))
  })

  it('[English detail] -> localizes workflow metadata and keeps one page heading', () => {
    renderWithIntl(<SkillDetailClient locale="en" slug="continuity-lab" />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Continuity Lab' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Skill Library' })).toHaveAttribute(
      'href',
      '/en/skills',
    )
    expect(screen.getByRole('heading', { name: 'Workflow stages' })).toBeInTheDocument()
    expect(screen.getByText('Analyze script')).toBeInTheDocument()
    expect(screen.getByText('Aspect ratio')).toBeInTheDocument()
    expect(screen.getByText('Dialogue')).toBeInTheDocument()
    expect(screen.getByText('Portrait output is required.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create project with this Skill' })).toBeInTheDocument()
    expect(screen.queryByText(/劇本分析|畫面比例|對白配音|強制直式/)).not.toBeInTheDocument()
  })

  it('[catalog request fails] -> shows one explicit error without an empty-library fallback', () => {
    mocks.skillsQuery.data = undefined
    mocks.skillsQuery.isError = true

    renderWithIntl(<SkillsLibraryClient locale="en" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Skill Library')
    expect(screen.queryByText('No Skills enabled yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Browse featured Skills' })).not.toBeInTheDocument()
  })

  it('[detail action] -> preserves the existing project creation route', () => {
    renderWithIntl(<SkillDetailClient locale="en" slug="continuity-lab" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create project with this Skill' }))
    expect(mocks.push).toHaveBeenCalledWith('/en/v2/new?skill=skill-1')
  })
})

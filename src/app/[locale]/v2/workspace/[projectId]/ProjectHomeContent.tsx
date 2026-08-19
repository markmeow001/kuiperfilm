'use client'

import Link from 'next/link'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { PageHeader } from '@/components/v2/PageHeader'
import { StatusPill } from '@/components/v2/StatusPill'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import { ProjectOverviewView } from './ProjectOverviewView'
import { StoryBibleView } from './StoryBibleView'
import styles from './PlanningWorkspace.module.css'
import type {
  ProjectHomeEpisode,
  ProjectHomeModel,
  ProjectHomeProject,
} from './project-home-model'
import { formatProjectDate } from './project-home-model'

type HomeTab = 'overview' | 'story-basis'
const HOME_TABS: readonly HomeTab[] = ['overview', 'story-basis']

interface ProjectHomeContentProps {
  project: ProjectHomeProject
  projectId: string
  locale: string
  episodes: readonly ProjectHomeEpisode[] | null
  model: ProjectHomeModel
  canEdit: boolean
  canManageCollaborators: boolean
  isSupplementalLoading?: boolean
  partialIssues?: readonly string[]
  settingsPanel?: ReactNode
  onOpenCollaborators: () => void
  onOpenAudit: () => void
}

export function ProjectHomeContent({
  project,
  projectId,
  locale,
  episodes,
  model,
  canEdit,
  canManageCollaborators,
  isSupplementalLoading = false,
  partialIssues = [],
  settingsPanel,
  onOpenCollaborators,
  onOpenAudit,
}: ProjectHomeContentProps) {
  const t = useTranslations('v2Production.projectHome')
  const [activeTab, setActiveTab] = useState<HomeTab>('overview')
  const projectName = project.name.trim() || t('unnamed')
  const createdAt = formatProjectDate(project.createdAt, locale)

  const activateTab = (tab: HomeTab, moveFocus = false) => {
    setActiveTab(tab)
    if (!moveFocus) return
    window.requestAnimationFrame(() => {
      document.getElementById(`${tab}-tab`)?.focus()
    })
  }

  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = HOME_TABS.indexOf(activeTab)
    let next: HomeTab | null = null
    if (event.key === 'ArrowLeft') {
      next = HOME_TABS[(currentIndex - 1 + HOME_TABS.length) % HOME_TABS.length]
    } else if (event.key === 'ArrowRight') {
      next = HOME_TABS[(currentIndex + 1) % HOME_TABS.length]
    } else if (event.key === 'Home') {
      next = HOME_TABS[0]
    } else if (event.key === 'End') {
      next = HOME_TABS[HOME_TABS.length - 1]
    }
    if (!next) return
    event.preventDefault()
    activateTab(next, true)
  }

  return (
    <div
      className={`kuiper-dashboard ${styles.planningRoot} px-4 py-6 pb-28 sm:px-6 sm:py-8 lg:px-8 xl:px-10`}
    >
      <div className={`mx-auto max-w-[1280px] ${styles.boundPage}`}>
        <PageHeader
          eyebrow={t('eyebrow')}
          title={projectName}
          description={project.description?.trim() || t('description')}
          context={
            <>
              <StatusPill
                tone={canEdit ? 'active' : 'neutral'}
                label={canEdit ? t('editable') : t('readOnly')}
              />
              <span>
                {createdAt
                  ? t('createdAt', { date: createdAt })
                  : t('createdUnknown')}
              </span>
              {project.workspace?.name ? (
                <span>{t('workspace', { name: project.workspace.name })}</span>
              ) : null}
            </>
          }
          actions={
            <>
              {canManageCollaborators ? (
                <button
                  type="button"
                  onClick={onOpenCollaborators}
                  className="kuiper-dashboard-secondary inline-flex min-h-11 items-center gap-2 px-4 text-[13px] font-semibold"
                >
                  <AppIcon name="userRoundCog" className="h-4 w-4" />
                  {t('collaborators')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onOpenAudit}
                className="kuiper-dashboard-secondary inline-flex min-h-11 items-center gap-2 px-4 text-[13px] font-semibold"
              >
                <AppIcon name="clock" className="h-4 w-4" />
                {t('activity')}
              </button>
            </>
          }
        />

        {project.originSkill ? (
          <Link
            href={`/${locale}/skills`}
            className="mt-5 inline-flex min-h-11 flex-wrap items-center gap-2 rounded-full border border-[var(--production-border)] bg-[var(--production-surface)] px-3 py-1.5 text-[12px] text-[var(--production-ink-muted)] transition-colors hover:border-[var(--production-tool)] motion-reduce:transition-none"
          >
            <span className="font-mono font-semibold uppercase tracking-[0.12em] text-[var(--production-tool)]">
              {t('skillLabel')}
            </span>
            <span className="font-semibold text-[var(--production-ink)]">
              {project.originSkill.name}
            </span>
            <span>{project.originSkill.authorDisplay}</span>
            {project.originSkill.isFeatured ? (
              <StatusPill label={t('featured')} tone="neutral" />
            ) : null}
          </Link>
        ) : null}

        <div className="mt-7 border-b border-[var(--production-border)]">
          <div
            role="tablist"
            aria-label={t('tabLabel')}
            onKeyDown={moveTab}
            className="flex min-w-0 gap-1 overflow-x-auto"
          >
            <HomeTabButton
              id="overview-tab"
              controls="overview-panel"
              active={activeTab === 'overview'}
              onClick={() => activateTab('overview')}
            >
              {t('overviewTab')}
            </HomeTabButton>
            <HomeTabButton
              id="story-basis-tab"
              controls="story-basis-panel"
              active={activeTab === 'story-basis'}
              onClick={() => activateTab('story-basis')}
            >
              {t('storyBasisTab')}
            </HomeTabButton>
          </div>
        </div>

        <div className="mt-6">
          {isSupplementalLoading ? (
            <UiStatePanel
              state="loading"
              locale={locale}
              compact
              className="mb-5"
              title={t('loadingTitle')}
              description={t('loadingDescription')}
            />
          ) : null}
          {partialIssues.length > 0 ? (
            <UiStatePanel
              state="partial"
              locale={locale}
              compact
              className="mb-5"
              title={t('partialTitle')}
              description={t('partialDescription')}
              details={
                <ul className="list-disc space-y-1 pl-5">
                  {partialIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          {activeTab === 'overview' ? (
            <ProjectOverviewView
              projectId={projectId}
              locale={locale}
              model={model}
              canEdit={canEdit}
              settingsPanel={settingsPanel}
              onOpenStoryBasis={() => activateTab('story-basis', true)}
            />
          ) : (
            <StoryBibleView
              project={project}
              projectId={projectId}
              locale={locale}
              episodes={episodes}
              model={model}
              canEdit={canEdit}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function HomeTabButton({
  id,
  controls,
  active,
  onClick,
  children,
}: {
  id: string
  controls: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={[
        'min-h-11 shrink-0 border-b-2 px-4 text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--production-focus)] motion-reduce:transition-none',
        active
          ? 'border-[var(--production-tool)] text-[var(--production-tool)]'
          : 'border-transparent text-[var(--production-ink-muted)] hover:text-[var(--production-ink)]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

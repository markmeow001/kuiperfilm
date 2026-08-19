'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { StatusPill } from '@/components/v2/StatusPill'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import { V2_STEPS, type V2StepId } from '@/components/v2/v2-types'
import { ProjectGraphPanel } from '@/components/v2/project-graph/ProjectGraphPanel'
import type { ProjectHomeModel, ProjectStageStatus } from './project-home-model'
import styles from './PlanningWorkspace.module.css'

interface ProjectOverviewViewProps {
  projectId: string
  locale: string
  model: ProjectHomeModel
  canEdit: boolean
  settingsPanel?: ReactNode
  onOpenStoryBasis: () => void
}

function countValue(value: number | null): string {
  return value === null ? '—' : String(value)
}

function progressValue(done: number | null, total: number | null): string {
  return done === null || total === null ? '—' : `${done}/${total}`
}

export function ProjectOverviewView({
  projectId,
  locale,
  model,
  canEdit,
  settingsPanel,
  onOpenStoryBasis,
}: ProjectOverviewViewProps) {
  const t = useTranslations('v2Production.overview')
  const nextStep = model.nextStep
    ? V2_STEPS.find((step) => step.id === model.nextStep)
    : undefined
  const nextHref = nextStep
    ? `/${locale}/v2/workspace/${projectId}/${nextStep.id}`
    : null
  const stagePresentation: Record<
    ProjectStageStatus,
    { label: string; tone: 'success' | 'active' | 'neutral' | 'warning' }
  > = {
    done: { label: t('statusDone'), tone: 'success' },
    'in-progress': { label: t('statusProgress'), tone: 'active' },
    todo: { label: t('statusTodo'), tone: 'neutral' },
    unavailable: { label: t('statusUnavailable'), tone: 'neutral' },
  }
  const stageLabel = (stepId: V2StepId): string => {
    switch (stepId) {
      case 'home':
        return t('stepHome')
      case 'script':
        return t('stepScript')
      case 'subjects':
        return t('stepSubjects')
      case 'storyboard':
        return t('stepStoryboard')
      case 'voice':
        return t('stepVoice')
      case 'final':
        return t('stepFinal')
    }
  }
  const stageDetail = (stepId: V2StepId): string => {
    switch (stepId) {
      case 'home':
        return t('stageHome')
      case 'script':
        return model.storySource.characterCount === null
          ? t('stageScriptUnavailable')
          : t('stageScript', { count: model.storySource.characterCount })
      case 'subjects':
        return t('stageSubjects', {
          characters: countValue(model.counts.characters),
          locations: countValue(model.counts.locations),
          props: countValue(model.counts.props),
        })
      case 'storyboard':
        return t('stageStoryboard', {
          progress: progressValue(
            model.counts.storyboardDone,
            model.counts.storyboardTotal,
          ),
        })
      case 'voice':
        return t('stageVoice')
      case 'final':
        return t('stageFinal', {
          progress: progressValue(
            model.counts.videoDone,
            model.counts.videoTotal,
          ),
        })
    }
  }

  return (
    <div
      id="overview-panel"
      role="tabpanel"
      aria-labelledby="overview-tab"
      className="space-y-5"
    >
      <section
        className={`kuiper-dashboard-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${styles.staticCard}`}
        aria-label={t('nextActionKicker')}
      >
        <div>
          <p className="kuiper-dashboard-kicker">{t('nextActionKicker')}</p>
          <h2 className="kuiper-dashboard-heading mt-2 text-[20px] leading-7">
            {nextStep
              ? t('nextTitle', { stage: stageLabel(nextStep.id) })
              : t('nextUndeterminedTitle')}
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
            {nextStep
              ? t('nextDescription')
              : t('nextUndeterminedDescription')}
          </p>
        </div>
        {nextHref && nextStep ? (
          <Link
            href={nextHref}
            className="kuiper-dashboard-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-5 text-[14px]"
          >
            {canEdit
              ? t('editStage', { stage: stageLabel(nextStep.id) })
              : t('viewStage', { stage: stageLabel(nextStep.id) })}
            <AppIcon name="arrowRight" className="h-4 w-4" />
          </Link>
        ) : null}
      </section>

      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label={t('metricsLabel')}
      >
        <HomeMetric
          icon="bookOpen"
          label={t('episodes')}
          value={countValue(model.counts.episodes)}
        />
        <HomeMetric
          icon="userCircle"
          label={t('characters')}
          value={countValue(model.counts.characters)}
        />
        <HomeMetric
          icon="image"
          label={t('storyboards')}
          value={progressValue(
            model.counts.storyboardDone,
            model.counts.storyboardTotal,
          )}
        />
        <HomeMetric
          icon="video"
          label={t('videos')}
          value={progressValue(model.counts.videoDone, model.counts.videoTotal)}
        />
      </section>

      <ProjectGraphPanel
        projectId={projectId}
        locale={locale}
        kicker={t('graphKicker')}
      />

      <section
        className={`kuiper-dashboard-card p-5 sm:p-6 ${styles.staticCard}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kuiper-dashboard-kicker">{t('workflowKicker')}</p>
            <h2 className="kuiper-dashboard-heading mt-2 text-[22px] leading-7">
              {t('mapTitle')}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
              {t('mapDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenStoryBasis}
            className="kuiper-dashboard-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-[13px] font-semibold"
          >
            {canEdit ? t('manageStoryBasis') : t('viewStoryBasis')}
            <AppIcon name="bookOpen" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {V2_STEPS.filter((step) => step.id !== 'home').map((step) => {
            const presentation = stagePresentation[model.stageStatus[step.id]]
            return (
              <Link
                key={step.id}
                href={`/${locale}/v2/workspace/${projectId}/${step.id}`}
                className={`group flex min-h-[112px] items-start gap-3 rounded-[12px] border border-[var(--production-border)] p-4 transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-[var(--production-border-dark)] focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none ${styles.stageCard}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--production-border)] bg-[var(--production-surface)] font-mono text-[11px] font-semibold text-[var(--production-tool)]">
                  {step.num}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-[var(--production-ink)]">
                      {stageLabel(step.id)}
                    </span>
                    <StatusPill
                      tone={presentation.tone}
                      label={presentation.label}
                    />
                  </span>
                  <span className="mt-2 block text-[12px] leading-5 text-[var(--production-ink-muted)]">
                    {stageDetail(step.id)}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      <section
        className={`kuiper-dashboard-card overflow-hidden ${styles.staticCard}`}
      >
        <details>
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--production-focus)] sm:px-6">
            <span>
              <span className="block text-[15px] font-semibold text-[var(--production-ink)]">
                {t('settingsTitle')}
              </span>
              <span className="mt-1 block text-[12px] leading-5 text-[var(--production-ink-muted)]">
                {t('settingsDescription')}
              </span>
            </span>
            <AppIcon
              name="chevronDown"
              className="h-5 w-5 shrink-0 text-[var(--production-ink-muted)]"
            />
          </summary>
          <div className={`${styles.settingsWell} p-3 sm:p-5`}>
            {canEdit ? (
              <div className={styles.settingsBridge}>{settingsPanel}</div>
            ) : (
              <UiStatePanel
                state="permission"
                locale={locale}
                compact
                title={t('settingsReadOnlyTitle')}
                description={t('settingsReadOnlyDescription')}
              />
            )}
          </div>
        </details>
      </section>

    </div>
  )
}

function HomeMetric({
  icon,
  label,
  value,
}: {
  icon: 'bookOpen' | 'userCircle' | 'image' | 'video'
  label: string
  value: string
}) {
  return (
    <article
      className={`kuiper-dashboard-card flex min-h-[116px] items-center gap-4 p-4 sm:p-5 ${styles.staticCard}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[var(--production-tool-soft)] text-[var(--production-tool)]">
        <AppIcon name={icon} className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[12px] font-medium text-[var(--production-ink-muted)]">
          {label}
        </p>
        <p className="mt-1 font-mono text-[24px] font-semibold leading-7 text-[var(--production-ink)]">
          {value}
        </p>
      </div>
    </article>
  )
}

'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { StatusPill } from '@/components/v2/StatusPill'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import type {
  ProjectHomeEpisode,
  ProjectHomeModel,
  ProjectHomeProject,
} from './project-home-model'
import { storyExcerpt } from './project-home-model'
import styles from './PlanningWorkspace.module.css'

interface StoryBibleViewProps {
  project: ProjectHomeProject
  projectId: string
  locale: string
  episodes: readonly ProjectHomeEpisode[] | null
  model: ProjectHomeModel
  canEdit: boolean
}

export function StoryBibleView({
  project,
  projectId,
  locale,
  episodes,
  model,
  canEdit,
}: StoryBibleViewProps) {
  const t = useTranslations('v2Production.storyBible')
  const projectSummary = project.description?.trim() || null
  const sourceText = model.storySource.text
  const scriptHref = `/${locale}/v2/workspace/${projectId}/script`
  const countLabel = (
    value: number | null,
    key: 'peopleUnit' | 'locationUnit' | 'propUnit' | 'episodeUnit',
  ) => (value === null ? t('unread') : t(key, { count: value }))

  return (
    <div
      id="story-basis-panel"
      role="tabpanel"
      aria-labelledby="story-basis-tab"
      className="space-y-5"
    >
      {!canEdit ? (
        <UiStatePanel
          state="permission"
          locale={locale}
          compact
          title={t('readOnlyTitle')}
          description={t('readOnlyDescription')}
        />
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <article
          className={`kuiper-dashboard-card p-5 sm:p-6 ${styles.staticCard}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="kuiper-dashboard-kicker">{t('sourceKicker')}</p>
              <h2 className="kuiper-dashboard-heading mt-2 text-[22px] leading-7">
                {t('sourceTitle')}
              </h2>
            </div>
            <StatusPill
              tone={sourceText ? 'success' : 'neutral'}
              label={
                model.storySource.origin === 'project'
                  ? t('sourceProject')
                  : model.storySource.origin === 'episodes'
                    ? t('sourceEpisodes')
                    : model.storySource.origin === 'unavailable'
                      ? t('sourceUnavailable')
                      : t('sourceMissing')
              }
              detail={
                model.storySource.characterCount === null
                  ? undefined
                  : t('charactersCount', {
                      count: model.storySource.characterCount,
                    })
              }
            />
          </div>

          {sourceText ? (
            <div
              className={`mt-5 rounded-[12px] border border-[var(--production-border)] p-4 sm:p-5 ${styles.manuscript}`}
            >
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--production-ink)]">
                {storyExcerpt(sourceText)}
              </p>
              {Array.from(sourceText).length > 680 ? (
                <p className="mt-4 text-[12px] leading-5 text-[var(--production-ink-muted)]">
                  {t('excerptNotice')}
                </p>
              ) : null}
            </div>
          ) : (
            <UiStatePanel
              state={
                model.storySource.origin === 'unavailable' ? 'partial' : 'empty'
              }
              locale={locale}
              compact
              className="mt-5"
              title={
                model.storySource.origin === 'unavailable'
                  ? t('sourceErrorTitle')
                  : t('sourceEmptyTitle')
              }
              description={
                model.storySource.origin === 'unavailable'
                  ? t('sourceErrorDescription')
                  : t('sourceEmptyDescription')
              }
              primaryAction={
                <Link
                  href={scriptHref}
                  className="kuiper-dashboard-primary px-4 text-[14px]"
                >
                  {t('goToScript')}
                </Link>
              }
            />
          )}
        </article>

        <aside
          className={`kuiper-dashboard-card p-5 sm:p-6 ${styles.staticCard}`}
        >
          <p className="kuiper-dashboard-kicker">{t('summaryKicker')}</p>
          <h2 className="kuiper-dashboard-heading mt-2 text-[22px] leading-7">
            {t('summaryTitle')}
          </h2>
          {projectSummary ? (
            <p className="mt-4 whitespace-pre-wrap text-[14px] leading-6 text-[var(--production-ink)]">
              {projectSummary}
            </p>
          ) : (
            <div className="mt-4 rounded-[10px] border border-dashed border-[var(--production-border)] p-4 text-[13px] leading-6 text-[var(--production-ink-muted)]">
              {t('summaryEmpty')}
            </div>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--production-border)] pt-5">
            <BibleMetric
              label={t('characters')}
              value={countLabel(model.counts.characters, 'peopleUnit')}
            />
            <BibleMetric
              label={t('locations')}
              value={countLabel(model.counts.locations, 'locationUnit')}
            />
            <BibleMetric
              label={t('props')}
              value={countLabel(model.counts.props, 'propUnit')}
            />
            <BibleMetric
              label={t('episodes')}
              value={countLabel(model.counts.episodes, 'episodeUnit')}
            />
          </dl>
        </aside>
      </section>

      <section
        className={`kuiper-dashboard-card p-5 sm:p-6 ${styles.staticCard}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="kuiper-dashboard-kicker">{t('architectureKicker')}</p>
            <h2 className="kuiper-dashboard-heading mt-2 text-[22px] leading-7">
              {t('architectureTitle')}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
              {t('architectureDescription')}
            </p>
          </div>
          <Link
            href={scriptHref}
            className="kuiper-dashboard-secondary inline-flex min-h-11 items-center gap-2 px-4 text-[13px] font-semibold"
          >
            {canEdit ? t('manageScript') : t('viewScript')}
            <AppIcon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>

        {episodes === null ? (
          <UiStatePanel
            state="partial"
            locale={locale}
            compact
            className="mt-5"
            title={t('episodesErrorTitle')}
            description={t('episodesErrorDescription')}
          />
        ) : episodes.length === 0 ? (
          <UiStatePanel
            state="empty"
            locale={locale}
            compact
            className="mt-5"
            title={t('episodesEmptyTitle')}
            description={t('episodesEmptyDescription')}
          />
        ) : (
          <ol className="mt-5 grid list-none gap-3 p-0 lg:grid-cols-2">
            {episodes.map((episode) => {
              const hasText = Boolean(episode.novelText?.trim())
              return (
                <li
                  key={episode.id}
                  className={`rounded-[12px] border border-[var(--production-border)] p-4 ${styles.episodeCard}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--production-border)] bg-[var(--production-surface)] font-mono text-[11px] font-semibold text-[var(--production-tool)]">
                      {String(episode.episodeNumber).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="truncate text-[15px] font-semibold leading-6 text-[var(--production-ink)]">
                          {episode.name}
                        </h3>
                        <StatusPill
                          tone={hasText ? 'success' : 'neutral'}
                          label={hasText ? t('hasSource') : t('missingSource')}
                        />
                      </div>
                      <p className="mt-2 text-[13px] leading-5 text-[var(--production-ink-muted)]">
                        {episode.description?.trim() ||
                          t('episodeSummaryEmpty')}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <UiStatePanel
        state="partial"
        locale={locale}
        compact
        title={t('graphTitle')}
        description={t('graphDescription')}
        details={t('graphDetails')}
      />
    </div>
  )
}

function BibleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-[var(--production-paper)] p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--production-ink-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-[14px] font-semibold text-[var(--production-ink)]">
        {value}
      </dd>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CreativeToolShell } from '@/components/v2/CreativeToolShell'
import {
  useSkills,
  useInstallSkill,
  useUpdateSkillInstallation,
  useUninstallSkill,
  type SkillRow,
} from '@/lib/query/hooks/useSkills'
import styles from './SkillsPresentation.module.css'

interface SkillsLibraryClientProps {
  locale: string
}

interface SkillCardLabels {
  add: string
  disabled: string
  enabled: string
  featured: string
  installing: string
  installCount: (count: string) => string
  remove: string
}

export function SkillsLibraryClient({ locale }: SkillsLibraryClientProps) {
  const t = useTranslations('skills')
  const skillsQuery = useSkills()
  const installMutation = useInstallSkill()
  const updateMutation = useUpdateSkillInstallation()
  const uninstallMutation = useUninstallSkill()
  const [activeTab, setActiveTab] = useState<'mine' | 'browse'>('mine')
  const [busyId, setBusyId] = useState<string | null>(null)

  const all = skillsQuery.data?.skills ?? []
  const installed = all.filter((skill) => skill.installed)
  const browsable = all.filter((skill) => !skill.installed)
  const isEnglish = locale.toLowerCase().startsWith('en')
  const detailHref = (slug: string) => `/${locale}/skills/${slug}`
  const labels: SkillCardLabels = {
    add: t('library.add'),
    disabled: t('library.disabled'),
    enabled: t('library.enabled'),
    featured: t('library.featured'),
    installing: t('library.installing'),
    installCount: (count) => t('library.installCount', { count }),
    remove: t('library.remove'),
  }

  function handleToggle(skill: SkillRow) {
    if (!skill.installationId) return
    setBusyId(skill.id)
    updateMutation.mutate(
      { installationId: skill.installationId, enabled: !skill.enabled },
      { onSettled: () => setBusyId(null) },
    )
  }

  function handleInstall(skill: SkillRow) {
    setBusyId(skill.id)
    installMutation.mutate(skill.id, {
      onSettled: () => setBusyId(null),
      onSuccess: () => setActiveTab('mine'),
    })
  }

  function handleUninstall(skill: SkillRow) {
    if (!skill.installationId) return
    setBusyId(skill.id)
    uninstallMutation.mutate(skill.installationId, {
      onSettled: () => setBusyId(null),
    })
  }

  return (
    <CreativeToolShell
      locale={locale}
      eyebrow={t('shell.eyebrow')}
      title={t('shell.libraryTitle')}
      description={t('shell.libraryDescription')}
      backHref={`/${locale}/v2`}
      backLabel={t('shell.backToProduction')}
      actions={(
        <Link href={`/${locale}/v2/new`} className={styles.primaryAction}>
          {t('shell.createProject')}
        </Link>
      )}
    >
      <div className={styles.scroller}>
        <section className={styles.container} aria-label={t('shell.libraryTitle')}>
          <div className={styles.tabs} role="tablist" aria-label={t('library.tabsLabel')}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'mine'}
              aria-controls="skills-mine-panel"
              id="skills-mine-tab"
              onClick={() => setActiveTab('mine')}
              className={`${styles.tab} ${activeTab === 'mine' ? styles.tabActive : ''}`}
            >
              <span>{t('library.mineTab')}</span>
              <span className={styles.count}>{installed.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'browse'}
              aria-controls="skills-browse-panel"
              id="skills-browse-tab"
              onClick={() => setActiveTab('browse')}
              className={`${styles.tab} ${activeTab === 'browse' ? styles.tabActive : ''}`}
            >
              <span>{t('library.browseTab')}</span>
              <span className={styles.count}>{browsable.length}</span>
            </button>
          </div>

          {skillsQuery.isLoading ? (
            <div className={styles.stateCard} role="status">
              {t('library.loading')}
            </div>
          ) : null}

          {skillsQuery.isError ? (
            <div className={`${styles.stateCard} ${styles.errorCard}`} role="alert">
              <strong>{t('library.loadErrorTitle')}</strong>
              <span>{t('library.loadErrorDescription')}</span>
            </div>
          ) : null}

          {!skillsQuery.isLoading && !skillsQuery.isError && activeTab === 'mine' ? (
            <div
              id="skills-mine-panel"
              role="tabpanel"
              aria-labelledby="skills-mine-tab"
              className={styles.panel}
            >
              {installed.length === 0 ? (
                <EmptyMineState
                  eyebrow={t('library.emptyMineEyebrow')}
                  title={t('library.emptyMineTitle')}
                  description={t('library.emptyMineDescription')}
                  action={t('library.browseFeatured')}
                  onBrowse={() => setActiveTab('browse')}
                />
              ) : (
                installed.map((skill) => (
                  <SkillRowCard
                    key={skill.id}
                    skill={skill}
                    busy={busyId === skill.id}
                    detailHref={detailHref(skill.slug)}
                    isEnglish={isEnglish}
                    locale={locale}
                    labels={labels}
                    variant="installed"
                    onToggle={() => handleToggle(skill)}
                    onUninstall={() => handleUninstall(skill)}
                  />
                ))
              )}
            </div>
          ) : null}

          {!skillsQuery.isLoading && !skillsQuery.isError && activeTab === 'browse' ? (
            <div
              id="skills-browse-panel"
              role="tabpanel"
              aria-labelledby="skills-browse-tab"
              className={styles.panel}
            >
              {browsable.length === 0 ? (
                <div className={styles.stateCard}>
                  <strong>{t('library.allEnabledTitle')}</strong>
                  <span>{t('library.allEnabledDescription')}</span>
                </div>
              ) : (
                browsable.map((skill) => (
                  <SkillRowCard
                    key={skill.id}
                    skill={skill}
                    busy={busyId === skill.id}
                    detailHref={detailHref(skill.slug)}
                    isEnglish={isEnglish}
                    locale={locale}
                    labels={labels}
                    variant="browse"
                    onInstall={() => handleInstall(skill)}
                  />
                ))
              )}
            </div>
          ) : null}
        </section>
      </div>
    </CreativeToolShell>
  )
}

function EmptyMineState({
  eyebrow,
  title,
  description,
  action,
  onBrowse,
}: {
  eyebrow: string
  title: string
  description: string
  action: string
  onBrowse: () => void
}) {
  return (
    <div className={`${styles.stateCard} ${styles.emptyState}`}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <strong className={styles.emptyTitle}>{title}</strong>
      <p>{description}</p>
      <button type="button" onClick={onBrowse} className={styles.primaryButton}>
        {action}
      </button>
    </div>
  )
}

function SkillRowCard({
  skill,
  busy,
  variant,
  detailHref,
  isEnglish,
  locale,
  labels,
  onToggle,
  onInstall,
  onUninstall,
}: {
  skill: SkillRow
  busy: boolean
  variant: 'installed' | 'browse'
  detailHref: string
  isEnglish: boolean
  locale: string
  labels: SkillCardLabels
  onToggle?: () => void
  onInstall?: () => void
  onUninstall?: () => void
}) {
  const displayName = isEnglish && skill.nameEn ? skill.nameEn : skill.name
  const displayDescription = isEnglish && skill.descriptionEn
    ? skill.descriptionEn
    : skill.description

  return (
    <article className={styles.card} aria-label={displayName}>
      <div className={styles.cardMain}>
        <div className={styles.cardHeading}>
          <Link href={detailHref} className={styles.cardTitle}>
            {displayName}
          </Link>
          {skill.isFeatured ? <span className={styles.badge}>{labels.featured}</span> : null}
        </div>
        <div className={styles.metadata}>
          <span>{skill.authorDisplay}</span>
          {skill.installCount > 0 ? (
            <span>{labels.installCount(skill.installCount.toLocaleString(locale))}</span>
          ) : null}
        </div>
        <p className={styles.cardDescription}>{displayDescription}</p>
      </div>

      <div className={styles.cardActions}>
        {variant === 'installed' ? (
          <>
            <label className={styles.toggleHitArea}>
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={onToggle}
                disabled={busy}
                className={styles.checkbox}
              />
              <span>{skill.enabled ? labels.enabled : labels.disabled}</span>
            </label>
            <button
              type="button"
              onClick={onUninstall}
              disabled={busy}
              className={styles.secondaryButton}
            >
              {labels.remove}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={busy}
            className={styles.primaryButton}
          >
            {busy ? labels.installing : labels.add}
          </button>
        )}
      </div>
    </article>
  )
}

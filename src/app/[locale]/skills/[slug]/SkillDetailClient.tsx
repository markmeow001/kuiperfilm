'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CreativeToolShell } from '@/components/v2/CreativeToolShell'
import { useSkill, useInstallSkill } from '@/lib/query/hooks/useSkills'
import type {
  SkillConfig,
  SkillPipelineStage,
  SkillDefaults,
  SkillConstraints,
} from '@/lib/skills/types'
import styles from '../SkillsPresentation.module.css'

interface SkillDetailClientProps {
  locale: string
  slug: string
}

type SkillsT = ReturnType<typeof useTranslations>

export function SkillDetailClient({ locale, slug }: SkillDetailClientProps) {
  const t = useTranslations('skills')
  const router = useRouter()
  const skillQuery = useSkill(slug)
  const installMutation = useInstallSkill()
  const [installing, setInstalling] = useState(false)
  const skill = skillQuery.data?.skill ?? null
  const config = parseSkillConfig(skill?.config)
  const isEnglish = locale.toLowerCase().startsWith('en')
  const displayName = skill
    ? isEnglish && skill.nameEn
      ? skill.nameEn
      : skill.name
    : t('shell.detailTitle')
  const displayDescription = skill
    ? isEnglish && skill.descriptionEn
      ? skill.descriptionEn
      : skill.description
    : undefined

  function handleInstall() {
    if (!skill) return
    setInstalling(true)
    installMutation.mutate(skill.id, {
      onSettled: () => setInstalling(false),
    })
  }

  function handleUseSkill() {
    if (!skill) return
    router.push(`/${locale}/v2/new?skill=${skill.id}`)
  }

  return (
    <CreativeToolShell
      locale={locale}
      eyebrow={t('shell.eyebrow')}
      title={displayName}
      description={skill ? t('shell.detailTitle') : undefined}
      backHref={`/${locale}/skills`}
      backLabel={t('shell.backToLibrary')}
    >
      <div className={styles.scroller}>
        <div className={`${styles.container} ${styles.detailContainer}`}>
          {skillQuery.isLoading ? (
            <div className={styles.stateCard} role="status">
              {t('detail.loading')}
            </div>
          ) : skillQuery.isError || !skill ? (
            <div className={`${styles.stateCard} ${styles.errorCard}`} role="alert">
              <strong>{t('detail.notFoundTitle')}</strong>
              <span>{t('detail.notFoundDescription')}</span>
              <Link href={`/${locale}/skills`} className={styles.secondaryAction}>
                {t('shell.backToLibrary')}
              </Link>
            </div>
          ) : (
            <>
              <div className={styles.heroMetadata}>
                <span className={styles.author}>{skill.authorDisplay}</span>
                {skill.isFeatured ? <span className={styles.badge}>{t('library.featured')}</span> : null}
                {skill.installCount > 0 ? (
                  <span>{t('library.installCount', { count: skill.installCount.toLocaleString(locale) })}</span>
                ) : null}
                <span className={styles.kindBadge}>
                  {skill.authorType === 'official' ? t('detail.official') : t('detail.community')}
                </span>
              </div>

              <section className={styles.detailSection}>
                <h2 className={styles.sectionTitle}>{t('detail.introduction')}</h2>
                <p className={styles.longDescription}>{displayDescription}</p>
              </section>

              {config && config.pipeline.length > 0 ? (
                <section className={styles.detailSection}>
                  <h2 className={styles.sectionTitle}>{t('detail.pipeline')}</h2>
                  <p className={styles.sectionDescription}>{t('detail.pipelineDescription')}</p>
                  <ol className={styles.stageList}>
                    {config.pipeline.map((stage, index) => (
                      <PipelineStageRow
                        key={`${stage.stage}-${index}`}
                        index={index + 1}
                        stage={stage}
                        t={t}
                      />
                    ))}
                  </ol>
                </section>
              ) : null}

              {config?.defaults ? (
                <section className={styles.detailSection}>
                  <h2 className={styles.sectionTitle}>{t('detail.defaults')}</h2>
                  <DefaultsList defaults={config.defaults} t={t} />
                </section>
              ) : null}

              {config?.constraints ? (
                <section className={styles.detailSection}>
                  <h2 className={styles.sectionTitle}>{t('detail.constraints')}</h2>
                  <ConstraintsList constraints={config.constraints} t={t} />
                </section>
              ) : null}

              <div className={styles.actionDock}>
                <div className={styles.actionCopy}>
                  <strong className={skill.installed ? styles.successText : undefined}>
                    {skill.installed ? t('detail.installedTitle') : t('detail.unavailableTitle')}
                  </strong>
                  <span>
                    {skill.installed
                      ? t('detail.installedDescription')
                      : t('detail.unavailableDescription')}
                  </span>
                </div>
                {skill.installed ? (
                  <button type="button" onClick={handleUseSkill} className={styles.primaryButton}>
                    {t('detail.useSkill')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleInstall}
                    disabled={installing}
                    className={styles.primaryButton}
                  >
                    {installing ? t('detail.addingSkill') : t('detail.addSkill')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </CreativeToolShell>
  )
}

function PipelineStageRow({
  index,
  stage,
  t,
}: {
  index: number
  stage: SkillPipelineStage
  t: SkillsT
}) {
  const settingsEntries = stage.settings
    ? Object.entries(stage.settings).filter(([, value]) => value !== undefined && value !== null)
    : []

  return (
    <li className={styles.stageRow}>
      <span className={styles.stageIndex}>{String(index).padStart(2, '0')}</span>
      <div className={styles.stageBody}>
        <strong>{t(`detail.stage.${stage.stage}`)}</strong>
        {stage.model ? (
          <span className={styles.modelLabel}>{t('detail.model')} · {stage.model}</span>
        ) : null}
        {settingsEntries.length > 0 ? (
          <div className={styles.settings}>
            {settingsEntries.map(([key, value]) => (
              <span key={key}><em>{key}</em>: {String(value)}</span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

function DefaultsList({ defaults, t }: { defaults: SkillDefaults; t: SkillsT }) {
  const rows: Array<{ label: string; value: string }> = []
  if (defaults.aspectRatio) rows.push({ label: t('detail.defaultLabel.aspectRatio'), value: defaults.aspectRatio })
  if (typeof defaults.durationPerShotSec === 'number') {
    rows.push({ label: t('detail.defaultLabel.durationPerShot'), value: `${defaults.durationPerShotSec}s` })
  }
  if (typeof defaults.shotCount === 'number') {
    rows.push({ label: t('detail.defaultLabel.shotCount'), value: String(defaults.shotCount) })
  }
  if (defaults.storyboardGrid) rows.push({ label: t('detail.defaultLabel.storyboardGrid'), value: defaults.storyboardGrid })
  if (defaults.resolution) rows.push({ label: t('detail.defaultLabel.resolution'), value: defaults.resolution })
  if (defaults.audioMode) {
    rows.push({ label: t('detail.defaultLabel.audioMode'), value: t(`detail.audioMode.${defaults.audioMode}`) })
  }
  if (defaults.voNarration) {
    rows.push({ label: t('detail.defaultLabel.narration'), value: t(`detail.narration.${defaults.voNarration}`) })
  }
  if (defaults.visualStyleId) {
    rows.push({ label: t('detail.defaultLabel.visualStyle'), value: defaults.visualStyleId })
  }

  if (rows.length === 0) return <p className={styles.sectionDescription}>{t('detail.noDefaults')}</p>

  return (
    <dl className={styles.defaultGrid}>
      {rows.map((row) => (
        <div key={row.label} className={styles.defaultRow}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ConstraintsList({ constraints, t }: { constraints: SkillConstraints; t: SkillsT }) {
  const items: string[] = []
  if (constraints.enforceAudioRefPerCharacter) items.push(t('detail.constraint.audioReference'))
  if (constraints.forcePortrait) items.push(t('detail.constraint.portrait'))
  if (constraints.forceLandscape) items.push(t('detail.constraint.landscape'))
  if (constraints.forbiddenSubjects?.length) {
    items.push(t('detail.constraint.forbiddenSubjects', { subjects: constraints.forbiddenSubjects.join(' / ') }))
  }

  if (items.length === 0) return <p className={styles.sectionDescription}>{t('detail.noConstraints')}</p>

  return (
    <ul className={styles.constraintList}>
      {items.map((item) => (
        <li key={item}><span aria-hidden="true">!</span><span>{item}</span></li>
      ))}
    </ul>
  )
}

function parseSkillConfig(raw: unknown): SkillConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) return null

  const rawPipeline = Array.isArray(obj.pipeline) ? obj.pipeline : []
  const pipeline: SkillPipelineStage[] = []
  for (const stage of rawPipeline) {
    if (!stage || typeof stage !== 'object') continue
    const value = stage as Record<string, unknown>
    if (typeof value.stage !== 'string') continue
    pipeline.push({
      stage: value.stage as SkillPipelineStage['stage'],
      ...(typeof value.model === 'string' ? { model: value.model } : {}),
      ...(value.settings && typeof value.settings === 'object'
        ? { settings: value.settings as Record<string, unknown> }
        : {}),
    })
  }

  return {
    version: 1,
    input: (obj.input as SkillConfig['input']) ?? {},
    pipeline,
    defaults: (obj.defaults as SkillDefaults) ?? {},
    ...(obj.prompts && typeof obj.prompts === 'object'
      ? { prompts: obj.prompts as SkillConfig['prompts'] }
      : {}),
    ...(obj.constraints && typeof obj.constraints === 'object'
      ? { constraints: obj.constraints as SkillConstraints }
      : {}),
  }
}

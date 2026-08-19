'use client'

import { useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useStyleProfile } from '@/lib/query/hooks/useStyleProfile'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { useUpdateProjectConfig } from '@/lib/query/mutations/useProjectConfigMutations'
import {
  useUpdateStyleProfile,
  type StyleProfileUpdatePayload,
} from '@/lib/query/mutations/updateStyleProfile'
import {
  STYLE_PROFILE_PRESETS,
  PRESET_ORDER_BY_CATEGORY,
  type PresetKey,
  type PresetCategory,
} from '@/lib/style-profile/presets'
import { visualStyles, lightingPresets } from '@/lib/style-library'

const RATIO_OPTIONS = [
  { value: '9:16', label: '9:16', captionKey: 'ratioPortrait' },
  { value: '16:9', label: '16:9', captionKey: 'ratioLandscape' },
  { value: '1:1', label: '1:1', captionKey: 'ratioSquare' },
  { value: '4:3', label: '4:3', captionKey: 'ratioClassic' },
] as const

const DURATION_OPTIONS = [
  { value: 30, labelKey: 'durationThirty', captionKey: 'durationShort' },
  { value: 60, labelKey: 'durationMinute', captionKey: 'durationDefault' },
  { value: 90, labelKey: 'durationNinety', captionKey: null },
  { value: 120, labelKey: 'durationTwoMinutes', captionKey: null },
  { value: 180, labelKey: 'durationThreeMinutes', captionKey: 'durationLong' },
] as const

const RESOLUTION_OPTIONS = [
  { value: '480p', label: '480p', captionKey: 'resolutionDraft' },
  { value: '720p', label: '720p', captionKey: 'resolutionDefault' },
  { value: '1080p', label: '1080p', captionKey: 'resolutionHigh' },
] as const

const CATEGORY_ORDER: PresetCategory[] = [
  'realistic',
  'anime',
  'chinese',
  'korean',
  'cg-3d',
  'western',
]
const LIBRARY_CATEGORY_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const

const CHOICE_BASE_CLASS =
  'min-h-11 rounded-[9px] border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:cursor-not-allowed disabled:opacity-50'
const CHOICE_ACTIVE_CLASS =
  'border-[var(--process-cyan)] bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
const CHOICE_IDLE_CLASS =
  'border-[var(--production-border)] text-[var(--production-ink-muted)] hover:border-[var(--production-border-dark)] hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)]'
const TILE_ACTIVE_CLASS =
  'border-[var(--process-cyan)] ring-2 ring-[rgba(85,175,192,0.22)]'
const TILE_IDLE_CLASS =
  'border-[var(--production-border)] hover:border-[var(--production-border-dark)]'

interface ProjectShape {
  novelPromotionData?: {
    videoRatio?: string | null
    videoResolution?: string | null
    videoModel?: string | null
    targetDuration?: number | null
    analysisModel?: string | null
  } | null
}

type ConfigPayload = { key: string; value: unknown }
type SaveOperation =
  | { kind: 'config'; payload: ConfigPayload }
  | { kind: 'style'; payload: StyleProfileUpdatePayload }
type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; operation: SaveOperation }
  | { status: 'saved'; operation: SaveOperation }
  | { status: 'error'; operation: SaveOperation; error: string }

function modelSupportsResolutionChoice(videoModel: string | null | undefined): boolean {
  if (!videoModel) return false
  return (
    videoModel === 'ark::doubao-seedance-2-0-260128' ||
    videoModel === 'ark::doubao-seedance-2-0-fast-260128' ||
    videoModel === 'atlascloud::seedance-2.0-r2v'
  )
}

function modelSupports1080p(videoModel: string | null | undefined): boolean {
  if (!videoModel) return true
  return videoModel !== 'ark::doubao-seedance-2-0-fast-260128'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

interface V2ProjectSettingsPanelProps {
  projectId: string
}

export function V2ProjectSettingsPanel({ projectId }: V2ProjectSettingsPanelProps) {
  const t = useTranslations('v2Production.projectSettings')
  const locale = useLocale()
  const isZh = locale.toLowerCase().startsWith('zh')
  const projectQuery = useProjectData(projectId)
  const styleQuery = useStyleProfile(projectId)
  const userModelsQuery = useUserModels()
  const updateConfig = useUpdateProjectConfig(projectId)
  const updateStyle = useUpdateStyleProfile(projectId)
  const saveLock = useRef(false)
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })

  const sources = [
    {
      key: 'project' as const,
      label: t('sourceProject'),
      data: projectQuery.data,
      isPending: projectQuery.isPending,
      isFetching: projectQuery.isFetching,
      isError: projectQuery.isError,
      error: projectQuery.error,
      refetch: projectQuery.refetch,
    },
    {
      key: 'style' as const,
      label: t('sourceStyle'),
      data: styleQuery.data,
      isPending: styleQuery.isPending,
      isFetching: styleQuery.isFetching,
      isError: styleQuery.isError,
      error: styleQuery.error,
      refetch: styleQuery.refetch,
    },
    {
      key: 'models' as const,
      label: t('sourceModels'),
      data: userModelsQuery.data,
      isPending: userModelsQuery.isPending,
      isFetching: userModelsQuery.isFetching,
      isError: userModelsQuery.isError,
      error: userModelsQuery.error,
      refetch: userModelsQuery.refetch,
    },
  ]
  const unavailableSources = sources.filter((source) => source.data == null)
  const backgroundIssues = sources.filter(
    (source) => source.data != null && source.isError,
  )

  const project = projectQuery.data as ProjectShape | undefined
  const videoRatio = project?.novelPromotionData?.videoRatio ?? '9:16'
  const videoResolution = (project?.novelPromotionData?.videoResolution ??
    '720p') as '480p' | '720p' | '1080p'
  const videoModel = project?.novelPromotionData?.videoModel ?? null
  const targetDuration = project?.novelPromotionData?.targetDuration ?? 60
  const analysisModel = project?.novelPromotionData?.analysisModel ?? null
  const textModels = userModelsQuery.data?.llm ?? []
  const showResolutionPicker = modelSupportsResolutionChoice(videoModel)
  const allow1080p = modelSupports1080p(videoModel)
  const selectedPresetKey = (styleQuery.data?.stylePresetKey ?? null) as PresetKey | null
  const selectedPreset = selectedPresetKey
    ? STYLE_PROFILE_PRESETS[selectedPresetKey]
    : undefined
  const selectedPresetLabel = selectedPreset
    ? isZh
      ? selectedPreset.zhLabel
      : selectedPreset.label
    : null
  const selectedVisualStyleId = styleQuery.data?.visualStyleId ?? null
  const selectedLightingPresetId = styleQuery.data?.lightingPresetId ?? null
  const selectedVisualStyleLabel = useMemo(() => {
    if (!selectedVisualStyleId) return null
    const hit = visualStyles.find((style) => style.id === selectedVisualStyleId)
    return hit ? (isZh ? hit.nameZh : hit.nameEn) : null
  }, [isZh, selectedVisualStyleId])

  const presetGroups = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        keys: PRESET_ORDER_BY_CATEGORY[category],
      })),
    [],
  )
  const libraryGroups = useMemo(
    () =>
      LIBRARY_CATEGORY_ORDER.map((category) => ({
        category,
        styles: visualStyles
          .filter((style) => style.category === category && style.isActive !== false)
          .sort((a, b) => a.displayOrder - b.displayOrder),
      })).filter((group) => group.styles.length > 0),
    [],
  )
  const sortedLightings = useMemo(
    () =>
      lightingPresets
        .filter((lighting) => lighting.isActive !== false)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [],
  )

  const mutationBusy =
    saveState.status === 'saving' || updateConfig.isPending || updateStyle.isPending

  async function runSave(operation: SaveOperation) {
    if (saveLock.current || updateConfig.isPending || updateStyle.isPending) return
    saveLock.current = true
    setSaveState({ status: 'saving', operation })
    try {
      if (operation.kind === 'config') {
        await updateConfig.mutateAsync(operation.payload)
      } else {
        await updateStyle.mutateAsync(operation.payload)
      }
      setSaveState({ status: 'saved', operation })
    } catch (error) {
      setSaveState({
        status: 'error',
        operation,
        error: errorMessage(error, t('unknownError')),
      })
    } finally {
      saveLock.current = false
    }
  }

  const panelHeader = (
    <div className="mb-4 flex items-center gap-2">
      <AppIcon
        name="sparklesAlt"
        className="h-4 w-4 text-[var(--process-cyan-strong)]"
      />
      <span className="font-fraunces text-sm font-semibold text-[var(--production-ink)]">
        {t('title')}
      </span>
    </div>
  )

  if (unavailableSources.length > 0) {
    const hasError = unavailableSources.some(
      (source) => source.isError || !source.isPending,
    )
    return (
      <section className="rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)] p-4 text-[var(--production-ink)] sm:p-6">
        {panelHeader}
        <div
          className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-muted)] p-4"
          aria-busy={!hasError}
        >
          <h3 className="font-fraunces text-base font-semibold">
            {hasError ? t('loadErrorTitle') : t('loadingTitle')}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--production-ink-muted)]">
            {t('loadingDescription')}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {unavailableSources.map((source) => {
              const sourceFailed = source.isError || !source.isPending
              return (
                <div
                  key={source.key}
                  data-testid={`settings-source-${source.key}`}
                  className="rounded-[10px] border border-[var(--production-border)] bg-[var(--production-surface)] p-3"
                >
                  <p className="text-sm font-semibold">{source.label}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--production-ink-muted)]">
                    {sourceFailed
                      ? errorMessage(
                          source.error,
                          source.isError ? t('sourceError') : t('sourceUnavailable'),
                        )
                      : t('sourceLoading')}
                  </p>
                  {sourceFailed ? (
                    <button
                      type="button"
                      onClick={() => void source.refetch()}
                      disabled={source.isFetching}
                      className={`${CHOICE_BASE_CLASS} mt-3 text-xs ${CHOICE_IDLE_CLASS}`}
                    >
                      {t('retry')}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)] p-4 text-[var(--production-ink)] sm:p-6">
      {panelHeader}

      {backgroundIssues.length > 0 ? (
        <div className="mb-5 rounded-[12px] border border-[var(--warning)] bg-[rgba(245,158,11,0.08)] p-4">
          <p className="text-sm font-semibold text-[var(--production-ink)]">
            {t('backgroundIssueTitle')}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--production-ink-muted)]">
            {t('backgroundIssueDescription')}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {backgroundIssues.map((source) => (
              <div
                key={source.key}
                data-testid={`settings-background-${source.key}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-[var(--production-border)] bg-[var(--production-surface)] p-2.5"
              >
                <span className="min-w-0 text-xs text-[var(--production-ink-muted)]">
                  <strong className="text-[var(--production-ink)]">{source.label}</strong>
                  {' · '}
                  {errorMessage(source.error, t('unknownError'))}
                </span>
                <button
                  type="button"
                  onClick={() => void source.refetch()}
                  disabled={mutationBusy || source.isFetching}
                  className={`${CHOICE_BASE_CLASS} text-xs ${CHOICE_IDLE_CLASS}`}
                >
                  {t('retry')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {saveState.status === 'saving' || saveState.status === 'saved' ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-5 rounded-[10px] border border-[var(--process-cyan)] bg-[var(--process-cyan-soft)] px-3 py-2 text-sm text-[var(--process-cyan-strong)]"
        >
          {saveState.status === 'saving' ? t('saving') : t('saved')}
        </div>
      ) : null}

      {saveState.status === 'error' ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-5 rounded-[10px] border border-[var(--production-danger)] bg-[rgba(240,118,118,0.08)] p-3"
        >
          <p className="text-sm font-semibold text-[var(--production-ink)]">
            {t('saveFailed')}
          </p>
          <p className="mt-1 break-words text-xs leading-5 text-[var(--production-ink-muted)]">
            {t('saveErrorDetail', { message: saveState.error })}
          </p>
          <button
            type="button"
            onClick={() => void runSave(saveState.operation)}
            disabled={mutationBusy}
            className={`${CHOICE_BASE_CLASS} mt-3 text-xs ${CHOICE_IDLE_CLASS}`}
          >
            {t('retrySave')}
          </button>
        </div>
      ) : null}

      <div className="mb-5">
        <div className="mb-2 font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
          {t('aspectTitle')}
        </div>
        <div className="flex flex-wrap gap-2">
          {RATIO_OPTIONS.map((ratio) => {
            const active = ratio.value === videoRatio
            return (
              <button
                key={ratio.value}
                type="button"
                onClick={() =>
                  void runSave({
                    kind: 'config',
                    payload: { key: 'videoRatio', value: ratio.value },
                  })
                }
                disabled={mutationBusy}
                aria-pressed={active}
                className={`${CHOICE_BASE_CLASS} font-mono text-xs ${
                  active ? CHOICE_ACTIVE_CLASS : CHOICE_IDLE_CLASS
                }`}
              >
                {ratio.label}
                <span className="ml-1.5 text-[14px] opacity-70">
                  {t(ratio.captionKey)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
          {t('durationTitle')}
          <span className="ml-2 text-[14px] text-[var(--production-ink-muted)]">
            {t('durationHint')}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DURATION_OPTIONS.map((duration) => {
            const active = duration.value === targetDuration
            return (
              <button
                key={duration.value}
                type="button"
                onClick={() =>
                  void runSave({
                    kind: 'config',
                    payload: { key: 'targetDuration', value: duration.value },
                  })
                }
                disabled={mutationBusy}
                aria-pressed={active}
                className={`${CHOICE_BASE_CLASS} font-mono text-xs ${
                  active ? CHOICE_ACTIVE_CLASS : CHOICE_IDLE_CLASS
                }`}
              >
                {t(duration.labelKey)}
                {duration.captionKey ? (
                  <span className="ml-1.5 text-[14px] opacity-70">
                    {t(duration.captionKey)}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {showResolutionPicker ? (
        <div className="mb-5">
          <div className="mb-2 font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
            {t('resolutionTitle')}
            <span className="ml-2 text-[14px] text-[var(--production-ink-muted)]">
              {t('resolutionHint')}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {RESOLUTION_OPTIONS.map((resolution) => {
              const unsupported = resolution.value === '1080p' && !allow1080p
              const active = resolution.value === videoResolution && !unsupported
              return (
                <button
                  key={resolution.value}
                  type="button"
                  onClick={() =>
                    !unsupported &&
                    void runSave({
                      kind: 'config',
                      payload: { key: 'videoResolution', value: resolution.value },
                    })
                  }
                  disabled={mutationBusy || unsupported}
                  title={unsupported ? t('resolutionUnsupported') : undefined}
                  aria-pressed={active}
                  className={`${CHOICE_BASE_CLASS} font-mono text-xs disabled:opacity-30 ${
                    active ? CHOICE_ACTIVE_CLASS : CHOICE_IDLE_CLASS
                  }`}
                >
                  {resolution.label}
                  <span className="ml-1.5 text-[14px] opacity-70">
                    {t(resolution.captionKey)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="mb-5">
        <div className="mb-2 font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
          {t('analysisTitle')}
          <span className="ml-2 text-[14px] text-[var(--production-ink-muted)]">
            {t('analysisHint')}
          </span>
        </div>
        {textModels.length === 0 ? (
          <div className="text-[13px] text-[var(--production-ink-muted)]">
            {t('noTextModels')}
          </div>
        ) : (
          <select
            value={analysisModel ?? ''}
            onChange={(event) => {
              if (!event.target.value) return
              void runSave({
                kind: 'config',
                payload: { key: 'analysisModel', value: event.target.value },
              })
            }}
            disabled={mutationBusy}
            aria-label={t('analysisTitle')}
            className="min-h-11 w-full max-w-[420px] rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)] px-3 py-2 font-mono text-xs text-[var(--production-ink)] outline-none hover:border-[var(--production-border-dark)] focus-visible:border-[var(--production-focus)] focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.24)] disabled:opacity-50"
          >
            {!analysisModel ? (
              <option value="" disabled>
                {t('selectTextModel')}
              </option>
            ) : null}
            {analysisModel && !textModels.some((model) => model.value === analysisModel) ? (
              <option value={analysisModel}>
                {analysisModel} ({t('currentModelUnavailable')})
              </option>
            ) : null}
            {textModels.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
                {model.providerName ?? model.provider
                  ? ` · ${model.providerName ?? model.provider}`
                  : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <div className="mb-2 font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
          {t('styleTitle')}
          {selectedPresetLabel ? (
            <span className="ml-2 text-[var(--process-cyan-strong)]">
              {t('selectedStyle', { name: selectedPresetLabel })}
            </span>
          ) : null}
        </div>
        <div className="space-y-3">
          {presetGroups.map((group) => (
            <div key={group.category}>
              <div className="mb-1.5 font-mono text-[12px] uppercase tracking-wider text-[var(--production-ink-muted)]">
                {t(
                  `presetCategories.${group.category === 'cg-3d' ? 'cg3d' : group.category}`,
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.keys.map((key) => {
                  const entry = STYLE_PROFILE_PRESETS[key]
                  const active = key === selectedPresetKey
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        void runSave({
                          kind: 'style',
                          payload: {
                            stylePositivePrompt: entry.positivePrompt,
                            styleNegativePrompt: entry.negativePrompt,
                            stylePresetKey: key,
                          },
                        })
                      }
                      disabled={mutationBusy}
                      aria-pressed={active}
                      className={`${CHOICE_BASE_CLASS} text-sm ${
                        active ? CHOICE_ACTIVE_CLASS : CHOICE_IDLE_CLASS
                      }`}
                    >
                      {isZh ? entry.zhLabel : entry.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--production-border)] pt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
          <span>
            {t('visualLibraryTitle')}
            {selectedVisualStyleLabel ? (
              <span className="ml-2 text-[var(--process-cyan-strong)]">
                {t('selectedStyle', { name: selectedVisualStyleLabel })}
              </span>
            ) : null}
          </span>
          {selectedVisualStyleId ? (
            <button
              type="button"
              onClick={() =>
                void runSave({ kind: 'style', payload: { visualStyleId: null } })
              }
              disabled={mutationBusy}
              className={`${CHOICE_BASE_CLASS} text-[11px] ${CHOICE_IDLE_CLASS}`}
            >
              {t('clear')}
            </button>
          ) : null}
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-[var(--production-ink-muted)]">
          {t('visualLibraryDescription')}
        </p>
        <div className="space-y-3">
          {libraryGroups.map((group) => (
            <div key={group.category}>
              <div className="mb-1.5 font-mono text-[12px] uppercase tracking-wider text-[var(--production-ink-muted)]">
                {group.category} · {t(`libraryCategories.${group.category}`)}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.styles.map((style) => {
                  const active = style.id === selectedVisualStyleId
                  const styleName = isZh ? style.nameZh : style.nameEn
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() =>
                        void runSave({
                          kind: 'style',
                          payload: { visualStyleId: style.id },
                        })
                      }
                      disabled={mutationBusy}
                      title={style.styleAnchor}
                      aria-pressed={active}
                      className={`group flex min-h-11 w-[96px] flex-col overflow-hidden rounded-[10px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:opacity-50 ${
                        active ? TILE_ACTIVE_CLASS : TILE_IDLE_CLASS
                      }`}
                    >
                      {style.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={style.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-[70px] w-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-[70px] w-full items-center justify-center bg-[var(--production-paper)] font-mono text-[20px] tracking-wider text-[var(--production-ink-muted)]">
                          {style.category}
                        </div>
                      )}
                      <span
                        className={`truncate px-1.5 py-1 text-center text-xs ${
                          active
                            ? 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                            : 'bg-[var(--production-muted)] text-[var(--production-ink-muted)]'
                        }`}
                      >
                        {styleName}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[12px] uppercase tracking-wider text-[var(--production-ink-muted)]">
            <span>{t('lightingTitle')}</span>
            {selectedLightingPresetId ? (
              <button
                type="button"
                onClick={() =>
                  void runSave({
                    kind: 'style',
                    payload: { lightingPresetId: null },
                  })
                }
                disabled={mutationBusy}
                className={`${CHOICE_BASE_CLASS} text-[11px] ${CHOICE_IDLE_CLASS}`}
              >
                {t('clear')}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {sortedLightings.map((lighting) => {
              const active = lighting.id === selectedLightingPresetId
              const lightingName = isZh ? lighting.nameZh : lighting.nameEn
              return (
                <button
                  key={lighting.id}
                  type="button"
                  onClick={() =>
                    void runSave({
                      kind: 'style',
                      payload: { lightingPresetId: lighting.id },
                    })
                  }
                  disabled={mutationBusy}
                  title={lighting.lightingOverride}
                  aria-pressed={active}
                  className={`group flex min-h-11 w-[96px] flex-col overflow-hidden rounded-[10px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:opacity-50 ${
                    active ? TILE_ACTIVE_CLASS : TILE_IDLE_CLASS
                  }`}
                >
                  {lighting.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={lighting.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-[70px] w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-[70px] w-full items-center justify-center bg-[var(--production-paper)]">
                      <AppIcon
                        name="sparklesAlt"
                        className="h-4 w-4 text-[var(--production-ink-muted)]"
                      />
                    </div>
                  )}
                  <span
                    className={`truncate px-1.5 py-1 text-center text-xs ${
                      active
                        ? 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                        : 'bg-[var(--production-muted)] text-[var(--production-ink-muted)]'
                    }`}
                  >
                    {lightingName}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

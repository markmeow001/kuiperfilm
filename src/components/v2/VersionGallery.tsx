'use client'

import type { ReactNode } from 'react'

export type VersionGalleryAppearance = 'production' | 'editor'

export interface VersionGalleryVersion {
  id: string
  name: ReactNode
  meta?: ReactNode
  locked?: boolean
  approved?: boolean
  stale?: boolean
}

export interface VersionPreviewState {
  selected: boolean
  locked: boolean
  approved: boolean
  stale: boolean
}

export interface VersionGalleryProps<TVersion extends VersionGalleryVersion> {
  versions: readonly TVersion[]
  selectedId?: string | null
  onSelect?: (version: TVersion) => void
  renderPreview: (version: TVersion, state: VersionPreviewState) => ReactNode
  renderActions?: (version: TVersion, state: VersionPreviewState) => ReactNode
  appearance?: VersionGalleryAppearance
  ariaLabel?: string
  emptyState?: ReactNode
  className?: string
  previewClassName?: string
  locale?: string
  labels?: Partial<VersionGalleryLabels>
}

export interface VersionGalleryLabels {
  ariaLabel: string
  emptyTitle: string
  emptyDescription: string
  selected: string
  approved: string
  locked: string
  stale: string
  current: string
  select: string
  available: string
}

const ZH_LABELS: VersionGalleryLabels = {
  ariaLabel: '版本列表',
  emptyTitle: '尚無版本',
  emptyDescription: '產生或上傳第一個版本後，會顯示在這裡。',
  selected: '已選取',
  approved: '已核准',
  locked: '已鎖定',
  stale: '需更新',
  current: '目前版本',
  select: '選擇版本',
  available: '可供檢視',
}

const EN_LABELS: VersionGalleryLabels = {
  ariaLabel: 'Version list',
  emptyTitle: 'No versions yet',
  emptyDescription: 'Generated or uploaded versions will appear here.',
  selected: 'Selected',
  approved: 'Approved',
  locked: 'Locked',
  stale: 'Update needed',
  current: 'Current version',
  select: 'Select version',
  available: 'Available to preview',
}

interface VersionStateLabelProps {
  children: ReactNode
  tone: 'selected' | 'locked' | 'approved' | 'stale'
  appearance: VersionGalleryAppearance
}

const productionStateClasses: Record<VersionStateLabelProps['tone'], string> = {
  selected: 'border-[var(--production-blue)]/45 bg-[var(--production-blue-soft)] text-blue-200',
  locked: 'border-[var(--production-gold)]/45 bg-[var(--production-gold)]/10 text-[var(--editorial-400)]',
  approved: 'border-[var(--production-gold)]/65 bg-[var(--production-gold)]/12 text-[var(--editorial-400)]',
  stale: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
}

const editorStateClasses: Record<VersionStateLabelProps['tone'], string> = {
  selected:
    'border-[var(--primary-500)]/35 bg-[var(--primary-900)]/55 text-[var(--primary-300)]',
  locked: 'border-[var(--editorial-500)]/30 bg-[var(--editorial-500)]/8 text-[var(--editorial-400)]',
  approved: 'border-[var(--editorial-500)]/55 bg-[var(--editorial-500)]/12 text-[var(--editorial-400)]',
  stale: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
}

function VersionStateLabel({
  children,
  tone,
  appearance,
}: VersionStateLabelProps) {
  const classes =
    appearance === 'production'
      ? productionStateClasses[tone]
      : editorStateClasses[tone]

  return (
    <span
      className={[
        'inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-semibold leading-4',
        classes,
      ].join(' ')}
    >
      {children}
    </span>
  )
}

export function VersionGallery<TVersion extends VersionGalleryVersion>({
  versions,
  selectedId,
  onSelect,
  renderPreview,
  renderActions,
  appearance = 'production',
  ariaLabel,
  emptyState,
  className,
  previewClassName,
  locale = 'zh',
  labels: labelOverrides,
}: VersionGalleryProps<TVersion>) {
  const labels = {
    ...(locale.toLowerCase().startsWith('en') ? EN_LABELS : ZH_LABELS),
    ...labelOverrides,
  }
  const resolvedAriaLabel = ariaLabel ?? labels.ariaLabel
  const isProduction = appearance === 'production'
  const surfaceClasses = isProduction
    ? 'border-[var(--production-border)] bg-[var(--production-surface)] text-[var(--production-ink)]'
    : 'border-[var(--border-soft)] bg-[var(--surface-raised)] text-[var(--text-primary)]'
  const selectedClasses = isProduction
    ? 'border-[var(--production-blue)] ring-2 ring-[var(--production-blue)]/15'
    : 'border-[var(--primary-500)] ring-2 ring-[var(--primary-500)]/15'
  const mutedTextClasses = isProduction
    ? 'text-[var(--production-ink-muted)]'
    : 'text-[var(--text-secondary)]'
  const previewSurfaceClasses = isProduction
    ? 'bg-[var(--production-muted)]'
    : 'bg-[var(--surface-inset)]'
  const dividerClasses = isProduction
    ? 'border-[var(--production-border)]'
    : 'border-[var(--border-soft)]'
  const selectButtonClasses = isProduction
    ? 'border-[var(--production-border)] bg-[var(--production-surface)] hover:border-[var(--production-blue)] hover:bg-[var(--production-blue-soft)] focus-visible:ring-[var(--production-focus)]'
    : 'border-[var(--border-soft)] bg-[var(--surface-overlay)] hover:border-[var(--primary-500)] hover:text-[var(--text-primary)] focus-visible:ring-[var(--primary-500)]'

  if (versions.length === 0) {
    return (
      <section aria-label={resolvedAriaLabel} className={className}>
        {emptyState ?? (
          <div
            className={[
              'rounded-[14px] border border-dashed p-8 text-center',
              surfaceClasses,
            ].join(' ')}
          >
            <h3 className="text-[16px] font-semibold leading-6">
              {labels.emptyTitle}
            </h3>
            <p
              className={['mt-1 text-[13px] leading-5', mutedTextClasses].join(
                ' ',
              )}
            >
              {labels.emptyDescription}
            </p>
          </div>
        )}
      </section>
    )
  }

  return (
    <section aria-label={resolvedAriaLabel} className={className}>
      <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {versions.map((version) => {
          const state: VersionPreviewState = {
            selected: selectedId === version.id,
            locked: Boolean(version.locked),
            approved: Boolean(version.approved),
            stale: Boolean(version.stale),
          }

          return (
            <li key={version.id}>
              <article
                aria-current={state.selected ? 'true' : undefined}
                className={[
                  'h-full overflow-hidden rounded-[14px] border transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none',
                  surfaceClasses,
                  state.selected ? selectedClasses : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div
                  className={[
                    'relative aspect-video overflow-hidden',
                    previewSurfaceClasses,
                    previewClassName,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {renderPreview(version, state)}
                  <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
                    {state.selected ? (
                      <VersionStateLabel
                        tone="selected"
                        appearance={appearance}
                      >
                        {labels.selected}
                      </VersionStateLabel>
                    ) : null}
                    {state.approved ? (
                      <VersionStateLabel
                        tone="approved"
                        appearance={appearance}
                      >
                        {labels.approved}
                      </VersionStateLabel>
                    ) : null}
                    {state.locked ? (
                      <VersionStateLabel tone="locked" appearance={appearance}>
                        {labels.locked}
                      </VersionStateLabel>
                    ) : null}
                    {state.stale ? (
                      <VersionStateLabel tone="stale" appearance={appearance}>
                        {labels.stale}
                      </VersionStateLabel>
                    ) : null}
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-semibold leading-5">
                      {version.name}
                    </h3>
                    {version.meta ? (
                      <div
                        className={[
                          'mt-1 text-[12px] leading-5',
                          mutedTextClasses,
                        ].join(' ')}
                      >
                        {version.meta}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={[
                      'mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3',
                      dividerClasses,
                    ].join(' ')}
                  >
                    {onSelect ? (
                      <button
                        type="button"
                        aria-pressed={state.selected}
                        onClick={() => onSelect(version)}
                        className={[
                          'inline-flex min-h-11 items-center justify-center rounded-[10px] border px-3 text-[13px] font-semibold',
                          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none',
                          isProduction
                            ? 'focus-visible:ring-offset-white'
                            : 'focus-visible:ring-offset-[var(--surface-raised)]',
                          selectButtonClasses,
                        ].join(' ')}
                      >
                        {state.selected ? labels.current : labels.select}
                      </button>
                    ) : (
                      <span
                        className={[
                          'text-[12px] leading-5',
                          mutedTextClasses,
                        ].join(' ')}
                      >
                        {state.selected ? labels.current : labels.available}
                      </span>
                    )}

                    {renderActions ? (
                      <div className="flex flex-wrap items-center gap-2 [&_a]:min-h-11 [&_button]:min-h-11">
                        {renderActions(version, state)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

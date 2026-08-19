'use client'

/**
 * Phase 1 step 2 — SubjectGrid + its private UploadButton, hoisted out of
 * V2SubjectsClient.tsx. Pure prop-driven leaf components: every value and
 * callback arrives through props (SubjectItem), no parent state / closures,
 * so the relocation is fully tsc-verified with zero behaviour change.
 */

import { useRef, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { ArkAssetRegisterChip } from './ArkAssetRegisterChip'
import type { SubjectItem } from './subjects-client-helpers'

export function SubjectGrid({
  items,
  emptyHint,
  emptyAction,
  aspect = 'portrait',
  layout = 'grid',
}: {
  items: SubjectItem[]
  emptyHint: string
  /** Optional action node rendered below the emptyHint when items is
   *  empty. Used to surface the page-level "Analyze" CTA directly in
   *  the empty card so users don't have to find a button elsewhere. */
  emptyAction?: ReactNode
  // Characters are 3:4 portrait (full-body triple-view). Scenes are 16:9
  // wide (Approach A widescreen). Forcing portrait on a wide source
  // center-crops it into a vertical strip and hides the left/right
  // composition we explicitly told the model to draw.
  aspect?: 'portrait' | 'wide'
  /** Workstation detail renders one selected entity without stretching it edge-to-edge. */
  layout?: 'grid' | 'detail'
}) {
  const t = useTranslations('v2Subjects.card')
  const aspectClass = aspect === 'wide' ? 'aspect-video' : 'aspect-[3/4]'
  const gridClass = layout === 'detail'
    ? 'grid max-w-[760px] grid-cols-1 gap-5'
    : aspect === 'wide'
      ? 'grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3'
      : 'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
  if (items.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-6 rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)] p-8 text-center sm:p-12">
        <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--production-tool-soft)] text-[var(--production-tool)]">
          <AppIcon name="image" className="h-6 w-6" />
        </div>
        <p className="max-w-xl text-base text-[var(--production-ink-muted)]">{emptyHint}</p>
        {emptyAction}
      </div>
    )
  }

  return (
    <div className={gridClass}>
      {items.map((item, i) => {
        const showGenerateCta = !item.imageUrl && !item.isRegenerating && !item.isUploading && Boolean(item.onRegenerate)
        const hasMediaAction = Boolean((item.imageUrl && item.onZoom) || showGenerateCta)
        const handleMediaAction = () => {
          if (item.imageUrl && item.onZoom) {
            item.onZoom(item.imageUrl)
            return
          }
          if (showGenerateCta) item.onRegenerate?.()
        }
        const mediaContent = (
          <>
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <AppIcon name="image" className="h-8 w-8 text-[var(--production-ink-muted)]" />
              </span>
            )}
            <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
            <span className="absolute left-3 top-3 rounded-[6px] border border-white/20 bg-black/45 px-2 py-1 font-mono text-xs tracking-[0.16em] text-white/85 backdrop-blur-md">
              {String(i + 1).padStart(3, '0')}
            </span>
            <span className="absolute bottom-3 left-3 right-3">
              <span className="text-sm font-semibold text-white">{item.caption}</span>
            </span>
            {item.isRegenerating ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
                <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-white motion-reduce:animate-none" />
                <span className="font-mono text-[14px] tracking-wider text-white">{t('generating')}</span>
                <span className="px-4 text-center text-[14px] text-white/75">
                  {t('generatingHint')}
                </span>
              </span>
            ) : item.isUploading ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
                <AppIcon name="cloudUpload" className="h-6 w-6 animate-pulse text-white motion-reduce:animate-none" />
                <span className="font-mono text-[14px] tracking-wider text-white">{t('uploading')}</span>
              </span>
            ) : showGenerateCta ? (
              <span className="absolute inset-0 flex min-h-11 flex-col items-center justify-center gap-2 bg-black/35 backdrop-blur-[1px] motion-safe:transition-colors group-hover:bg-[color-mix(in_srgb,var(--production-tool)_45%,transparent)]">
                <AppIcon name="sparklesAlt" className="h-7 w-7 text-white" />
                <span className="text-base font-semibold text-white">{t('generateOne')}</span>
                <span className="font-mono text-[11px] tracking-wider text-white/75">{t('generateOneSub')}</span>
              </span>
            ) : null}
          </>
        )
        return (
        <div
          key={item.id}
          className="group overflow-hidden rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)] text-[var(--production-ink)] shadow-[0_1px_2px_rgba(31,35,31,0.04)]"
        >
          {hasMediaAction ? (
            <button
              type="button"
              onClick={handleMediaAction}
              aria-label={item.imageUrl ? `圖片預覽：${item.name}` : t('generateOneTitle')}
              className={`group relative block w-full ${aspectClass} overflow-hidden bg-[var(--production-muted)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--production-focus)] ${
                item.imageUrl && item.onZoom ? 'cursor-zoom-in' : ''
              }`}
            >
              {mediaContent}
            </button>
          ) : (
            <div className={`relative ${aspectClass} overflow-hidden bg-[var(--production-muted)]`}>
              {mediaContent}
            </div>
          )}
          <div className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={item.onOpenEditor}
                disabled={!item.onOpenEditor}
                title={item.onOpenEditor ? t('editOpenTitle') : undefined}
                className="min-h-11 min-w-0 truncate text-left text-base font-semibold text-[var(--production-ink)] motion-safe:transition-colors enabled:hover:text-[var(--production-tool)] disabled:cursor-default"
              >
                {item.name}
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {item.onOpenEditor ? (
                  <button
                    type="button"
                    onClick={item.onOpenEditor}
                  className="flex min-h-11 flex-shrink-0 items-center gap-1 text-sm text-[var(--production-ink-muted)] motion-safe:transition-colors hover:text-[var(--production-tool)]"
                    title={t('editButtonTitle')}
                  >
                    <AppIcon name="edit" className="h-4 w-4" />
                    {t('editButton')}
                  </button>
                ) : null}
                {item.onEditDescription && !item.isEditingDescription ? (
                  <button
                    type="button"
                    onClick={item.onEditDescription}
                    className="flex min-h-11 flex-shrink-0 items-center gap-1 text-sm text-[var(--production-ink-muted)] motion-safe:transition-colors hover:text-[var(--production-tool)]"
                    title={t('appearanceEditTitle')}
                  >
                    {t('appearanceEdit')}
                  </button>
                ) : null}
                {item.onRedescribe && !item.isEditingDescription ? (
                  <button
                    type="button"
                    onClick={item.onRedescribe}
                    disabled={item.isRedescribing}
                    className="flex min-h-11 flex-shrink-0 items-center gap-1 text-sm text-[var(--production-ink-muted)] motion-safe:transition-colors hover:text-[var(--production-tool)] disabled:cursor-not-allowed disabled:opacity-50"
                    title={t('redescribeTitle')}
                  >
                    {item.isRedescribing ? t('redescribing') : t('redescribe')}
                  </button>
                ) : null}
              </div>
            </div>
            {item.description ? (
              <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--production-ink-muted)]">
                {item.description}
              </div>
            ) : null}
            {item.appearanceStatus ? (
              <div
                role={item.appearanceStatus.tone === 'error' ? 'alert' : 'status'}
                className={`mt-3 rounded-[9px] border px-3 py-2 text-[13px] leading-relaxed ${
                  item.appearanceStatus.tone === 'error'
                    ? 'border-[var(--production-danger)]/35 bg-[var(--production-danger)]/10 text-[var(--production-danger)]'
                    : item.appearanceStatus.tone === 'warning'
                      ? 'border-[var(--production-gold)]/35 bg-[var(--production-gold)]/10 text-[var(--production-gold)]'
                      : 'border-[var(--production-border)] bg-[var(--production-tool-soft)] text-[var(--production-tool)]'
                }`}
              >
                {item.appearanceStatus.label}
              </div>
            ) : null}
            {item.isEditingDescription ? (
              <div className="mt-3 space-y-2 rounded-[10px] border border-[var(--production-border)] bg-[var(--production-paper)] p-3">
                <div className="flex items-center justify-between font-mono text-[12px] tracking-wider text-[var(--production-tool)]">
                  <span>{t('appearancePrompt')}</span>
                  <span className="text-[var(--production-ink-muted)]">{t('wordCount', { count: item.descriptionDraft?.length ?? 0 })}</span>
                </div>
                <textarea
                  value={item.descriptionDraft ?? ''}
                  onChange={(e) => item.onDescriptionDraftChange?.(e.target.value)}
                  rows={5}
                  className="min-h-32 w-full resize-none rounded-[10px] border border-[var(--production-border)] bg-[var(--production-surface)] p-3 text-sm text-[var(--production-ink)] outline-none focus:border-[var(--production-focus)] focus:ring-2 focus:ring-[var(--production-focus)]/20"
                  placeholder={t('appearancePlaceholder')}
                  disabled={item.isSavingDescription}
                />
                <div className="flex items-center justify-end gap-2 text-[14px]">
                  <button
                    type="button"
                    onClick={item.onDescriptionCancel}
                    disabled={item.isSavingDescription}
                    className="min-h-11 rounded-[10px] px-3 text-[var(--production-ink-muted)] motion-safe:transition-colors hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] disabled:opacity-50"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={item.onDescriptionSave}
                    disabled={item.isSavingDescription}
                    className="min-h-11 rounded-[10px] border border-[var(--production-blue)] bg-[var(--production-blue)] px-4 font-semibold text-white motion-safe:transition-colors hover:bg-[var(--production-blue-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {item.isSavingDescription ? t('saving') : t('savePrompt')}
                  </button>
                </div>
              </div>
            ) : item.visualPrompt ? (
              <div className="mt-2 rounded-[10px] border border-[var(--production-border)] bg-[var(--production-paper)] p-3">
                <div className="mb-1 font-mono text-[12px] tracking-wider text-[var(--production-ink-muted)]">
                  {t('appearancePromptStatic')}
                </div>
                <div className="line-clamp-3 text-[13px] leading-relaxed text-[var(--production-ink-muted)]">
                  {item.visualPrompt}
                </div>
              </div>
            ) : item.onEditDescription ? (
              <div className="mt-2 text-[13px] italic text-[var(--production-ink-muted)]">
                {t('appearanceEmpty')}
              </div>
            ) : null}
          </div>
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-t border-[var(--production-border)] px-4 py-3 text-sm">
            {item.onRegenerate ? (
              <button
                type="button"
                disabled={item.isRegenerating}
                onClick={item.onRegenerate}
                className="flex min-h-11 items-center gap-1 rounded-[9px] px-2 text-[var(--production-ink-muted)] motion-safe:transition-colors hover:bg-[var(--production-tool-soft)] hover:text-[var(--production-tool)] disabled:cursor-not-allowed disabled:opacity-50"
                title={item.imageUrl ? t('regenImageTitle') : t('genImageTitle')}
              >
                <AppIcon name="sparklesAlt" className="h-4 w-4" />
                {item.isRegenerating
                  ? t('generating2')
                  : item.imageUrl
                    ? t('regenerate')
                    : t('generate')}
              </button>
            ) : null}

            {item.onUpload ? (
              <UploadButton
                disabled={!!item.isUploading}
                onFile={item.onUpload}
                label={item.isUploading ? t('uploading') : t('uploadReplaceLabel')}
              />
            ) : null}

            {item.imageUrl ? (
              <a
                href={item.imageUrl}
                download={`${item.name}.png`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-1 rounded-[9px] px-2 text-[var(--production-ink-muted)] motion-safe:transition-colors hover:bg-[var(--production-tool-soft)] hover:text-[var(--production-tool)]"
                title={t('downloadTitle')}
              >
                <AppIcon name="cloudUpload" className="h-4 w-4 rotate-180" />
                {t('download')}
              </a>
            ) : null}

            <span className="ml-auto" />
            {/* 2026-05-23 Phase 3 — 火山 asset registration chip.
                Renders to the left of the lock action so it's the last
                thing the user sees scanning across the footer. Only
                surfaces when ark fields are wired up by the caller
                (character cards only, until scene/prop wiring lands). */}
            {item.arkTargetType && item.arkTargetId && item.onArkRegister && item.imageUrl ? (
              <ArkAssetRegisterChip
                targetType={item.arkTargetType}
                targetId={item.arkTargetId}
                imageUrl={item.imageUrl}
                arkAssetId={item.arkAssetId}
                arkAssetStatus={item.arkAssetStatus}
                arkAssetSourceUrl={item.arkAssetSourceUrl}
                arkAssetError={item.arkAssetError}
                onRegister={item.onArkRegister}
              />
            ) : null}
            {item.onLock ? (
              <button
                type="button"
                disabled={item.isLocking || item.isLocked}
                onClick={item.onLock}
                title={item.isLocked ? t('lockedTitle') : t('lockTitle')}
                className={`min-h-11 rounded-[9px] px-2 motion-safe:transition-colors disabled:cursor-not-allowed ${
                  item.isLocked ? 'text-[var(--production-gold)]' : 'text-[var(--production-ink-muted)] hover:bg-[var(--production-tool-soft)] hover:text-[var(--production-tool)]'
                } ${item.isLocking ? 'opacity-50' : ''}`}
              >
                {item.isLocking
                  ? t('locking')
                  : item.isLocked
                    ? t('locked')
                    : item.lockError
                      ? t('retryLock')
                      : t('lock')}
              </button>
            ) : null}
            {item.lockError ? (
              <div
                role="alert"
                className="basis-full rounded-[8px] border border-[var(--production-danger)]/35 bg-[var(--production-danger)]/10 px-3 py-2 text-[13px] text-[var(--production-danger)]"
              >
                <span className="font-semibold">{t('lockFailed')}</span>{' '}
                <span>{item.lockError}</span>
              </div>
            ) : null}
          </div>
        </div>
        )
      })}
    </div>
  )
}

function UploadButton({
  onFile,
  disabled,
  label,
}: {
  onFile: (file: File) => void
  disabled: boolean
  label: string
}) {
  const t = useTranslations('v2Subjects.card')
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          // Reset so re-uploading the same file fires onChange again.
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex min-h-11 items-center gap-1 rounded-[9px] px-2 text-[var(--production-ink-muted)] motion-safe:transition-colors hover:bg-[var(--production-tool-soft)] hover:text-[var(--production-tool)] disabled:cursor-not-allowed disabled:opacity-50"
        title={t('uploadReplaceTitle')}
      >
        <AppIcon name="cloudUpload" className="h-4 w-4" />
        {label}
      </button>
    </>
  )
}

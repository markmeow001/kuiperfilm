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
}) {
  const t = useTranslations('v2Subjects.card')
  const aspectClass = aspect === 'wide' ? 'aspect-video' : 'aspect-[3/4]'
  const gridClass = aspect === 'wide'
    ? 'grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3'
    : 'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
  if (items.length === 0) {
    return (
      <div className="kuiper-inspector flex min-h-72 flex-col items-center justify-center gap-6 p-8 text-center sm:p-12">
        <div className="flex h-12 w-12 items-center justify-center rounded-card bg-overlay text-text-tertiary">
          <AppIcon name="image" className="h-6 w-6" />
        </div>
        <p className="max-w-xl text-base text-text-secondary">{emptyHint}</p>
        {emptyAction}
      </div>
    )
  }

  return (
    <div className={gridClass}>
      {items.map((item, i) => {
        const showGenerateCta = !item.imageUrl && !item.isRegenerating && !item.isUploading && Boolean(item.onRegenerate)
        return (
        <div
          key={item.id}
          className="kuiper-surface-card group"
        >
          <div
            className={`relative ${aspectClass} overflow-hidden bg-gradient-to-br from-overlay to-raised ${
              item.imageUrl && item.onZoom ? 'cursor-zoom-in' : ''
            }`}
            onClick={() => {
              if (item.imageUrl && item.onZoom) item.onZoom(item.imageUrl)
            }}
          >
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <AppIcon name="image" className="h-8 w-8 text-text-tertiary" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-canvas/95 via-canvas/30 to-transparent" />
            <div className="absolute left-3 top-3 rounded-chip border border-white/10 bg-canvas/55 px-2 py-1 font-mono text-xs tracking-[0.16em] text-text-secondary backdrop-blur-md">
              {String(i + 1).padStart(3, '0')}
            </div>
            <div className="absolute bottom-3 left-3 right-3">
              <div className="text-sm font-medium text-primary-300">{item.caption}</div>
            </div>
            {item.isRegenerating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/70 backdrop-blur-sm">
                <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-primary-400" />
                <div className="font-mono text-[14px] tracking-wider text-primary-300">{t('generating')}</div>
                <div className="px-4 text-center font-serif-cn text-[14px] text-text-secondary">
                  {t('generatingHint')}
                </div>
              </div>
            ) : item.isUploading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/70 backdrop-blur-sm">
                <AppIcon name="cloudUpload" className="h-6 w-6 animate-pulse text-primary-400" />
                <div className="font-mono text-[14px] tracking-wider text-primary-300">{t('uploading')}</div>
              </div>
            ) : showGenerateCta ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  item.onRegenerate?.()
                }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/40 backdrop-blur-[1px] transition-all hover:bg-primary-500/15"
                title={t('generateOneTitle')}
              >
                <AppIcon name="sparklesAlt" className="h-7 w-7 text-primary-400/80" />
                <div className="font-serif-cn text-base text-primary-300">{t('generateOne')}</div>
                <div className="font-mono text-[11px] tracking-wider text-text-secondary">{t('generateOneSub')}</div>
              </button>
            ) : null}
          </div>
          <div className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={item.onOpenEditor}
                disabled={!item.onOpenEditor}
                title={item.onOpenEditor ? t('editOpenTitle') : undefined}
                className="min-w-0 truncate text-left text-base font-semibold text-text-primary transition-colors enabled:hover:text-primary-300 disabled:cursor-default"
              >
                {item.name}
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {item.onOpenEditor ? (
                  <button
                    type="button"
                    onClick={item.onOpenEditor}
                    className="flex flex-shrink-0 items-center gap-1 text-sm text-text-tertiary transition-colors hover:text-primary-400"
                    title={t('editButtonTitle')}
                  >
                    <AppIcon name="edit" className="h-3 w-3" />
                    {t('editButton')}
                  </button>
                ) : null}
                {item.onEditDescription && !item.isEditingDescription ? (
                  <button
                    type="button"
                    onClick={item.onEditDescription}
                    className="flex flex-shrink-0 items-center gap-1 text-sm text-text-tertiary transition-colors hover:text-primary-400"
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
                    className="flex flex-shrink-0 items-center gap-1 text-sm text-text-tertiary transition-colors hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
                    title={t('redescribeTitle')}
                  >
                    {item.isRedescribing ? t('redescribing') : t('redescribe')}
                  </button>
                ) : null}
              </div>
            </div>
            {item.description ? (
              <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-text-secondary">
                {item.description}
              </div>
            ) : null}
            {item.isEditingDescription ? (
              <div className="mt-3 space-y-2 rounded-sm border border-primary-500/30 bg-canvas/40 p-2">
                <div className="flex items-center justify-between font-mono text-[12px] tracking-wider text-primary-500/70">
                  <span>{t('appearancePrompt')}</span>
                  <span className="text-text-tertiary">{t('wordCount', { count: item.descriptionDraft?.length ?? 0 })}</span>
                </div>
                <textarea
                  value={item.descriptionDraft ?? ''}
                  onChange={(e) => item.onDescriptionDraftChange?.(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-sm border border-primary-500/40 bg-raised/80 p-2 font-body text-xs text-text-primary outline-none focus:border-primary-500"
                  placeholder={t('appearancePlaceholder')}
                  disabled={item.isSavingDescription}
                />
                <div className="flex items-center justify-end gap-2 font-mono text-[14px] tracking-wider">
                  <button
                    type="button"
                    onClick={item.onDescriptionCancel}
                    disabled={item.isSavingDescription}
                    className="text-text-tertiary transition-colors hover:text-text-secondary disabled:opacity-50"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={item.onDescriptionSave}
                    disabled={item.isSavingDescription}
                    className="rounded-sm border border-primary-500/40 bg-primary-500/10 px-3 py-1 text-primary-300 transition-all hover:border-primary-500 hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {item.isSavingDescription ? t('saving') : t('savePrompt')}
                  </button>
                </div>
              </div>
            ) : item.visualPrompt ? (
              <div className="mt-2 rounded-sm border border-border-soft/40 bg-canvas/30 p-2">
                <div className="mb-1 font-mono text-[12px] tracking-wider text-text-tertiary">
                  {t('appearancePromptStatic')}
                </div>
                <div className="line-clamp-3 font-body text-[11px] leading-relaxed text-text-secondary">
                  {item.visualPrompt}
                </div>
              </div>
            ) : item.onEditDescription ? (
              <div className="mt-2 font-body text-[11px] italic text-text-tertiary">
                {t('appearanceEmpty')}
              </div>
            ) : null}
          </div>
          <div className="flex min-h-12 flex-wrap items-center gap-3 border-t border-border-soft px-4 py-3 text-sm">
            {item.onRegenerate ? (
              <button
                type="button"
                disabled={item.isRegenerating}
                onClick={item.onRegenerate}
                className="flex items-center gap-1 text-text-secondary transition-all hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
                title={item.imageUrl ? t('regenImageTitle') : t('genImageTitle')}
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
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
                className="flex items-center gap-1 text-text-secondary transition-all hover:text-primary-400"
                title={t('downloadTitle')}
              >
                <AppIcon name="cloudUpload" className="h-3 w-3 rotate-180" />
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
                className={`transition-all disabled:cursor-not-allowed ${
                  item.isLocked ? 'text-primary-400' : 'text-text-secondary hover:text-primary-400'
                } ${item.isLocking ? 'opacity-50' : ''}`}
              >
                {item.isLocking ? t('locking') : item.isLocked ? t('locked') : t('lock')}
              </button>
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
        className="flex items-center gap-1 text-text-secondary transition-all hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
        title={t('uploadReplaceTitle')}
      >
        <AppIcon name="cloudUpload" className="h-3 w-3" />
        {label}
      </button>
    </>
  )
}

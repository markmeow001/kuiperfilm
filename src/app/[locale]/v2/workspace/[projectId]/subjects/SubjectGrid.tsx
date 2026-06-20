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
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-6 rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
        <p className="font-fraunces text-base italic text-stone-400">{emptyHint}</p>
        {emptyAction}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item, i) => {
        const showGenerateCta = !item.imageUrl && !item.isRegenerating && !item.isUploading && Boolean(item.onRegenerate)
        return (
        <div
          key={item.id}
          className="group overflow-hidden rounded-sm border border-stone-800/50 bg-stone-900/30 transition-all hover:border-amber-500/40"
        >
          <div
            className={`relative ${aspectClass} overflow-hidden bg-gradient-to-br from-stone-800 to-stone-900 ${
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
                <AppIcon name="image" className="h-8 w-8 text-stone-600" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-stone-950/95 via-stone-950/30 to-transparent" />
            <div className="absolute left-3 top-3 rounded-sm bg-stone-950/40 px-2 py-1 font-mono text-[12px] tracking-[0.2em] text-stone-300/80 backdrop-blur-sm">
              {String(i + 1).padStart(3, '0')}
            </div>
            <div className="absolute bottom-3 left-3 right-3">
              <div className="font-fraunces text-[11px] italic text-amber-300/90">{item.caption}</div>
            </div>
            {item.isRegenerating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/70 backdrop-blur-sm">
                <AppIcon name="sparklesAlt" className="h-6 w-6 animate-pulse text-amber-400" />
                <div className="font-mono text-[14px] tracking-wider text-amber-300">{t('generating')}</div>
                <div className="px-4 text-center font-serif-cn text-[14px] text-stone-400">
                  {t('generatingHint')}
                </div>
              </div>
            ) : item.isUploading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/70 backdrop-blur-sm">
                <AppIcon name="cloudUpload" className="h-6 w-6 animate-pulse text-amber-400" />
                <div className="font-mono text-[14px] tracking-wider text-amber-300">{t('uploading')}</div>
              </div>
            ) : showGenerateCta ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  item.onRegenerate?.()
                }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-950/40 backdrop-blur-[1px] transition-all hover:bg-amber-500/15"
                title={t('generateOneTitle')}
              >
                <AppIcon name="sparklesAlt" className="h-7 w-7 text-amber-400/80" />
                <div className="font-serif-cn text-base text-amber-300">{t('generateOne')}</div>
                <div className="font-mono text-[11px] tracking-wider text-stone-400">{t('generateOneSub')}</div>
              </button>
            ) : null}
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={item.onOpenEditor}
                disabled={!item.onOpenEditor}
                title={item.onOpenEditor ? t('editOpenTitle') : undefined}
                className="truncate text-left font-serif-cn text-base text-stone-100 transition-colors enabled:hover:text-amber-300 disabled:cursor-default"
              >
                {item.name}
              </button>
              <div className="flex items-center gap-2">
                {item.onOpenEditor ? (
                  <button
                    type="button"
                    onClick={item.onOpenEditor}
                    className="flex flex-shrink-0 items-center gap-1 font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
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
                    className="flex flex-shrink-0 items-center gap-1 font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
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
                    className="flex flex-shrink-0 items-center gap-1 font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                    title={t('redescribeTitle')}
                  >
                    {item.isRedescribing ? t('redescribing') : t('redescribe')}
                  </button>
                ) : null}
              </div>
            </div>
            {item.description ? (
              <div className="mt-1 line-clamp-2 font-body text-xs leading-relaxed text-stone-400">
                {item.description}
              </div>
            ) : null}
            {item.isEditingDescription ? (
              <div className="mt-3 space-y-2 rounded-sm border border-amber-500/30 bg-stone-950/40 p-2">
                <div className="flex items-center justify-between font-mono text-[12px] tracking-wider text-amber-500/70">
                  <span>{t('appearancePrompt')}</span>
                  <span className="text-stone-600">{t('wordCount', { count: item.descriptionDraft?.length ?? 0 })}</span>
                </div>
                <textarea
                  value={item.descriptionDraft ?? ''}
                  onChange={(e) => item.onDescriptionDraftChange?.(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-sm border border-amber-500/40 bg-stone-900/80 p-2 font-body text-xs text-stone-200 outline-none focus:border-amber-500"
                  placeholder={t('appearancePlaceholder')}
                  disabled={item.isSavingDescription}
                />
                <div className="flex items-center justify-end gap-2 font-mono text-[14px] tracking-wider">
                  <button
                    type="button"
                    onClick={item.onDescriptionCancel}
                    disabled={item.isSavingDescription}
                    className="text-stone-500 transition-colors hover:text-stone-300 disabled:opacity-50"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={item.onDescriptionSave}
                    disabled={item.isSavingDescription}
                    className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {item.isSavingDescription ? t('saving') : t('savePrompt')}
                  </button>
                </div>
              </div>
            ) : item.visualPrompt ? (
              <div className="mt-2 rounded-sm border border-stone-800/40 bg-stone-950/30 p-2">
                <div className="mb-1 font-mono text-[12px] tracking-wider text-stone-500">
                  {t('appearancePromptStatic')}
                </div>
                <div className="line-clamp-3 font-body text-[11px] leading-relaxed text-stone-400">
                  {item.visualPrompt}
                </div>
              </div>
            ) : item.onEditDescription ? (
              <div className="mt-2 font-body text-[11px] italic text-stone-600">
                {t('appearanceEmpty')}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-stone-800/50 px-4 pb-3 pt-2 font-mono text-[14px] tracking-wider">
            {item.onRegenerate ? (
              <button
                type="button"
                disabled={item.isRegenerating}
                onClick={item.onRegenerate}
                className="flex items-center gap-1 text-stone-300 transition-all hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="flex items-center gap-1 text-stone-300 transition-all hover:text-amber-400"
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
                  item.isLocked ? 'text-amber-400' : 'text-stone-400 hover:text-amber-400'
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
        className="flex items-center gap-1 text-stone-300 transition-all hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        title={t('uploadReplaceTitle')}
      >
        <AppIcon name="cloudUpload" className="h-3 w-3" />
        {label}
      </button>
    </>
  )
}

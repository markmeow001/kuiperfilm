'use client'

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AppIcon } from '@/components/ui/icons'
import { PageHeader } from '@/components/v2/PageHeader'
import { StatusPill } from '@/components/v2/StatusPill'
import {
  StickyNextStep,
  type NextStepRequirement,
} from '@/components/v2/StickyNextStep'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import styles from '../PlanningWorkspace.module.css'

export type ScreenplaySaveState =
  | 'empty'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'readonly'

interface ScreenplayWorkflowStep {
  id: string
  content: ReactNode
}

export interface ScreenplayWorkspaceCopy {
  headerEyebrow: string
  headerDescription: string
  modesLabel: string
  editorMode: string
  guideMode: string
  editorLabel: string
  editorHint: string
  emptyHint: string
  readOnlyTitle: string
  readOnlyDescription: string
  saveLabel: string
  savingLabel: string
  errorTitle: string
  errorDescription: string
  retrySaveLabel: string
  workflowEyebrow: string
  workflowTitle: string
  workflowSummary: string
  workflowSteps: readonly ScreenplayWorkflowStep[]
  workflowFooter: ReactNode
  nextEyebrow: string
  nextTitle: string
  nextDescription: string
  nextLabel: string
  prerequisitesLabel: string
  prerequisitesSummary: string
  metLabel: string
  unmetLabel: string
}

export interface ScreenplayWorkspaceProps {
  locale?: string
  episodeTitle: string
  episodeContext: string
  characterCountLabel: string
  statusLabel: string
  saveState: ScreenplaySaveState
  value: string
  placeholder: string
  canEdit: boolean
  viewerTip?: string
  saveDisabled: boolean
  errorMessage?: string | null
  backgroundRefreshMessage?: string
  bulkUpload: ReactNode
  nextReady: boolean
  nextDisabledReason?: string
  nextPrerequisites: readonly NextStepRequirement[]
  copy: ScreenplayWorkspaceCopy
  onValueChange: (value: string) => void
  onEditorBlur: () => void
  onSave: () => void
  onRetrySave: () => void
  onNext: () => void
}

type MobileMode = 'editor' | 'guide'

/** Dark studio screenplay workstation; all persistence remains in its caller. */
export function ScreenplayWorkspace({
  locale,
  episodeTitle,
  episodeContext,
  characterCountLabel,
  statusLabel,
  saveState,
  value,
  placeholder,
  canEdit,
  viewerTip,
  saveDisabled,
  errorMessage,
  backgroundRefreshMessage,
  bulkUpload,
  nextReady,
  nextDisabledReason,
  nextPrerequisites,
  copy,
  onValueChange,
  onEditorBlur,
  onSave,
  onRetrySave,
  onNext,
}: ScreenplayWorkspaceProps) {
  const editorId = useId()
  const editorTabId = useId()
  const guideTabId = useId()
  const editorPanelId = useId()
  const guidePanelId = useId()
  const editorTabRef = useRef<HTMLButtonElement>(null)
  const guideTabRef = useRef<HTMLButtonElement>(null)
  const [mobileMode, setMobileMode] = useState<MobileMode>('editor')
  const isEmpty = saveState === 'empty'
  const isSaving = saveState === 'saving'

  function moveMobileModeFocus(nextMode: MobileMode) {
    setMobileMode(nextMode)
    const nextRef = nextMode === 'editor' ? editorTabRef : guideTabRef
    nextRef.current?.focus()
  }

  function handleModeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      event.key === 'End'
    ) {
      event.preventDefault()
      moveMobileModeFocus('guide')
      return
    }
    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home'
    ) {
      event.preventDefault()
      moveMobileModeFocus('editor')
    }
  }

  return (
    <div className={`kuiper-screenplay ${styles.planningRoot}`}>
      <div
        className={`mx-auto w-full max-w-[1600px] px-[var(--workspace-gutter)] pb-10 pt-6 sm:pt-8 ${styles.boundPage}`}
      >
        <PageHeader
          eyebrow={copy.headerEyebrow}
          title={episodeTitle}
          description={copy.headerDescription}
          context={episodeContext}
          actions={bulkUpload}
        />

        {backgroundRefreshMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-5 rounded-[12px] border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-[13px] leading-5 text-amber-100"
          >
            {backgroundRefreshMessage}
          </div>
        ) : null}

        <div
          className="mt-6 grid grid-cols-2 gap-1 rounded-[12px] border border-[var(--production-border)] bg-[var(--production-muted)] p-1 xl:hidden"
          role="tablist"
          aria-label={copy.modesLabel}
        >
          <ModeButton
            buttonRef={editorTabRef}
            id={editorTabId}
            controls={editorPanelId}
            active={mobileMode === 'editor'}
            icon="edit"
            label={copy.editorMode}
            onClick={() => setMobileMode('editor')}
            onKeyDown={handleModeKeyDown}
          />
          <ModeButton
            buttonRef={guideTabRef}
            id={guideTabId}
            controls={guidePanelId}
            active={mobileMode === 'guide'}
            icon="clipboardCheck"
            label={copy.guideMode}
            onClick={() => setMobileMode('guide')}
            onKeyDown={handleModeKeyDown}
          />
        </div>

        <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section
            id={editorPanelId}
            role="tabpanel"
            aria-labelledby={editorTabId}
            tabIndex={0}
            aria-label={copy.editorMode}
            className={`${mobileMode === 'editor' ? 'min-w-0' : 'hidden min-w-0 xl:block'} rounded-[16px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]`}
          >
            <div
              className={`overflow-hidden rounded-[16px] border border-[var(--production-border)] bg-[var(--production-surface)] ${styles.paperCard}`}
            >
              <div className="flex flex-col gap-3 border-b border-[var(--production-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <label
                    htmlFor={editorId}
                    className="text-[14px] font-semibold text-[var(--production-ink)]"
                  >
                    {copy.editorLabel}
                  </label>
                  <p className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
                    {copy.editorHint}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={statusLabel}
                    tone={saveStateTone(saveState)}
                  />
                  <span className="font-mono text-[12px] text-[var(--production-ink-muted)]">
                    {characterCountLabel}
                  </span>
                </div>
              </div>

              {!canEdit ? (
                <div className="border-b border-[var(--production-border)] bg-[var(--production-tool-soft)] px-4 py-4 sm:px-6">
                  <div className="flex items-start gap-3">
                    <AppIcon
                      aria-hidden="true"
                      name="lock"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--production-tool)]"
                    />
                    <div>
                      <p className="text-[14px] font-semibold text-[var(--production-ink)]">
                        {copy.readOnlyTitle}
                      </p>
                      <p className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
                        {copy.readOnlyDescription}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {isEmpty ? (
                <div className="border-b border-[var(--production-border)] bg-[var(--production-muted)] px-4 py-3 text-[13px] leading-5 text-[var(--production-ink-muted)] sm:px-6">
                  <AppIcon
                    aria-hidden="true"
                    name="fileText"
                    className="mr-2 inline h-4 w-4 text-[var(--production-tool)]"
                  />
                  {copy.emptyHint}
                </div>
              ) : null}

              <div
                className={`${styles.screenplayDesk} px-2 py-2 sm:px-5 sm:py-5`}
              >
                <textarea
                  id={editorId}
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey)
                      && event.key.toLowerCase() === 's'
                    ) {
                      event.preventDefault()
                      if (canEdit && !saveDisabled) onSave()
                    }
                  }}
                  onBlur={onEditorBlur}
                  readOnly={!canEdit}
                  title={viewerTip}
                  placeholder={placeholder}
                  aria-invalid={errorMessage ? true : undefined}
                  className={`min-h-[58vh] w-full resize-y rounded-[8px] border border-[var(--production-border)] px-5 py-6 font-serif-cn text-[16px] leading-[1.9] text-[var(--production-ink)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--production-ink-muted)] focus:border-[var(--production-focus)] focus:shadow-[0_0_0_3px_rgba(85,175,192,0.18)] motion-reduce:transition-none sm:min-h-[620px] sm:px-10 sm:py-9 sm:text-[17px] ${styles.screenplayPage}`}
                />
              </div>

              {errorMessage ? (
                <div className="border-t border-[var(--production-border)] p-4 sm:p-5">
                  <UiStatePanel
                    state="error"
                    locale={locale}
                    compact
                    title={copy.errorTitle}
                    description={copy.errorDescription}
                    details={errorMessage}
                    primaryAction={(
                      <button
                        type="button"
                        onClick={onRetrySave}
                        disabled={!canEdit}
                        className="kuiper-dashboard-primary min-h-11 px-4 text-[14px] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {copy.retrySaveLabel}
                      </button>
                    )}
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-[var(--production-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="text-[13px] leading-5 text-[var(--production-ink-muted)]"
                >
                  {statusLabel}
                </p>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saveDisabled}
                  title={viewerTip}
                  className="kuiper-dashboard-primary inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-[14px] disabled:cursor-not-allowed disabled:border-[var(--production-border)] disabled:bg-[var(--production-muted)] disabled:text-[var(--production-ink-muted)] motion-reduce:transition-none sm:w-auto"
                >
                  <AppIcon
                    aria-hidden="true"
                    name="check"
                    className="h-4 w-4"
                  />
                  {isSaving ? copy.savingLabel : copy.saveLabel}
                </button>
              </div>
            </div>
          </section>

          <aside
            id={guidePanelId}
            role="tabpanel"
            aria-labelledby={guideTabId}
            tabIndex={0}
            aria-label={copy.guideMode}
            className={`${mobileMode === 'guide' ? 'min-w-0' : 'hidden min-w-0 xl:block'} rounded-[16px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]`}
          >
            <div
              className={`space-y-5 rounded-[16px] border border-[var(--production-border)] bg-[var(--production-surface)] p-5 xl:sticky xl:top-28 ${styles.guideCard}`}
            >
              <div>
                <p className="kuiper-dashboard-kicker">{copy.workflowEyebrow}</p>
                <h2 className="kuiper-dashboard-heading mt-2 text-[20px] leading-7">
                  {copy.workflowTitle}
                </h2>
                <p className="mt-2 text-[13px] leading-5 text-[var(--production-ink-muted)]">
                  {copy.workflowSummary}
                </p>
              </div>

              <ol className="space-y-4">
                {copy.workflowSteps.map((step, index) => (
                  <li
                    key={step.id}
                    className="flex gap-3 text-[14px] leading-6 text-[var(--production-ink-muted)]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--production-border)] bg-[var(--production-raised)] font-mono text-[11px] font-semibold text-[var(--production-tool)]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 pt-0.5 [&_strong]:font-semibold [&_strong]:text-[var(--production-ink)]">
                      {step.content}
                    </div>
                  </li>
                ))}
              </ol>

              <div className="border-t border-[var(--production-border)] pt-4 text-[13px] leading-5 text-[var(--production-ink-muted)] [&_a]:font-semibold [&_a]:text-[var(--production-tool)] [&_a]:underline-offset-4 hover:[&_a]:underline">
                {copy.workflowFooter}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <StickyNextStep
        eyebrow={copy.nextEyebrow}
        title={copy.nextTitle}
        description={copy.nextDescription}
        primaryLabel={copy.nextLabel}
        onPrimaryAction={onNext}
        prerequisites={nextPrerequisites}
        prerequisiteSummary={copy.prerequisitesSummary}
        prerequisitesAriaLabel={copy.prerequisitesLabel}
        metLabel={copy.metLabel}
        unmetLabel={copy.unmetLabel}
        mobileNavOffset
        {...(nextReady
          ? { ready: true as const }
          : {
              ready: false as const,
              disabledReason: nextDisabledReason ?? '',
            })}
      />
    </div>
  )
}

function ModeButton({
  buttonRef,
  id,
  controls,
  active,
  icon,
  label,
  onClick,
  onKeyDown,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  id: string
  controls: string
  active: boolean
  icon: 'edit' | 'clipboardCheck'
  label: string
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      role="tab"
      aria-controls={controls}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={[
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] px-3 text-[14px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] motion-reduce:transition-none',
        active
          ? 'bg-[var(--production-surface)] text-[var(--production-tool)] shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
          : 'text-[var(--production-ink-muted)] hover:text-[var(--production-ink)]',
      ].join(' ')}
    >
      <AppIcon aria-hidden="true" name={icon} className="h-4 w-4" />
      {label}
    </button>
  )
}

function saveStateTone(
  state: ScreenplaySaveState,
): 'neutral' | 'active' | 'success' | 'warning' | 'info' {
  if (state === 'saving') return 'active'
  if (state === 'dirty') return 'warning'
  if (state === 'saved') return 'success'
  if (state === 'readonly') return 'info'
  return 'neutral'
}

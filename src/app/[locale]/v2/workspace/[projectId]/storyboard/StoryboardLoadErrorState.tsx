'use client'

import { UiStatePanel } from '@/components/v2/UiStatePanel'

interface StoryboardLoadErrorStateProps {
  locale?: string
  title: string
  description: string
  details?: string
  retryLabel: string
  onRetry: () => void
}

/** Query failure boundary. Intentionally exposes no analysis or generation action. */
export function StoryboardLoadErrorState({
  locale,
  title,
  description,
  details,
  retryLabel,
  onRetry,
}: StoryboardLoadErrorStateProps) {
  return (
    <div className="kuiper-workspace-page">
      <UiStatePanel
        state="error"
        locale={locale}
        title={title}
        description={description}
        details={details}
        primaryAction={(
          <button
            type="button"
            onClick={onRetry}
            className="kuiper-primary-button min-h-11 rounded-input px-5 text-[14px] font-semibold"
          >
            {retryLabel}
          </button>
        )}
      />
    </div>
  )
}

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AutoGroupTaskBanner } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/AutoGroupTaskBanner'

describe('AutoGroupTaskBanner', () => {
  it('renders the localized reconciliation state as a live status', () => {
    render(
      <AutoGroupTaskBanner
        label="Submission outcome is unknown. Checking the task queue…"
        status="reconciling"
        isError={false}
        isPending
        progress={0}
        canEdit
        canCancel={false}
        isCancelling={false}
        cancelLabel="Cancel"
        cancellingLabel="Cancelling…"
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Submission outcome is unknown. Checking the task queue…',
    )
  })

  it('does not expose cancellation to a viewer even when the Task is cancellable', () => {
    const onCancel = vi.fn()
    render(
      <AutoGroupTaskBanner
        label="Grouping panels… 40%"
        status="running"
        isError={false}
        isPending
        progress={40}
        canEdit={false}
        canCancel
        isCancelling={false}
        cancelLabel="Cancel"
        cancellingLabel="Cancelling…"
        onCancel={onCancel}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('allows an editor to cancel a cancellable Task', () => {
    const onCancel = vi.fn()
    render(
      <AutoGroupTaskBanner
        label="Grouping panels… 40%"
        status="running"
        isError={false}
        isPending
        progress={40}
        canEdit
        canCancel
        isCancelling={false}
        cancelLabel="Cancel"
        cancellingLabel="Cancelling…"
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

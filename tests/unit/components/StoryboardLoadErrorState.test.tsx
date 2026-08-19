import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StoryboardLoadErrorState } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/StoryboardLoadErrorState'

describe('StoryboardLoadErrorState', () => {
  it('query error -> offers only a safe retry and never exposes generation actions', () => {
    const onRetry = vi.fn()
    render(
      <StoryboardLoadErrorState
        locale="en"
        title="Storyboard data could not be loaded"
        description="No task was sent."
        details="Failed to fetch storyboards"
        retryLabel="Retry loading"
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch storyboards')
    expect(screen.getByRole('alert')).toHaveTextContent('Error')
    expect(screen.queryByRole('button', { name: /analy|generate/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

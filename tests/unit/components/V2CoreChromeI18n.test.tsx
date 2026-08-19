import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import enStoryboard from '../../../messages/en/v2Storyboard.json'
import enSubjects from '../../../messages/en/v2Subjects.json'
import { GroupSceneAddPickerModal } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/GroupSceneAddPickerModal'
import { V2LocationViewsPanel } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2LocationViewsPanel'

function renderEnglish(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        v2Storyboard: enStoryboard,
        v2Subjects: enSubjects,
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('V2 core localized chrome', () => {
  it('English group location picker -> every control is English and keyboard reachable', () => {
    const onSelect = vi.fn()

    renderEnglish(
      <GroupSceneAddPickerModal
        open
        onClose={vi.fn()}
        candidates={[{ id: 'location-1', name: 'Rooftop' }]}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('Add location')).toBeInTheDocument()
    expect(screen.getByText('Choose a project location to add to this group.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search locations…')).toHaveClass('min-h-11')

    const close = screen.getByRole('button', { name: 'Close location picker' })
    const add = screen.getByRole('button', { name: 'Add Rooftop' })
    expect(close).toHaveClass('min-h-11', 'focus-visible:ring-2')
    expect(add).toHaveClass('min-h-11', 'focus-visible:ring-2')

    fireEvent.click(add)
    expect(onSelect).toHaveBeenCalledWith('location-1')
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/u)
  })

  it('English location views panel -> localized controls preserve create and delete handlers', async () => {
    const onCreateView = vi.fn(async () => undefined)
    const onDeleteView = vi.fn(async () => undefined)
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)

    renderEnglish(
      <V2LocationViewsPanel
        locationName="Atrium"
        images={[
          {
            id: 'view-1',
            imageIndex: 1,
            viewName: 'North entrance',
            imageUrl: 'https://example.test/north.jpg',
          },
        ]}
        onCreateView={onCreateView}
        isCreating={false}
        onRegenerateView={vi.fn()}
        onDeleteView={onDeleteView}
        isRegenerating={() => false}
        isDeleting={false}
        onZoomImage={vi.fn()}
      />,
    )

    expect(screen.getByText('Location views')).toBeInTheDocument()
    expect(screen.getByText('Use “Atrium#view-name” in a storyboard to switch views.')).toBeInTheDocument()

    const addView = screen.getByRole('button', { name: 'Add view' })
    const preview = screen.getByRole('button', { name: 'Preview image: North entrance' })
    const regenerate = screen.getByRole('button', { name: 'Regenerate' })
    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    for (const control of [addView, preview, regenerate, deleteButton]) {
      expect(control).toHaveClass('min-h-11', 'focus-visible:ring-2')
    }

    fireEvent.click(addView)
    const viewName = screen.getByLabelText('View name')
    const description = screen.getByLabelText('View description (optional)')
    expect(viewName).toHaveClass('min-h-11')
    fireEvent.change(viewName, { target: { value: '  Balcony  ' } })
    fireEvent.change(description, { target: { value: '  Wide angle  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create and generate' }))
    await waitFor(() => {
      expect(onCreateView).toHaveBeenCalledWith({
        viewName: 'Balcony',
        description: 'Wide angle',
      })
    })

    fireEvent.click(deleteButton)
    expect(confirm).toHaveBeenCalledWith(
      'Delete “North entrance”?\nThe image and description will be removed permanently.',
    )
    expect(onDeleteView).not.toHaveBeenCalled()
    fireEvent.click(deleteButton)
    await waitFor(() => expect(onDeleteView).toHaveBeenCalledWith(1))
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/u)
  })
})

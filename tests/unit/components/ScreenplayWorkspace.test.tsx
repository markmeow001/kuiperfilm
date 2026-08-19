import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ScreenplayWorkspace,
  type ScreenplayWorkspaceCopy,
} from '@/app/[locale]/v2/workspace/[projectId]/script/ScreenplayWorkspace'

const copy: ScreenplayWorkspaceCopy = {
  headerEyebrow: 'Screenplay',
  headerDescription: 'Write the episode.',
  modesLabel: 'Screenplay workspace views',
  editorMode: 'Edit screenplay',
  guideMode: 'Workflow guide',
  editorLabel: 'Episode screenplay',
  editorHint: 'Scenes, action and dialogue.',
  emptyHint: 'Start typing or upload a file.',
  readOnlyTitle: 'Read-only mode',
  readOnlyDescription: 'Request edit access to continue.',
  saveLabel: 'Save',
  savingLabel: 'Saving…',
  errorTitle: 'Not saved',
  errorDescription: 'The text remains on screen.',
  retrySaveLabel: 'Retry save',
  workflowEyebrow: 'Production flow',
  workflowTitle: 'From script to shots',
  workflowSummary: 'Save before breakdown.',
  workflowSteps: [
    { id: 'write', content: 'Write the screenplay' },
    { id: 'breakdown', content: 'Break down entities' },
  ],
  workflowFooter: 'Project settings are shared.',
  nextEyebrow: 'Next stage',
  nextTitle: 'Open script breakdown',
  nextDescription: 'The saved screenplay becomes the source.',
  nextLabel: 'Next: breakdown',
  prerequisitesLabel: 'Breakdown requirements',
  prerequisitesSummary: '1 requirement remaining',
  metLabel: 'Complete',
  unmetLabel: 'Incomplete',
}

const baseProps = {
  locale: 'en',
  episodeTitle: 'Episode 1',
  episodeContext: 'Episode 1 · 2 total',
  characterCountLabel: '0 chars',
  statusLabel: 'No content yet',
  saveState: 'empty' as const,
  value: '',
  placeholder: 'Write the screenplay…',
  canEdit: true,
  saveDisabled: true,
  bulkUpload: <button type="button">Upload script</button>,
  nextReady: false,
  nextDisabledReason: 'Add screenplay content before continuing.',
  nextPrerequisites: [
    { id: 'episode', label: 'Episode selected', met: true },
    { id: 'content', label: 'Screenplay has content', met: false },
  ],
  copy,
  onValueChange: vi.fn(),
  onEditorBlur: vi.fn(),
  onSave: vi.fn(),
  onRetrySave: vi.fn(),
  onNext: vi.fn(),
}

describe('ScreenplayWorkspace', () => {
  it('empty screenplay -> explains the first action and blocks the next stage', () => {
    render(<ScreenplayWorkspace {...baseProps} />)

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Episode 1',
    })
    expect(heading.closest('[class*="planningRoot"]')).not.toBeNull()
    expect(
      screen.getByText('Start typing or upload a file.'),
    ).toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: 'Episode screenplay' })
    expect(editor).toHaveAttribute('placeholder', 'Write the screenplay…')
    expect(editor.className).toContain('screenplayPage')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Next: breakdown' }),
    ).toBeDisabled()
    expect(
      screen.getByText('Add screenplay content before continuing.').closest('[role="status"]'),
    ).not.toBeNull()
  })

  it('saved screenplay -> exposes the next stage and preserves the action callback', () => {
    const onNext = vi.fn()
    render(
      <ScreenplayWorkspace
        {...baseProps}
        value="INT. STUDIO — NIGHT"
        characterCountLabel="19 chars"
        statusLabel="Saved"
        saveState="saved"
        nextReady
        nextDisabledReason={undefined}
        nextPrerequisites={[
          { id: 'episode', label: 'Episode selected', met: true },
          { id: 'content', label: 'Screenplay has content', met: true },
        ]}
        copy={{ ...copy, prerequisitesSummary: 'All 2 requirements complete' }}
        onNext={onNext}
      />,
    )

    const next = screen.getByRole('button', { name: 'Next: breakdown' })
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('mobile task mode -> switches from the editor to the workflow guide', () => {
    render(<ScreenplayWorkspace {...baseProps} />)

    const guide = screen.getByLabelText('Workflow guide')
    expect(guide).toHaveClass('hidden')
    fireEvent.click(screen.getByRole('tab', { name: 'Workflow guide' }))
    expect(screen.getByRole('tab', { name: 'Workflow guide' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(guide).not.toHaveClass('hidden')
    expect(screen.getByText('From script to shots')).toBeInTheDocument()
    expect(screen.getByText('Production flow')).toBeInTheDocument()
  })

  it('mobile task tabs -> expose tabpanel relationships and support roving keyboard focus', () => {
    render(<ScreenplayWorkspace {...baseProps} />)

    const editorTab = screen.getByRole('tab', { name: 'Edit screenplay' })
    const guideTab = screen.getByRole('tab', { name: 'Workflow guide' })
    const editorPanel = screen.getByRole('tabpanel', {
      name: 'Edit screenplay',
    })
    const guidePanel = screen.getByRole('tabpanel', {
      name: 'Workflow guide',
      hidden: true,
    })

    expect(editorTab).toHaveAttribute('aria-controls', editorPanel.id)
    expect(guideTab).toHaveAttribute('aria-controls', guidePanel.id)
    expect(editorPanel).toHaveAttribute('aria-labelledby', editorTab.id)
    expect(guidePanel).toHaveAttribute('aria-labelledby', guideTab.id)
    expect(editorPanel).toHaveClass('focus-visible:ring-2')
    expect(guidePanel).toHaveClass('focus-visible:ring-2')
    expect(editorTab).toHaveAttribute('tabindex', '0')
    expect(guideTab).toHaveAttribute('tabindex', '-1')

    editorTab.focus()
    fireEvent.keyDown(editorTab, { key: 'ArrowRight' })
    expect(guideTab).toHaveFocus()
    expect(guideTab).toHaveAttribute('aria-selected', 'true')
    expect(guideTab).toHaveAttribute('tabindex', '0')
    expect(editorTab).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(guideTab, { key: 'Home' })
    expect(editorTab).toHaveFocus()
    expect(editorTab).toHaveAttribute('aria-selected', 'true')
  })

  it('viewer access -> keeps the screenplay readable and the editor immutable', () => {
    render(
      <ScreenplayWorkspace
        {...baseProps}
        value="Read-only screenplay"
        statusLabel="Read only"
        saveState="readonly"
        canEdit={false}
      />,
    )

    expect(screen.getByText('Read-only mode')).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Episode screenplay' }),
    ).toHaveAttribute('readonly')
  })

  it('viewer with a preserved save issue -> cannot trigger the recovery mutation', () => {
    const onRetrySave = vi.fn()
    render(
      <ScreenplayWorkspace
        {...baseProps}
        value="Preserved draft"
        statusLabel="Read only"
        saveState="readonly"
        canEdit={false}
        errorMessage="Draft remains in this browser."
        onRetrySave={onRetrySave}
      />,
    )

    const retry = screen.getByRole('button', { name: 'Retry save' })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(onRetrySave).not.toHaveBeenCalled()
  })

  it.each([
    { key: 'Control', modifier: { ctrlKey: true } },
    { key: 'Meta', modifier: { metaKey: true } },
  ])('$key+S -> saves once without leaving the editor', ({ modifier }) => {
    const onSave = vi.fn()
    render(
      <ScreenplayWorkspace
        {...baseProps}
        value="Unsaved screenplay"
        saveState="dirty"
        saveDisabled={false}
        onSave={onSave}
      />,
    )

    const editor = screen.getByRole('textbox', { name: 'Episode screenplay' })
    fireEvent.keyDown(editor, { key: 's', ...modifier })
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('disabled or read-only editor -> keyboard save does not mutate', () => {
    const onSave = vi.fn()
    const { rerender } = render(
      <ScreenplayWorkspace {...baseProps} onSave={onSave} />,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Episode screenplay' }), {
      key: 's',
      ctrlKey: true,
    })
    expect(onSave).not.toHaveBeenCalled()

    rerender(
      <ScreenplayWorkspace
        {...baseProps}
        canEdit={false}
        saveState="readonly"
        saveDisabled={false}
        onSave={onSave}
      />,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Episode screenplay' }), {
      key: 's',
      metaKey: true,
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('save failure -> announces the problem and offers the explicit recovery action', () => {
    const onRetrySave = vi.fn()
    render(
      <ScreenplayWorkspace
        {...baseProps}
        value="Draft remains here"
        saveState="dirty"
        saveDisabled={false}
        errorMessage="Draft preserved"
        onRetrySave={onRetrySave}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('The text remains on screen.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    expect(onRetrySave).toHaveBeenCalledOnce()
  })

  it('save state -> is announced politely without moving focus', () => {
    render(
      <ScreenplayWorkspace
        {...baseProps}
        value="Draft"
        statusLabel="Unsaved changes"
        saveState="dirty"
        saveDisabled={false}
      />,
    )

    const liveRegion = screen.getAllByRole('status').find(
      (element) => element.textContent === 'Unsaved changes',
    )
    expect(liveRegion).toHaveAttribute('role', 'status')
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true')
  })
})

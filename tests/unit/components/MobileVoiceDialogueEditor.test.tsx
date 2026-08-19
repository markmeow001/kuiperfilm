import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import enVoice from '../../../messages/en/v2Voice.json'
import zhVoice from '../../../messages/zh/v2Voice.json'
import {
  MobileVoiceDialogueEditor,
  type MobileVoiceDialogueLabels,
} from '@/app/[locale]/m/projects/[projectId]/episodes/[episodeId]/panels/[panelId]/MobileVoiceDialogueEditor'

const line = {
  id: 'line-1',
  lineIndex: 1,
  speaker: 'Ann',
  content: 'Keep this readable',
  matchedPanelId: 'panel-1',
}

const labels: MobileVoiceDialogueLabels = {
  contentLabel: 'Dialogue for Ann',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
}

describe('mobile voice dialogue editor permission contract', () => {
  it('[viewer] -> [renders dialogue with zero mutation UI and zero handler calls]', () => {
    const onSave = vi.fn(async () => undefined)
    render(
      <MobileVoiceDialogueEditor
        line={line}
        canEdit={false}
        labels={labels}
        onSave={onSave}
      />,
    )

    expect(screen.getByText('Keep this readable')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('[editor at phone width] -> [save and cancel controls have 44px hit areas]', async () => {
    const onSave = vi.fn(async () => undefined)
    render(
      <MobileVoiceDialogueEditor
        line={line}
        canEdit
        labels={labels}
        onSave={onSave}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Dialogue for Ann' }), {
      target: { value: 'Updated dialogue' },
    })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(cancel).toHaveClass('min-h-11')
    expect(save).toHaveClass('min-h-11')
    fireEvent.click(save)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Updated dialogue'))
  })

  it('[parent permission changes after render] -> [handler remains fail-closed]', () => {
    const source = readFileSync(
      'src/app/[locale]/m/projects/[projectId]/episodes/[episodeId]/panels/[panelId]/page.tsx',
      'utf8',
    )
    expect(source).toMatch(/async function handleSaveDialogue[\s\S]*?if \(!canEdit\) return/)
  })

  it('[zh/en locale] -> [mobile dialogue copy exists in both locale catalogs]', () => {
    expect(zhVoice.mobileDialogue).toMatchObject({
      title: '對白',
      readOnly: '唯讀',
      save: '儲存',
    })
    expect(enVoice.mobileDialogue).toMatchObject({
      title: 'Dialogue',
      readOnly: 'Read only',
      save: 'Save',
    })
  })
})

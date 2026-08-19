import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const copy: Record<string, string> = {
  close: '關閉',
  eyebrow: 'MANUAL · STORYBOARD',
  title: '手動新增分鏡',
  nonAiNotice: '只建立分鏡，不會使用 AI 或產生點數費用。',
  characters: '出場角色',
  noCharacters: '本專案還沒有角色，請先到 Subjects 建立角色。',
  location: '場景',
  noLocations: '本專案還沒有場景，請先到 Subjects 建立場景。',
  prompt: '敘事提示詞',
  promptPlaceholder: '描述這一鏡真正要發生的內容',
  duration: '時長（秒）',
  cancel: '取消',
  create: '建立分鏡',
  retryCreate: '用同一草稿重試',
  creating: '建立中…',
  recoveryLocked: '結果尚未確認，內容已鎖定。',
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => {
    if (key === 'selectedCharacters') return `${values?.selected ?? 0}/${values?.total ?? 0} 已選`
    if (key === 'characterCount') return `${values?.count ?? 0} 字`
    if (key === 'locationSelection') return values?.selected ? '已選 · 單選' : '可選 · 單選'
    return copy[key] ?? key
  },
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: () => <span aria-hidden="true" />,
}))

import {
  V2ManualPanelModal,
  type ManualPanelDraft,
} from '@/app/[locale]/v2/workspace/[projectId]/storyboard/V2ManualPanelModal'

function FailureHarness({ onSubmit }: { onSubmit: (draft: ManualPanelDraft) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <V2ManualPanelModal
      characters={[{ id: 'character-1', name: '林真' }]}
      locations={[{ id: 'location-1', name: '天台' }]}
      onSubmit={async (draft) => {
        await onSubmit(draft)
        setError('連線中斷，草稿仍保留。')
      }}
      onClose={vi.fn()}
      submitError={error}
    />
  )
}

const EMPTY_DRAFT: ManualPanelDraft = {
  description: '',
  characterNames: [],
  locationName: null,
  durationSeconds: 5,
}

function RecoveryHarness({ onSubmit }: { onSubmit: (draft: ManualPanelDraft) => Promise<void> }) {
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState<ManualPanelDraft>(EMPTY_DRAFT)
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>重新開啟</button>
      {open ? (
        <V2ManualPanelModal
          characters={[{ id: 'character-1', name: '林真' }]}
          locations={[{ id: 'location-1', name: '天台' }]}
          initialDraft={draft}
          onDraftChange={setDraft}
          draftLocked={outcomeUnknown}
          onSubmit={async (submittedDraft) => {
            await onSubmit(submittedDraft)
            setOutcomeUnknown(true)
            setError('連線結果不明，請用同一份草稿重試。')
          }}
          onClose={() => setOpen(false)}
          submitError={error}
        />
      ) : null}
    </>
  )
}

function FocusHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>開啟手動新增</button>
      {open ? (
        <V2ManualPanelModal
          characters={[]}
          locations={[]}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

describe('V2ManualPanelModal truthful manual create contract', () => {
  it('[390px 手動建立] -> 明示零 AI、主要操作 44px 且不宣稱自動生圖', () => {
    render(
      <V2ManualPanelModal
        characters={[]}
        locations={[]}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: '手動新增分鏡' })).toBeInTheDocument()
    expect(screen.getByText('只建立分鏡，不會使用 AI 或產生點數費用。')).toBeInTheDocument()
    expect(screen.queryByText('建立並生圖')).not.toBeInTheDocument()

    const createButton = screen.getByRole('button', { name: '建立分鏡' })
    const cancelButton = screen.getByRole('button', { name: '取消' })
    const closeButton = screen.getByRole('button', { name: '關閉' })
    expect(createButton).toHaveClass('min-h-11')
    expect(cancelButton).toHaveClass('min-h-11')
    expect(closeButton).toHaveClass('min-h-11', 'min-w-11')
    expect(screen.getByRole('dialog')).toHaveClass('p-4')
    expect(document.querySelector('footer')).toHaveClass('flex-col-reverse', 'sm:flex-row')
  })

  it('[建立失敗後 parent 回傳錯誤] -> modal 保持開啟、顯示 inline error 且完整保留草稿', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<FailureHarness onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '林真' }))
    fireEvent.click(screen.getByRole('button', { name: '天台' }))
    const prompt = screen.getByRole('textbox', { name: '敘事提示詞' })
    fireEvent.change(prompt, { target: { value: '雨夜天台，林真停在霓虹燈下。' } })
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    fireEvent.click(screen.getByRole('button', { name: '建立分鏡' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      description: '雨夜天台，林真停在霓虹燈下。',
      characterNames: ['林真'],
      locationName: '天台',
      durationSeconds: 10,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('連線中斷，草稿仍保留。')
    expect(screen.getByRole('textbox', { name: '敘事提示詞' })).toHaveValue(
      '雨夜天台，林真停在霓虹燈下。',
    )
    expect(screen.getByRole('button', { name: '林真' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '天台' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('[network/5xx outcome unknown 後關閉再開] -> 同一草稿完整恢復、鎖定修改且可精確重試', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<RecoveryHarness onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '林真' }))
    fireEvent.click(screen.getByRole('button', { name: '天台' }))
    fireEvent.change(screen.getByRole('textbox', { name: '敘事提示詞' }), {
      target: { value: '雨夜天台，林真停在霓虹燈下。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    fireEvent.click(screen.getByRole('button', { name: '建立分鏡' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('連線結果不明'))
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新開啟' }))

    expect(screen.getByRole('textbox', { name: '敘事提示詞' })).toHaveValue(
      '雨夜天台，林真停在霓虹燈下。',
    )
    expect(screen.getByRole('button', { name: '林真' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '天台' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: '敘事提示詞' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '用同一草稿重試' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls[1]?.[0]).toEqual(onSubmit.mock.calls[0]?.[0])
  })

  it('[鍵盤開啟 modal] -> 初始焦點在內、Tab 循環、Escape/關閉後焦點回到 opener', async () => {
    render(<FocusHarness />)
    const trigger = screen.getByRole('button', { name: '開啟手動新增' })
    trigger.focus()
    fireEvent.click(trigger)

    const close = screen.getByRole('button', { name: '關閉' })
    await waitFor(() => expect(close).toHaveFocus())
    const cancel = screen.getByRole('button', { name: '取消' })
    cancel.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())

    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('button', { name: '關閉' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

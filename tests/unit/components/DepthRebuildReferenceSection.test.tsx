import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DepthRebuildReferenceSection } from '@/app/[locale]/live-composite/DepthRebuildReferenceSection'

type ReferenceSectionProps = ComponentProps<typeof DepthRebuildReferenceSection>

function character(
  id: string,
  overrides: Partial<ReferenceSectionProps['characters'][number]> = {},
): ReferenceSectionProps['characters'][number] {
  return {
    id,
    label: '',
    sourceBinding: '',
    brief: '',
    description: '',
    reference: null,
    ...overrides,
  }
}

function scene(
  id: string,
  index: number,
): ReferenceSectionProps['scenes'][number] {
  return {
    id,
    note: `場景用途 ${index}`,
    reference: {
      url: `blob:scene-${index}`,
      name: `scene-${index}.png`,
    },
  }
}

function buildProps(
  overrides: Partial<ReferenceSectionProps> = {},
): ReferenceSectionProps {
  return {
    characters: [character('character-1')],
    scenes: [],
    sceneBrief: '',
    sceneDescription: '',
    used: 0,
    max: 9,
    assistTarget: null,
    controlsDisabled: false,
    onAddCharacter: vi.fn(),
    onRemoveCharacter: vi.fn(),
    onCharacterSelect: vi.fn(),
    onCharacterPreviewError: vi.fn(),
    onRemoveCharacterImage: vi.fn(),
    onCharacterLabelChange: vi.fn(),
    onCharacterSourceBindingChange: vi.fn(),
    onCharacterBriefChange: vi.fn(),
    onCharacterDescriptionChange: vi.fn(),
    onAssistCharacter: vi.fn(),
    onAddSceneImages: vi.fn(),
    onRemoveSceneImage: vi.fn(),
    onScenePreviewError: vi.fn(),
    onSceneNoteChange: vi.fn(),
    onSceneBriefChange: vi.fn(),
    onSceneDescriptionChange: vi.fn(),
    onAssistScene: vi.fn(),
    ...overrides,
  }
}

describe('DepthRebuildReferenceSection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('尚未上傳圖片 -> 顯示 0/9 配額並明示 AI 補全可能產生文字模型費用', () => {
    render(<DepthRebuildReferenceSection {...buildProps()} />)

    expect(screen.getByText('0/9')).toBeInTheDocument()
    expect(screen.getByLabelText('已使用 0 / 9 張參考圖片')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 補全角色 1的外觀' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 補全新場景與持續動態' })).toBeInTheDocument()
    expect(screen.getAllByText(/主動按下可能產生少量文字分析費用/)).toHaveLength(2)
    expect(screen.getByText(/另為 1 位待上傳角色預留位置/)).toBeInTheDocument()
    expect(screen.getByTitle('image 1（人物待上傳）')).toBeInTheDocument()
  })

  it('兩位角色加一張場景 -> 人物在前、場景接續顯示 image 1–3 映射', () => {
    render(<DepthRebuildReferenceSection {...buildProps({
      characters: [
        character('character-1', {
          label: '新郎',
          sourceBinding: '開場畫面左側、手拿花束的男性',
          reference: { url: 'blob:groom', name: 'groom.png' },
        }),
        character('character-2', {
          label: '新娘',
          sourceBinding: '開場畫面右側、穿婚紗的女性',
          reference: { url: 'blob:bride', name: 'bride.png' },
        }),
      ],
      scenes: [{
        ...scene('scene-1', 1),
        note: '教堂外觀與庭院構圖',
      }],
      used: 3,
    })} />)

    expect(screen.getByText('image 1')).toBeInTheDocument()
    expect(screen.getByText('新郎 → 開場畫面左側、手拿花束的男性')).toBeInTheDocument()
    expect(screen.getByText('image 2')).toBeInTheDocument()
    expect(screen.getByText('新娘 → 開場畫面右側、穿婚紗的女性')).toBeInTheDocument()
    expect(screen.getByText('image 3')).toBeInTheDocument()
    expect(screen.getByText('教堂外觀與庭院構圖')).toBeInTheDocument()
    expect(screen.getByTitle('image 1（人物）')).toBeInTheDocument()
    expect(screen.getByTitle('image 3（場景）')).toBeInTheDocument()
  })

  it('九個位置已分配且仍有待上傳角色 -> 停用新增，但保留必填角色上傳入口', () => {
    render(<DepthRebuildReferenceSection {...buildProps({
      characters: [
        character('character-1', {
          label: '新郎',
          sourceBinding: '開場左側男性',
          reference: { url: 'blob:groom', name: 'groom.png' },
        }),
        character('character-2', {
          label: '新娘',
          sourceBinding: '開場右側女性',
        }),
      ],
      scenes: Array.from({ length: 7 }, (_, index) => scene(`scene-${index + 1}`, index + 1)),
      used: 8,
    })} />)

    expect(screen.getByText('8/9')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增另一位角色' })).toBeDisabled()
    expect(screen.getByLabelText('上傳角色 02 參考圖片')).toBeEnabled()
    expect(screen.getByLabelText('新增場景參考圖片')).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      '9 個參考位置已分配完畢',
    )
  })

  it('多人與多場景控制項 -> 每個編輯及移除操作都有明確名稱', () => {
    render(<DepthRebuildReferenceSection {...buildProps({
      characters: [
        character('character-1', {
          label: '新郎',
          reference: { url: 'blob:groom', name: 'groom.png' },
        }),
        character('character-2', { label: '新娘' }),
      ],
      scenes: [scene('scene-1', 1)],
      used: 2,
    })} />)

    expect(screen.getByRole('button', { name: '移除新娘' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除新郎的參考圖片' })).toBeInTheDocument()
    const replaceGroomImage = screen.getByLabelText('更換新郎的參考圖片')
    expect(replaceGroomImage).toHaveAttribute('type', 'file')
    expect(replaceGroomImage).toHaveAttribute('tabindex', '-1')
    expect(replaceGroomImage.parentElement).toHaveClass('relative')
    expect(screen.getByRole('button', { name: '更換' })).toHaveClass('focus-visible:ring-2')
    const uploadBrideImage = screen.getByLabelText('上傳角色 02 參考圖片')
    expect(uploadBrideImage).toHaveAttribute('tabindex', '-1')
    expect(uploadBrideImage.parentElement).toHaveClass('relative')
    expect(screen.getByRole('button', { name: '上傳角色 02 參考圖片' })).toHaveClass('focus-visible:ring-2')
    expect(screen.getByLabelText('場景參考 1 的用途')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除場景參考 1' })).toBeInTheDocument()
    const addSceneImages = screen.getByLabelText('新增場景參考圖片')
    expect(addSceneImages).toHaveAttribute('tabindex', '-1')
    expect(addSceneImages.parentElement).toHaveClass('relative')
    expect(screen.getByRole('button', { name: '新增場景參考圖片' })).toHaveClass('focus-visible:ring-2')
  })

  it('角色圖片建立預覽 -> 保留同一個 file input，且焦點回到可見控制不捲動頁面', () => {
    const onCharacterSelect = vi.fn()
    const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus')
    const initialProps = buildProps({ onCharacterSelect })
    const { rerender } = render(<DepthRebuildReferenceSection {...initialProps} />)
    const inputBeforePreview = screen.getByLabelText('上傳角色 01 參考圖片')
    const triggerBeforePreview = screen.getByRole('button', { name: '上傳角色 01 參考圖片' })
    const file = new File(['character'], 'character.png', { type: 'image/png' })

    fireEvent.change(inputBeforePreview, { target: { files: [file] } })

    expect(onCharacterSelect).toHaveBeenCalledWith('character-1', file)
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(triggerBeforePreview)

    rerender(<DepthRebuildReferenceSection {...buildProps({
      characters: [character('character-1', {
        label: '新娘',
        reference: { url: 'blob:bride', name: 'bride.png' },
      })],
      used: 1,
      onCharacterSelect,
    })} />)

    const inputAfterPreview = screen.getByLabelText('更換新娘的參考圖片')
    expect(inputAfterPreview).toBe(inputBeforePreview)
    expect(inputAfterPreview.parentElement).toHaveClass('relative')
    expect(screen.getByRole('button', { name: '更換' })).toBe(triggerBeforePreview)
  })
})

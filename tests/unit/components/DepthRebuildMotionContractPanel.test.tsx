import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DepthRebuildMotionContractPanel,
  type DepthRebuildMotionContractPanelProps,
} from '@/app/[locale]/live-composite/DepthRebuildMotionContractPanel'

function buildProps(
  overrides: Partial<DepthRebuildMotionContractPanelProps> = {},
): DepthRebuildMotionContractPanelProps {
  return {
    cameraDirection: 'source-matched',
    framingCrop: 'source-matched',
    subjectDirection: 'source-matched',
    singleTake: false,
    lockFraming: true,
    noDirectionReversal: false,
    characters: [
      { id: 'groom', label: '男方' },
      { id: 'bride', label: '女方' },
    ],
    gazeSourceCharacterId: 'groom',
    gazeTargetCharacterId: 'bride',
    interactionDescription: '男方一路看向女方，兩人挽手前進',
    onCameraDirectionChange: vi.fn(),
    onFramingCropChange: vi.fn(),
    onSubjectDirectionChange: vi.fn(),
    onSingleTakeChange: vi.fn(),
    onLockFramingChange: vi.fn(),
    onNoDirectionReversalChange: vi.fn(),
    onGazeSourceCharacterIdChange: vi.fn(),
    onGazeTargetCharacterIdChange: vi.fn(),
    onInteractionDescriptionChange: vi.fn(),
    ...overrides,
  }
}

describe('DepthRebuildMotionContractPanel', () => {
  it('清楚區分 RGB、Depth 與參考圖的責任，且不把提示詞宣稱為 API 硬鎖', () => {
    render(<DepthRebuildMotionContractPanel {...buildProps()} />)

    expect(screen.getByText('控制運鏡、人物表演、視線與時間節奏。')).toBeInTheDocument()
    expect(screen.getByText('控制空間、遮擋、人物大小與前後關係。')).toBeInTheDocument()
    expect(screen.getByText('只負責外觀與美術，不改寫原片動作。')).toBeInTheDocument()
    expect(screen.getByText(/不是模型 API 的硬鎖/)).toBeInTheDocument()
  })

  it('通用預設 -> 運鏡、人物走位與構圖都清楚選中跟隨原片', () => {
    render(<DepthRebuildMotionContractPanel {...buildProps()} />)

    const sourceMatchedChoices = screen.getAllByRole('radio', { name: /跟隨原片/ })
    expect(sourceMatchedChoices).toHaveLength(3)
    expect(sourceMatchedChoices.every((choice) => (choice as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByText(/預設全部跟隨 RGB 原片/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '視線來源人物' })).toHaveValue('groom')
    expect(screen.getAllByRole('option', { name: '跟隨原片（不指定）' })).toHaveLength(2)
  })

  it('把運鏡、人物方向、構圖與三個鎖定選項的具體新值交給控制器', () => {
    const props = buildProps()
    render(<DepthRebuildMotionContractPanel {...props} />)

    fireEvent.click(screen.getByRole('radio', { name: /鏡頭前進/ }))
    fireEvent.click(screen.getByRole('radio', { name: /人物橫移/ }))
    fireEvent.click(screen.getByRole('radio', { name: /腰上/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /一鏡到底/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /鎖住人物大小與構圖/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /運鏡方向不可反轉/ }))

    expect(props.onCameraDirectionChange).toHaveBeenCalledWith('forward')
    expect(props.onSubjectDirectionChange).toHaveBeenCalledWith('lateral')
    expect(props.onFramingCropChange).toHaveBeenCalledWith('waist-up')
    expect(props.onSingleTakeChange).toHaveBeenCalledWith(true)
    expect(props.onLockFramingChange).toHaveBeenCalledWith(false)
    expect(props.onNoDirectionReversalChange).toHaveBeenCalledWith(true)
  })

  it('視線可留空，並從兩個選單排除相同人物', () => {
    const onGazeSourceCharacterIdChange = vi.fn()
    const onGazeTargetCharacterIdChange = vi.fn()
    render(
      <DepthRebuildMotionContractPanel
        {...buildProps({ onGazeSourceCharacterIdChange, onGazeTargetCharacterIdChange })}
      />,
    )

    const sourceSelect = screen.getByRole('combobox', { name: '視線來源人物' })
    const targetSelect = screen.getByRole('combobox', { name: '視線目標人物' })
    expect(sourceSelect).not.toHaveTextContent('女方')
    expect(targetSelect).not.toHaveTextContent('男方')

    fireEvent.change(sourceSelect, { target: { value: '' } })
    fireEvent.change(targetSelect, { target: { value: '' } })
    expect(onGazeSourceCharacterIdChange).toHaveBeenCalledWith(null)
    expect(onGazeTargetCharacterIdChange).toHaveBeenCalledWith(null)
  })

  it('角色不足時停用視線目標，並把互動描述完整交回', () => {
    const onInteractionDescriptionChange = vi.fn()
    render(
      <DepthRebuildMotionContractPanel
        {...buildProps({
          characters: [{ id: 'solo', label: '演員' }],
          gazeSourceCharacterId: 'solo',
          gazeTargetCharacterId: null,
          onInteractionDescriptionChange,
        })}
      />,
    )

    expect(screen.getByRole('combobox', { name: '視線目標人物' })).toBeDisabled()
    expect(screen.getByText('加入至少兩位角色後，才能設定彼此視線。')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '互動細節' }), {
      target: { value: '演員持續看向畫面右側並向前走' },
    })
    expect(onInteractionDescriptionChange).toHaveBeenCalledWith('演員持續看向畫面右側並向前走')
  })

  it('外部狀態若意外指定同一人物，會顯示明確錯誤而不隱藏問題', () => {
    render(
      <DepthRebuildMotionContractPanel
        {...buildProps({ gazeSourceCharacterId: 'groom', gazeTargetCharacterId: 'groom' })}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('視線來源與目標不能是同一位')
  })
})

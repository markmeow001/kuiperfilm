import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DepthRebuildPanel, type DepthRebuildPanelProps } from '@/app/[locale]/live-composite/DepthRebuildPanel'

function completeCharacter(
  overrides: Partial<DepthRebuildPanelProps['characters'][number]> = {},
): DepthRebuildPanelProps['characters'][number] {
  return {
    id: 'character-1',
    label: '民國女記者',
    sourceBinding: '開場畫面左側人物',
    brief: '',
    description: '寫實民國女記者，墨綠羊毛大衣',
    reference: { url: 'blob:character', name: 'character.png' },
    ...overrides,
  }
}

function buildProps(overrides: Partial<DepthRebuildPanelProps> = {}): DepthRebuildPanelProps {
  return {
    source: { name: 'performance.mp4', duration: 10, width: 1080, height: 1920 },
    depthGuide: { url: 'blob:depth', effectiveFps: 9.5, sufficient: true },
    depthProgress: null,
    depthBusy: false,
    characters: [completeCharacter()],
    sceneReferences: [],
    sceneBrief: '',
    sceneDescription: '雨夜上海街口，電車和路人持續移動',
    referenceImageCount: 1,
    maxReferenceImages: 9,
    descriptionAssistTarget: null,
    modelOptions: [{ value: 'seedance-fast', label: 'Seedance Fast' }],
    modelKey: 'seedance-fast',
    resolutionOptions: [{ value: '720p', label: '720p' }],
    resolution: '720p',
    prompt: 'Use video 1 as depth guidance.',
    promptStale: false,
    generating: false,
    interactionDisabled: false,
    canGenerate: true,
    estimatedCostLabel: 'US$1.25',
    onVideoSelect: vi.fn(),
    onCreateDepthGuide: vi.fn(),
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
    onModelChange: vi.fn(),
    onResolutionChange: vi.fn(),
    onBuildPrompt: vi.fn(),
    onGenerate: vi.fn(),
    ...overrides,
  }
}

describe('DepthRebuildPanel', () => {
  it('初次渲染 -> 不自行觸發付費或本機處理，並如實揭露深度限制', () => {
    const props = buildProps()
    render(<DepthRebuildPanel {...props} />)

    expect(screen.getByText(/深度影片不是去背遮罩/)).toBeInTheDocument()
    expect(screen.getByText(/臉部表情、口型、手指和前後遮擋仍可能被 AI 改寫/)).toBeInTheDocument()
    expect(screen.getByText(/只有按下最下方按鈕才會送出/)).toBeInTheDocument()
    expect(props.onCreateDepthGuide).not.toHaveBeenCalled()
    expect(props.onBuildPrompt).not.toHaveBeenCalled()
    expect(props.onGenerate).not.toHaveBeenCalled()
  })

  it('角色與場景選圖 -> 分別傳回實際 File，且不需先等待深度分析', () => {
    const onCharacterSelect = vi.fn()
    const onAddSceneImages = vi.fn()
    render(<DepthRebuildPanel {...buildProps({
      depthGuide: null,
      characters: [completeCharacter({ reference: null })],
      referenceImageCount: 0,
      onCharacterSelect,
      onAddSceneImages,
    })} />)

    const character = new File(['character'], 'character.png', { type: 'image/png' })
    const scene = new File(['scene'], 'scene.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('上傳角色 01 參考圖片'), { target: { files: [character] } })
    fireEvent.change(screen.getByLabelText('新增場景參考圖片'), { target: { files: [scene] } })

    expect(onCharacterSelect).toHaveBeenCalledWith('character-1', character)
    expect(onAddSceneImages).toHaveBeenCalledWith([scene])
    expect(screen.getByLabelText('上傳角色 01 參考圖片')).toHaveAttribute(
      'accept',
      '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
    )
  })

  it('圖片無法解碼 -> 立即回報並交由上層清除破損預覽', () => {
    const onCharacterPreviewError = vi.fn()
    render(<DepthRebuildPanel {...buildProps({ onCharacterPreviewError })} />)

    fireEvent.error(screen.getByAltText('民國女記者參考預覽'))

    expect(onCharacterPreviewError).toHaveBeenCalledWith('character-1')
  })

  it('尚無原片 -> 可直接選擇 4–15 秒表演影片，不需先執行分析', () => {
    const onVideoSelect = vi.fn()
    render(<DepthRebuildPanel {...buildProps({ source: null, depthGuide: null, onVideoSelect })} />)

    const video = new File(['video'], 'performance.mp4', { type: 'video/mp4' })
    const videoInput = screen.getByLabelText('上傳 4–15 秒表演影片')
    expect(videoInput.closest('label')).toHaveClass('focus-within:ring-2')
    fireEvent.change(videoInput, { target: { files: [video] } })

    expect(onVideoSelect).toHaveBeenCalledWith(video)
    expect(onVideoSelect).toHaveBeenCalledTimes(1)
  })

  it('尚未備妥深度與角色 -> 建立 Prompt 與付費生成皆停用，但顯示可理解的灰色範例', () => {
    render(<DepthRebuildPanel {...buildProps({
      depthGuide: null,
      characters: [completeCharacter({ reference: null })],
      referenceImageCount: 0,
      prompt: '',
      canGenerate: false,
    })} />)

    expect(screen.getByRole('button', { name: '建立 Prompt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '確認費用並生成影片' })).toBeDisabled()
    expect(screen.getByPlaceholderText(/1930 年代青年偵探/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/雨夜上海法租界/)).toBeInTheDocument()
  })

  it('角色或場景描述留空 -> 即使素材齊全仍不能建立 Prompt', () => {
    const { rerender } = render(<DepthRebuildPanel {...buildProps({
      characters: [completeCharacter({ description: '' })],
    })} />)
    expect(screen.getByRole('button', { name: '重新建立 Prompt' })).toBeDisabled()

    rerender(<DepthRebuildPanel {...buildProps({ sceneDescription: '   ' })} />)
    expect(screen.getByRole('button', { name: '重新建立 Prompt' })).toBeDisabled()
  })

  it('設定完成並確認 -> 只有點擊生成按鈕才呼叫 onGenerate', () => {
    const onGenerate = vi.fn()
    render(<DepthRebuildPanel {...buildProps({ onGenerate })} />)

    fireEvent.click(screen.getByRole('button', { name: '確認費用並生成影片' }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('Prompt 已過期 -> 阻止付費生成並提示重新建立', () => {
    render(<DepthRebuildPanel {...buildProps({ promptStale: true })} />)

    expect(screen.getByText('內容已變更，請重新建立')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確認費用並生成影片' })).toBeDisabled()
  })

  it('帳號沒有可用模型 -> 顯示明確設定提示並阻止付費生成', () => {
    render(<DepthRebuildPanel {...buildProps({ modelOptions: [], modelKey: '' })} />)

    expect(screen.getByRole('status')).toHaveTextContent(/尚未啟用 AtlasCloud Seedance 2.0 Fast 或 Standard/)
    expect(screen.getByLabelText('模型')).toBeDisabled()
    expect(screen.getByRole('button', { name: '確認費用並生成影片' })).toBeDisabled()
  })

  it('模型與解析度不相容 -> 顯示具體阻擋原因，不只停用按鈕', () => {
    render(<DepthRebuildPanel {...buildProps({
      resolution: '1080p',
      blockingMessage: '模型不支援 1080p；允許：480p、720p。',
      canGenerate: false,
    })} />)

    expect(screen.getByRole('status')).toHaveTextContent(/尚未送出：模型不支援 1080p/)
    expect(screen.getByLabelText('輸出解析度')).toHaveValue('1080p')
    expect(screen.getByRole('button', { name: '確認費用並生成影片' })).toBeDisabled()
  })

  it('已送出但查詢中斷 -> 只允許恢復同一筆任務，並清楚標示不重複扣費', () => {
    const onGenerate = vi.fn()
    render(<DepthRebuildPanel {...buildProps({
      submittedRunId: 'run-depth-001',
      canResume: true,
      canGenerate: true,
      promptStale: true,
      onGenerate,
    })} />)

    expect(screen.getByRole('status')).toHaveTextContent(/run-depth-001/)
    expect(screen.getByRole('status')).toHaveTextContent(/不會重新上傳或重複送出/)
    fireEvent.click(screen.getByRole('button', { name: '恢復查詢同一筆任務（不重複扣費）' }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('已完成的任務 -> 需明確開始另一版本後才可再次付費生成', () => {
    const onResetSubmittedRun = vi.fn()
    render(<DepthRebuildPanel {...buildProps({
      submittedRunId: 'run-depth-002',
      canResume: false,
      hasResult: true,
      canGenerate: false,
      onResetSubmittedRun,
    })} />)

    expect(screen.getByRole('button', { name: '本次重建已完成' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '開始另一個版本' }))
    expect(onResetSubmittedRun).toHaveBeenCalledTimes(1)
  })
})

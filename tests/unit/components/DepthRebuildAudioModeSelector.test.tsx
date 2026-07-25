import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DepthRebuildAudioModeSelector } from '@/app/[locale]/live-composite/DepthRebuildAudioModeSelector'

describe('DepthRebuildAudioModeSelector', () => {
  it('偵測到原片音軌 -> 三種模式都可選，並明確揭露原音不會自動降噪', () => {
    const onChange = vi.fn()
    render(
      <DepthRebuildAudioModeSelector
        value="preserve"
        sourceAudioDetected
        disabled={false}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('已偵測到原片音軌。')).toBeInTheDocument()
    expect(screen.getByText(/不會自動降噪或修復收音/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /只拿原音對口型/ }))
    expect(onChange).toHaveBeenCalledWith('reference-only')
  })

  it('沒有音軌 -> 保留與參考模式停用，仍可明確選擇 AI 重新生成', () => {
    const onChange = vi.fn()
    render(
      <DepthRebuildAudioModeSelector
        value="generate"
        sourceAudioDetected={false}
        disabled={false}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('radio', { name: /保留原始同期聲/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /只拿原音對口型/ })).toBeDisabled()
    const generate = screen.getByRole('radio', { name: /讓 AI 重新生聲音/ })
    expect(generate).toBeEnabled()
    expect(generate).toBeChecked()
  })
})

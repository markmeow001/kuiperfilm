import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DepthSignalRail } from '@/app/[locale]/live-composite/DepthSignalRail'

describe('DepthSignalRail', () => {
  it('三段素材皆存在 -> 依原片、深度、結果順序顯示預覽與下載', () => {
    render(<DepthSignalRail sourceUrl="blob:source" depthUrl="blob:depth" resultUrl="https://example.com/result.mp4" />)

    expect(screen.getByRole('heading', { name: '原始表演 → 深度引導 → AI 重建' })).toBeInTheDocument()
    expect(screen.getByLabelText('原始表演預覽')).toHaveAttribute('src', 'blob:source')
    expect(screen.getByLabelText('深度影片預覽')).toHaveAttribute('src', 'blob:depth')
    expect(screen.getByLabelText('AI 重建預覽')).toHaveAttribute('src', 'https://example.com/result.mp4')
    expect(screen.getByRole('link', { name: '下載深度影片' })).toHaveAttribute('href', 'blob:depth')
    expect(screen.getByRole('link', { name: '下載AI 重建' })).toHaveAttribute('href', 'https://example.com/result.mp4')
  })

  it('尚無深度與結果 -> 顯示下一步指引，不製造黑畫面預覽', () => {
    render(<DepthSignalRail sourceUrl="blob:source" depthUrl={null} resultUrl={null} />)

    expect(screen.getByText('本機產生後顯示黑白空間引導。')).toBeInTheDocument()
    expect(screen.getByText('確認費用並完成生成後顯示。')).toBeInTheDocument()
    expect(screen.queryByLabelText('深度影片預覽')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('AI 重建預覽')).not.toBeInTheDocument()
  })
})

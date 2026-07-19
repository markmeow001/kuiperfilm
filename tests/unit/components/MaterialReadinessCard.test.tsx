import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MaterialReadinessCard } from '@/app/[locale]/live-composite/MaterialReadinessCard'
import type { FacePerformanceTrack } from '@/app/[locale]/live-composite/lib/face-performance'
import type { VideoMetadata } from '@/app/[locale]/live-composite/live-composite-types'

const metadata: VideoMetadata = { width: 1920, height: 1080, duration: 10, name: 'take-01.mp4' }

const fullTrack: FacePerformanceTrack = {
  samples: Array.from({ length: 10 }, (_, index) => ({
    time: index * 0.5,
    faceBox: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 },
    blendshapeSummary: { jawOpen: 0.2 },
  })),
}

describe('MaterialReadinessCard', () => {
  it('未載入影片（metadata=null）-> 不渲染卡片', () => {
    const { container } = render(<MaterialReadinessCard metadata={null} videoHasAudio={null} faceTrack={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('素材全部通過 -> 顯示標題、五個檢查列與「符合規格」判定', () => {
    render(<MaterialReadinessCard metadata={metadata} videoHasAudio={true} faceTrack={fullTrack} />)
    expect(screen.getByText('表演素材體檢報告')).toBeInTheDocument()
    expect(screen.getByText('符合規格')).toBeInTheDocument()
    expect(screen.getByText('時長')).toBeInTheDocument()
    expect(screen.getByText('解析度')).toBeInTheDocument()
    expect(screen.getByText('音訊')).toBeInTheDocument()
    expect(screen.getByText('臉部覆蓋')).toBeInTheDocument()
    expect(screen.getByText('video 2 配額')).toBeInTheDocument()
    expect(screen.getByText('素材符合 Track B／B0 規格，可進入下一步。')).toBeInTheDocument()
  })

  it('尚未跑臉部分析 -> 臉部覆蓋列顯示 unknown 並提示先執行臉部分析', () => {
    render(<MaterialReadinessCard metadata={metadata} videoHasAudio={true} faceTrack={null} />)
    expect(screen.getByText(/尚未執行臉部分析/)).toBeInTheDocument()
    expect(screen.getByText(/尚有 1 項未確認/)).toBeInTheDocument()
    // unknown 不降級：其餘項目通過時仍為「符合規格」。
    expect(screen.getByText('符合規格')).toBeInTheDocument()
  })

  it('時長不足 -> 顯示「不符合規格」與 fail 明細', () => {
    render(
      <MaterialReadinessCard
        metadata={{ ...metadata, duration: 3 }}
        videoHasAudio={false}
        faceTrack={fullTrack}
      />,
    )
    expect(screen.getByText('不符合規格')).toBeInTheDocument()
    expect(screen.getByText(/不足 4 秒，無法生成/)).toBeInTheDocument()
    // 無同期聲同時以 warn 呈現。
    expect(screen.getByText(/無同期聲/)).toBeInTheDocument()
  })

  it('無法偵測音訊（null）-> 音訊列顯示 unknown 提示', () => {
    render(<MaterialReadinessCard metadata={metadata} videoHasAudio={null} faceTrack={fullTrack} />)
    expect(screen.getByText(/無法偵測音訊軌/)).toBeInTheDocument()
  })

  it('參考素材順序（規劃預覽）預設收合，展開後列出 §2.3 映射', () => {
    const { container } = render(<MaterialReadinessCard metadata={metadata} videoHasAudio={true} faceTrack={fullTrack} />)
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details).toHaveProperty('open', false)
    expect(screen.getByText('參考素材順序（規劃預覽）▾')).toBeInTheDocument()
    expect(screen.getByText('video 1')).toBeInTheDocument()
    expect(screen.getByText('主表演影片')).toBeInTheDocument()
    expect(screen.getByText('（本素材）')).toBeInTheDocument()
    expect(screen.getByText('video 2')).toBeInTheDocument()
    expect(screen.getByText('image 6')).toBeInTheDocument()
  })
})

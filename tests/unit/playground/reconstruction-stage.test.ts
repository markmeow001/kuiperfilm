import { describe, expect, it } from 'vitest'
import { getReconstructionStageAvailability } from '@/lib/playground/reconstruction-stage'

describe('live-action reconstruction stage availability', () => {
  it('已上傳影片但未付費分析 -> 立即顯示角色與場景設定，但不可建立定裝幀', () => {
    expect(getReconstructionStageAvailability({
      hasVideo: true,
      hasAnalysis: false,
      hasCharacterReference: false,
      hasKeyframeModel: true,
    })).toEqual({
      showSetup: true,
      canGenerateKeyframe: false,
    })
  })

  it('完成分析並備妥角色與圖片模型 -> 可建立定裝關鍵幀', () => {
    expect(getReconstructionStageAvailability({
      hasVideo: true,
      hasAnalysis: true,
      hasCharacterReference: true,
      hasKeyframeModel: true,
    })).toEqual({
      showSetup: true,
      canGenerateKeyframe: true,
    })
  })

  it('尚未上傳影片 -> 不顯示重建設定', () => {
    expect(getReconstructionStageAvailability({
      hasVideo: false,
      hasAnalysis: false,
      hasCharacterReference: false,
      hasKeyframeModel: false,
    })).toEqual({
      showSetup: false,
      canGenerateKeyframe: false,
    })
  })
})

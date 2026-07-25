import { describe, expect, it } from 'vitest'
import {
  buildDepthGuideSampleTimes,
  DepthGuideRecordingCancelledError,
} from '@/app/[locale]/live-composite/lib/depth-guide-recorder'

describe('深度引導影片取樣計畫', () => {
  it('8 秒、12 fps -> 產生 96 個等距時間且不跳到影片結尾之外', () => {
    const times = buildDepthGuideSampleTimes(8, 12)

    expect(times).toHaveLength(96)
    expect(times[0]).toBe(0)
    expect(times[1]).toBeCloseTo(1 / 12, 6)
    expect(times.at(-1)).toBeLessThan(8)
  })

  it('無效影片長度與過高幀率 -> 明確拒絕', () => {
    expect(() => buildDepthGuideSampleTimes(0, 12)).toThrow('深度影片長度無效')
    expect(() => buildDepthGuideSampleTimes(4, 31)).toThrow('需介於 0–30 fps')
  })

  it('取消錯誤具有可辨識型別與使用者可讀訊息', () => {
    const error = new DepthGuideRecordingCancelledError()

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('DepthGuideRecordingCancelledError')
    expect(error.message).toBe('深度影片建立已取消')
  })
})

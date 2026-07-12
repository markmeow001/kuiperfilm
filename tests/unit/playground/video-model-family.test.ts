import { describe, expect, it } from 'vitest'
import { videoModelFamily } from '@/lib/playground/video-model-family'

describe('videoModelFamily', () => {
  it.each([
    ['atlascloud::kling-o3-std-r2v', 'kling-o3'],
    ['atlascloud::kling-o3-pro-r2v', 'kling-o3'],
    ['atlascloud::seedance-2.0-r2v', 'seedance'],
    ['atlascloud::seedance-2.0-fast-i2v', 'seedance'],
    ['atlascloud::seedance-v1.5-pro', 'seedance'],
    ['atlascloud::wan-2.6', 'seedance'],
    ['fal::bytedance/seedance-2.0/reference-to-video', 'seedance'],
    ['fal::bytedance/seedance-2.0/fast/image-to-video', 'seedance'],
    ['fal::fal-ai/kling-video/v3/pro/image-to-video', 'frames'],
    ['tencent-vod::Kling-3.0-Omni', 'frames'],
    ['minimax::t2v-01', 'frames'],
  ])('%s → %s', (key, family) => {
    expect(videoModelFamily(key)).toBe(family)
  })
})

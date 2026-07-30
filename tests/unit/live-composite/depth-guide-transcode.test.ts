import { describe, expect, it } from 'vitest'
import {
  DEPTH_GUIDE_TRANSCODE_MAX_INPUT_BYTES,
  DepthGuideTranscodeError,
  assertDepthGuideTranscodeInput,
  buildDepthGuideMp4FfmpegArgs,
} from '@/lib/live-composite/depth-guide-transcode'

describe('depth guide webm -> mp4 transcode', () => {
  it('ffmpeg args：去音軌、H.264 yuv420p、faststart、偶數尺寸', () => {
    const args = buildDepthGuideMp4FfmpegArgs('/tmp/in.webm', '/tmp/out.mp4')
    expect(args[0]).toBe('-y')
    expect(args).toContain('/tmp/in.webm')
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
    expect(args).toContain('-an')
    expect(args).toContain('libx264')
    expect(args).toContain('yuv420p')
    expect(args).toContain('+faststart')
    // libx264 需要偶數寬高；瀏覽器錄出的 webm 可能是奇數。
    expect(args.join(' ')).toContain('trunc(iw/2)*2')
  })

  it('空檔案 -> 顯式拒絕', () => {
    expect(() => assertDepthGuideTranscodeInput(0, 'video/webm'))
      .toThrow(DepthGuideTranscodeError)
  })

  it('超過大小上限 -> 顯式拒絕，不吞錯', () => {
    expect(() => assertDepthGuideTranscodeInput(
      DEPTH_GUIDE_TRANSCODE_MAX_INPUT_BYTES + 1,
      'video/webm',
    )).toThrow('上限')
  })

  it('非 webm content-type -> 顯式拒絕', () => {
    expect(() => assertDepthGuideTranscodeInput(1024, 'video/mp4'))
      .toThrow('webm')
  })

  it('合法輸入 -> 通過（含帶 codecs 參數的 content-type）', () => {
    expect(() => assertDepthGuideTranscodeInput(1024, 'video/webm')).not.toThrow()
    expect(() => assertDepthGuideTranscodeInput(1024, 'video/webm;codecs=vp9')).not.toThrow()
  })
})

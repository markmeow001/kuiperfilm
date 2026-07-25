import { beforeEach, describe, expect, it, vi } from 'vitest'

const workerUtilsMock = vi.hoisted(() => ({
  uploadVideoSourceToCos: vi.fn(),
}))

vi.mock('@/lib/workers/utils', () => workerUtilsMock)

import {
  assertAtlasCloudSeedanceReferenceVideo,
  buildSeedanceReferenceFfmpegArgs,
  buildSeedanceReferenceFfprobeArgs,
  isSeedanceReferenceNormalizationModel,
  parseFps,
  parseSeedanceReferenceProbe,
  type SeedanceReferenceVideoProbe,
} from '@/lib/playground/seedance-reference-video'

function validProbe(overrides: Partial<SeedanceReferenceVideoProbe> = {}): SeedanceReferenceVideoProbe {
  return {
    formatNames: ['mov', 'mp4', 'm4a'],
    sizeBytes: 8_000_000,
    durationSec: 12,
    videoCodec: 'h264',
    width: 720,
    height: 1280,
    fps: 24,
    hasAudio: true,
    ...overrides,
  }
}

describe('Seedance reference-video media contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('AtlasCloud Seedance 2.0 R2V 白名單 -> 只接受 Standard 與 Fast 兩個完整 model key', () => {
    expect(isSeedanceReferenceNormalizationModel('atlascloud::seedance-2.0-r2v')).toBe(true)
    expect(isSeedanceReferenceNormalizationModel('atlascloud::seedance-2.0-fast-r2v')).toBe(true)
    expect(isSeedanceReferenceNormalizationModel('atlascloud::seedance-2.0-i2v')).toBe(false)
    expect(isSeedanceReferenceNormalizationModel('fal::bytedance/seedance-2.0/reference-to-video')).toBe(false)
  })

  it('ffprobe 分數影格率 -> 解析成精確數值', () => {
    expect(parseFps('24/1')).toBe(24)
    expect(parseFps('30000/1001')).toBeCloseTo(29.97002997, 7)
  })

  it('ffprobe JSON -> 取得實際容器、H264、尺寸、fps、時間、大小與音軌', () => {
    const probe = parseSeedanceReferenceProbe({
      format: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        duration: '12.000000',
        size: '8000000',
      },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 720,
          height: 1280,
          avg_frame_rate: '24/1',
          r_frame_rate: '24/1',
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    })

    expect(probe).toEqual({
      formatNames: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
      sizeBytes: 8_000_000,
      durationSec: 12,
      videoCodec: 'h264',
      width: 720,
      height: 1280,
      fps: 24,
      hasAudio: true,
    })
  })

  it('橫式來源 -> ffmpeg 使用 argv 轉 H264/24fps/短邊720、可選音軌與 faststart', () => {
    const args = buildSeedanceReferenceFfmpegArgs({
      sourceVideoUrl: 'https://storage.example/depth.webm',
      outputPath: '/tmp/reference.mp4',
      sourceWidth: 1920,
      sourceHeight: 1080,
    })

    expect(args).toEqual([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', 'https://storage.example/depth.webm',
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'fps=24,scale=-2:720',
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-t', '15',
      '-movflags', '+faststart',
      '/tmp/reference.mp4',
    ])
  })

  it('直式來源 -> 短邊固定720且保持原比例', () => {
    const args = buildSeedanceReferenceFfmpegArgs({
      sourceVideoUrl: 'source.mov',
      outputPath: 'output.mp4',
      sourceWidth: 1080,
      sourceHeight: 1920,
    })
    expect(args[args.indexOf('-vf') + 1]).toBe('fps=24,scale=720:-2')
  })

  it('ffprobe 呼叫 -> 只讀契約所需欄位且不使用 shell string', () => {
    expect(buildSeedanceReferenceFfprobeArgs('/tmp/reference.mp4')).toEqual([
      '-v', 'error',
      '-show_entries',
      'format=format_name,duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate',
      '-of', 'json',
      '/tmp/reference.mp4',
    ])
  })

  it('符合 AtlasCloud 邊界 -> 允許 2 秒與 15 秒、24fps、MP4/H264 的 720p 影片', () => {
    expect(() => assertAtlasCloudSeedanceReferenceVideo(validProbe({
      durationSec: 2,
      fps: 24,
      sizeBytes: 50 * 1024 * 1024,
    }))).not.toThrow()
    expect(() => assertAtlasCloudSeedanceReferenceVideo(validProbe({
      durationSec: 15,
    }))).not.toThrow()
  })

  it.each([
    ['WebM 容器', { formatNames: ['matroska', 'webm'] }, 'SEEDANCE_REFERENCE_FORMAT_UNSUPPORTED'],
    ['非 H264', { videoCodec: 'vp9' }, 'SEEDANCE_REFERENCE_CODEC_UNSUPPORTED'],
    ['尺寸小於300', { width: 299 }, 'SEEDANCE_REFERENCE_DIMENSIONS_OUT_OF_RANGE'],
    ['比例大於2.5', { width: 1802, height: 720 }, 'SEEDANCE_REFERENCE_ASPECT_RATIO_OUT_OF_RANGE'],
    ['像素少於409600', { width: 600, height: 600 }, 'SEEDANCE_REFERENCE_PIXEL_COUNT_OUT_OF_RANGE'],
    ['影格率低於24', { fps: 23.99 }, 'SEEDANCE_REFERENCE_FPS_OUT_OF_RANGE'],
    ['時間超過15秒', { durationSec: 15.01 }, 'SEEDANCE_REFERENCE_DURATION_OUT_OF_RANGE'],
    ['檔案超過50MB', { sizeBytes: (50 * 1024 * 1024) + 1 }, 'SEEDANCE_REFERENCE_FILE_SIZE_OUT_OF_RANGE'],
  ])('%s -> 顯式拒絕，不靜默送供應商', (_label, overrides, expectedError) => {
    expect(() => assertAtlasCloudSeedanceReferenceVideo(validProbe(overrides)))
      .toThrow(expectedError)
  })
})

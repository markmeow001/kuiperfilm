import { beforeEach, describe, expect, it, vi } from 'vitest'

const workerUtilsMock = vi.hoisted(() => ({
  uploadVideoSourceToCos: vi.fn(),
}))

const mediaToolMock = vi.hoisted(() => ({
  execFile: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}))

vi.mock('@/lib/workers/utils', () => workerUtilsMock)
vi.mock('node:child_process', () => ({ execFile: mediaToolMock.execFile }))
vi.mock('node:fs/promises', () => ({
  mkdtemp: mediaToolMock.mkdtemp,
  readFile: mediaToolMock.readFile,
  rm: mediaToolMock.rm,
}))

import {
  assertAtlasCloudSeedanceReferenceVideo,
  buildSeedanceReferenceFfmpegArgs,
  buildSeedanceReferenceFfprobeArgs,
  buildSeedanceReferenceSourceFfprobeArgs,
  isSeedanceReferenceNormalizationModel,
  normalizeSeedanceReferenceVideoToCos,
  parseFps,
  parseSeedanceReferenceProbe,
  parseSeedanceReferenceSourceProbe,
  type SeedanceReferenceVideoProbe,
} from '@/lib/playground/seedance-reference-video'

function mediaRecorderWebmProbe() {
  return {
    format: {
      format_name: 'matroska,webm',
      size: '1694826',
    },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'vp9',
        width: 518,
        height: 294,
        avg_frame_rate: '12/1',
        r_frame_rate: '12/1',
      },
      { codec_type: 'audio', codec_name: 'opus' },
    ],
  }
}

function normalizedMp4Probe(overrides: {
  duration?: string | null
  formatName?: string
  codecName?: string
  fps?: string
  size?: string
} = {}) {
  return {
    format: {
      format_name: overrides.formatName ?? 'mov,mp4,m4a,3gp,3g2,mj2',
      size: overrides.size ?? '5',
      ...(overrides.duration === null
        ? {}
        : { duration: overrides.duration ?? '11.000000' }),
    },
    streams: [
      {
        codec_type: 'video',
        codec_name: overrides.codecName ?? 'h264',
        width: 1268,
        height: 720,
        avg_frame_rate: overrides.fps ?? '24/1',
        r_frame_rate: overrides.fps ?? '24/1',
      },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  }
}

function queueMediaToolOutputs(...outputs: readonly unknown[]): void {
  const queue = [...outputs]
  mediaToolMock.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1)
    if (typeof callback !== 'function') throw new Error('execFile callback missing')
    const output = queue.shift()
    if (output === undefined) throw new Error('unexpected media tool call')
    const stdout = typeof output === 'string' ? output : JSON.stringify(output)
    const resolve = callback as (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void
    resolve(null, { stdout, stderr: '' })
  })
}

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
    mediaToolMock.mkdtemp.mockResolvedValue('/tmp/seedance-reference-video-test')
    mediaToolMock.readFile.mockResolvedValue(Buffer.from('video'))
    mediaToolMock.rm.mockResolvedValue(undefined)
    workerUtilsMock.uploadVideoSourceToCos.mockResolvedValue('video/normalized.mp4')
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

  it('MediaRecorder WebM 缺少 duration -> 輸入探測仍取得尺寸，嚴格輸出探測仍拒絕缺秒數影片', () => {
    const mediaRecorderWebm = mediaRecorderWebmProbe()

    expect(parseSeedanceReferenceSourceProbe(mediaRecorderWebm)).toEqual({
      width: 518,
      height: 294,
      durationSec: null,
    })
    expect(() => parseSeedanceReferenceProbe(mediaRecorderWebm))
      .toThrow('SEEDANCE_REFERENCE_PROBE_DURATION_INVALID')
  })

  it.each([
    [
      '沒有 video stream',
      { streams: [{ codec_type: 'audio', codec_name: 'opus' }] },
      'SEEDANCE_REFERENCE_VIDEO_STREAM_MISSING',
    ],
    [
      '缺少寬度',
      { streams: [{ codec_type: 'video', height: 294 }] },
      'SEEDANCE_REFERENCE_PROBE_SOURCE_WIDTH_INVALID',
    ],
    [
      '寬度為 0',
      { streams: [{ codec_type: 'video', width: 0, height: 294 }] },
      'SEEDANCE_REFERENCE_SOURCE_DIMENSIONS_INVALID',
    ],
    [
      '高度為負數',
      { streams: [{ codec_type: 'video', width: 518, height: -1 }] },
      'SEEDANCE_REFERENCE_SOURCE_DIMENSIONS_INVALID',
    ],
    [
      '單邊超過 8192',
      { streams: [{ codec_type: 'video', width: 9000, height: 5000 }] },
      'SEEDANCE_REFERENCE_SOURCE_DIMENSIONS_INVALID',
    ],
    [
      '極端比例',
      { streams: [{ codec_type: 'video', width: 2000, height: 200 }] },
      'SEEDANCE_REFERENCE_SOURCE_ASPECT_RATIO_OUT_OF_RANGE',
    ],
    [
      '來源總像素過高',
      { streams: [{ codec_type: 'video', width: 8192, height: 5000 }] },
      'SEEDANCE_REFERENCE_SOURCE_PIXEL_COUNT_OUT_OF_RANGE',
    ],
    [
      '時長小於 2 秒',
      {
        format: { duration: '1.99' },
        streams: [{ codec_type: 'video', width: 518, height: 294 }],
      },
      'SEEDANCE_REFERENCE_SOURCE_DURATION_OUT_OF_RANGE',
    ],
    [
      '時長超過 15 秒',
      {
        format: { duration: '15.01' },
        streams: [{ codec_type: 'video', width: 518, height: 294 }],
      },
      'SEEDANCE_REFERENCE_SOURCE_DURATION_OUT_OF_RANGE',
    ],
    [
      '時長欄位無效',
      {
        format: { duration: 'N/A' },
        streams: [{ codec_type: 'video', width: 518, height: 294 }],
      },
      'SEEDANCE_REFERENCE_PROBE_SOURCE_DURATION_INVALID',
    ],
  ])('來源 %s -> 在 FFmpeg 前顯式拒絕', (_label, input, expectedError) => {
    expect(() => parseSeedanceReferenceSourceProbe(input)).toThrow(expectedError)
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

  it('來源 ffprobe -> 讀取尺寸與可選 duration，不要求 WebM 一定提供 duration', () => {
    expect(buildSeedanceReferenceSourceFfprobeArgs('/tmp/depth-guide.webm')).toEqual([
      '-v', 'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of', 'json',
      '/tmp/depth-guide.webm',
    ])
  })

  it('線上同型 durationless WebM -> 先讀尺寸、轉 MP4、嚴格驗證後才上傳', async () => {
    queueMediaToolOutputs(
      mediaRecorderWebmProbe(),
      '',
      normalizedMp4Probe(),
    )

    const result = await normalizeSeedanceReferenceVideoToCos({
      sourceVideoUrl: 'https://storage.example/depth-guide.webm',
      taskId: 'task-durationless-webm',
    })

    expect(mediaToolMock.execFile.mock.calls.map((call) => call[0])).toEqual([
      'ffprobe',
      'ffmpeg',
      'ffprobe',
    ])
    expect(mediaToolMock.execFile.mock.calls[0]?.[1]).toEqual(
      buildSeedanceReferenceSourceFfprobeArgs(
        'https://storage.example/depth-guide.webm',
      ),
    )
    expect(mediaToolMock.execFile.mock.calls[1]?.[1]).toEqual(
      buildSeedanceReferenceFfmpegArgs({
        sourceVideoUrl: 'https://storage.example/depth-guide.webm',
        outputPath: '/tmp/seedance-reference-video-test/reference.mp4',
        sourceWidth: 518,
        sourceHeight: 294,
      }),
    )
    expect(mediaToolMock.execFile.mock.calls[2]?.[1]).toEqual(
      buildSeedanceReferenceFfprobeArgs(
        '/tmp/seedance-reference-video-test/reference.mp4',
      ),
    )
    expect(workerUtilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      Buffer.from('video'),
      'playground-runs/seedance-reference',
      'task-durationless-webm',
    )
    expect(result).toEqual({
      cosKey: 'video/normalized.mp4',
      probe: {
        formatNames: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
        sizeBytes: 5,
        durationSec: 11,
        videoCodec: 'h264',
        width: 1268,
        height: 720,
        fps: 24,
        hasAudio: true,
      },
    })
    expect(mediaToolMock.rm).toHaveBeenCalledWith(
      '/tmp/seedance-reference-video-test',
      { recursive: true, force: true },
    )
  })

  it('來源明確超過 15 秒 -> 轉檔與上傳前拒絕，不得靜默截短', async () => {
    queueMediaToolOutputs({
      ...mediaRecorderWebmProbe(),
      format: {
        ...mediaRecorderWebmProbe().format,
        duration: '16.000000',
      },
    })

    await expect(normalizeSeedanceReferenceVideoToCos({
      sourceVideoUrl: 'https://storage.example/too-long-depth-guide.webm',
      taskId: 'task-too-long-source',
    })).rejects.toThrow('SEEDANCE_REFERENCE_SOURCE_DURATION_OUT_OF_RANGE')

    expect(mediaToolMock.execFile).toHaveBeenCalledTimes(1)
    expect(mediaToolMock.mkdtemp).not.toHaveBeenCalled()
    expect(mediaToolMock.readFile).not.toHaveBeenCalled()
    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
  })

  it('正規化輸出仍缺 duration -> 顯式失敗且不得上傳', async () => {
    queueMediaToolOutputs(
      mediaRecorderWebmProbe(),
      '',
      normalizedMp4Probe({ duration: null }),
    )

    await expect(normalizeSeedanceReferenceVideoToCos({
      sourceVideoUrl: 'https://storage.example/depth-guide.webm',
      taskId: 'task-invalid-normalized-output',
    })).rejects.toThrow('SEEDANCE_REFERENCE_PROBE_DURATION_INVALID')

    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
    expect(mediaToolMock.rm).toHaveBeenCalledWith(
      '/tmp/seedance-reference-video-test',
      { recursive: true, force: true },
    )
  })

  it('要求保留原音但正規化輸出沒有音軌 -> 上傳前拒絕並清理暫存檔', async () => {
    const outputWithoutAudio = normalizedMp4Probe()
    outputWithoutAudio.streams = outputWithoutAudio.streams.filter(
      (stream) => stream.codec_type !== 'audio',
    )
    queueMediaToolOutputs(
      mediaRecorderWebmProbe(),
      '',
      outputWithoutAudio,
    )

    await expect(normalizeSeedanceReferenceVideoToCos({
      sourceVideoUrl: 'https://storage.example/depth-guide-with-audio.webm',
      taskId: 'task-audio-required',
      requireAudio: true,
    })).rejects.toThrow('PLAYGROUND_SOURCE_AUDIO_TRACK_MISSING_AFTER_NORMALIZATION')

    expect(mediaToolMock.readFile).not.toHaveBeenCalled()
    expect(workerUtilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
    expect(mediaToolMock.rm).toHaveBeenCalledWith(
      '/tmp/seedance-reference-video-test',
      { recursive: true, force: true },
    )
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

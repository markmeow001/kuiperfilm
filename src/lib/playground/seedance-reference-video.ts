import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { SourceAudioMode } from './source-audio-contract'

const execFileAsync = promisify(execFile)
const MEDIA_TOOL_TIMEOUT_MS = 240_000
const MEDIA_TOOL_MAX_BUFFER = 4 * 1024 * 1024

export const SEEDANCE_REFERENCE_NORMALIZATION_MODEL_KEYS = [
  'atlascloud::seedance-2.0-r2v',
  'atlascloud::seedance-2.0-fast-r2v',
] as const

export type SeedanceReferenceNormalizationModelKey =
  (typeof SEEDANCE_REFERENCE_NORMALIZATION_MODEL_KEYS)[number]

export interface SeedanceReferenceVideoProbe {
  formatNames: string[]
  sizeBytes: number
  durationSec: number
  videoCodec: string
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

export interface SeedanceReferenceSourceProbe {
  width: number
  height: number
  durationSec: number | null
}

interface FfprobeStream {
  codec_type?: unknown
  codec_name?: unknown
  width?: unknown
  height?: unknown
  avg_frame_rate?: unknown
  r_frame_rate?: unknown
}

interface FfprobePayload {
  format?: {
    format_name?: unknown
    duration?: unknown
    size?: unknown
  }
  streams?: FfprobeStream[]
}

const MIN_DIMENSION = 300
const MAX_DIMENSION = 6000
const MIN_ASPECT_RATIO = 0.4
const MAX_ASPECT_RATIO = 2.5
const MIN_PIXELS = 409_600
const MAX_PIXELS = 2_086_876
const MAX_SOURCE_DIMENSION = 8192
const MAX_SOURCE_PIXELS = 7680 * 4320
const MIN_FPS = 24
const MAX_FPS = 60
const MIN_DURATION_SEC = 2
const MAX_DURATION_SEC = 15
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

export function isSeedanceReferenceNormalizationModel(
  modelKey: string,
): modelKey is SeedanceReferenceNormalizationModelKey {
  return SEEDANCE_REFERENCE_NORMALIZATION_MODEL_KEYS.some((allowed) => allowed === modelKey)
}

function parseFiniteNumber(value: unknown, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`SEEDANCE_REFERENCE_PROBE_${fieldName.toUpperCase()}_INVALID`)
  }
  return parsed
}

export function parseFps(value: unknown): number {
  if (typeof value === 'number') return parseFiniteNumber(value, 'fps')
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('SEEDANCE_REFERENCE_PROBE_FPS_INVALID')
  }
  const [numeratorText, denominatorText] = value.split('/')
  const numerator = Number(numeratorText)
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    throw new Error('SEEDANCE_REFERENCE_PROBE_FPS_INVALID')
  }
  return numerator / denominator
}

export function parseSeedanceReferenceProbe(raw: unknown): SeedanceReferenceVideoProbe {
  if (!raw || typeof raw !== 'object') {
    throw new Error('SEEDANCE_REFERENCE_PROBE_INVALID')
  }
  const payload = raw as FfprobePayload
  const streams = Array.isArray(payload.streams) ? payload.streams : []
  const video = streams.find((stream) => stream.codec_type === 'video')
  if (!video) throw new Error('SEEDANCE_REFERENCE_VIDEO_STREAM_MISSING')

  const formatName = typeof payload.format?.format_name === 'string'
    ? payload.format.format_name
    : ''
  const width = parseFiniteNumber(video.width, 'width')
  const height = parseFiniteNumber(video.height, 'height')
  const fpsSource = typeof video.avg_frame_rate === 'string' && video.avg_frame_rate !== '0/0'
    ? video.avg_frame_rate
    : video.r_frame_rate

  return {
    formatNames: formatName.split(',').map((name) => name.trim()).filter(Boolean),
    sizeBytes: parseFiniteNumber(payload.format?.size, 'size'),
    durationSec: parseFiniteNumber(payload.format?.duration, 'duration'),
    videoCodec: typeof video.codec_name === 'string' ? video.codec_name : '',
    width,
    height,
    fps: parseFps(fpsSource),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  }
}

/**
 * Browser MediaRecorder WebM files can omit container-level duration metadata.
 * The source pass only needs dimensions for the deterministic FFmpeg scale;
 * the normalized MP4 is still checked with the full provider contract below.
 */
export function parseSeedanceReferenceSourceProbe(raw: unknown): SeedanceReferenceSourceProbe {
  if (!raw || typeof raw !== 'object') {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_PROBE_INVALID')
  }
  const payload = raw as FfprobePayload
  const streams = Array.isArray(payload.streams) ? payload.streams : []
  const video = streams.find((stream) => stream.codec_type === 'video')
  if (!video) throw new Error('SEEDANCE_REFERENCE_VIDEO_STREAM_MISSING')

  const width = parseFiniteNumber(video.width, 'source_width')
  const height = parseFiniteNumber(video.height, 'source_height')
  if (
    width <= 0
    || height <= 0
    || width > MAX_SOURCE_DIMENSION
    || height > MAX_SOURCE_DIMENSION
  ) {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_DIMENSIONS_INVALID')
  }
  const aspectRatio = width / height
  if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_ASPECT_RATIO_OUT_OF_RANGE')
  }
  if (width * height > MAX_SOURCE_PIXELS) {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_PIXEL_COUNT_OUT_OF_RANGE')
  }
  const durationSec = payload.format?.duration === undefined
    ? null
    : parseFiniteNumber(payload.format.duration, 'source_duration')
  if (
    durationSec !== null
    && (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC)
  ) {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_DURATION_OUT_OF_RANGE')
  }
  return { width, height, durationSec }
}

export function assertAtlasCloudSeedanceReferenceVideo(
  probe: SeedanceReferenceVideoProbe,
): void {
  const isMp4OrMov = probe.formatNames.some((name) => name === 'mp4' || name === 'mov')
  if (!isMp4OrMov) throw new Error('SEEDANCE_REFERENCE_FORMAT_UNSUPPORTED')
  if (probe.videoCodec !== 'h264') throw new Error('SEEDANCE_REFERENCE_CODEC_UNSUPPORTED')
  if (
    probe.width < MIN_DIMENSION
    || probe.width > MAX_DIMENSION
    || probe.height < MIN_DIMENSION
    || probe.height > MAX_DIMENSION
  ) {
    throw new Error('SEEDANCE_REFERENCE_DIMENSIONS_OUT_OF_RANGE')
  }
  const aspectRatio = probe.width / probe.height
  if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) {
    throw new Error('SEEDANCE_REFERENCE_ASPECT_RATIO_OUT_OF_RANGE')
  }
  const pixels = probe.width * probe.height
  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS) {
    throw new Error('SEEDANCE_REFERENCE_PIXEL_COUNT_OUT_OF_RANGE')
  }
  if (probe.fps < MIN_FPS || probe.fps > MAX_FPS) {
    throw new Error('SEEDANCE_REFERENCE_FPS_OUT_OF_RANGE')
  }
  if (probe.durationSec < MIN_DURATION_SEC || probe.durationSec > MAX_DURATION_SEC) {
    throw new Error('SEEDANCE_REFERENCE_DURATION_OUT_OF_RANGE')
  }
  if (probe.sizeBytes <= 0 || probe.sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new Error('SEEDANCE_REFERENCE_FILE_SIZE_OUT_OF_RANGE')
  }
}

export function buildSeedanceReferenceFfmpegArgs(input: {
  sourceVideoUrl: string
  outputPath: string
  sourceWidth: number
  sourceHeight: number
  includeAudio?: boolean
}): string[] {
  if (input.sourceWidth <= 0 || input.sourceHeight <= 0) {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_DIMENSIONS_INVALID')
  }
  const scale = input.sourceWidth >= input.sourceHeight ? '-2:720' : '720:-2'
  const audioMapArgs = input.includeAudio === false ? [] : ['-map', '0:a:0?']
  const audioCodecArgs = input.includeAudio === false
    ? ['-an']
    : ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input.sourceVideoUrl,
    '-map', '0:v:0', ...audioMapArgs,
    '-vf', `fps=24,scale=${scale}`,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-preset', 'medium', '-crf', '20',
    ...audioCodecArgs,
    '-t', String(MAX_DURATION_SEC),
    '-movflags', '+faststart',
    input.outputPath,
  ]
}

export function buildSeedanceReferenceFfprobeArgs(source: string): string[] {
  return [
    '-v', 'error',
    '-show_entries',
    'format=format_name,duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate',
    '-of', 'json',
    source,
  ]
}

export function buildSeedanceReferenceSourceFfprobeArgs(source: string): string[] {
  return [
    '-v', 'error',
    '-show_entries',
    'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    source,
  ]
}

async function probeReferenceVideoSource(source: string): Promise<SeedanceReferenceSourceProbe> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    buildSeedanceReferenceSourceFfprobeArgs(source),
    { timeout: MEDIA_TOOL_TIMEOUT_MS, maxBuffer: MEDIA_TOOL_MAX_BUFFER },
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_FFPROBE_JSON_INVALID')
  }
  return parseSeedanceReferenceSourceProbe(parsed)
}

async function probeReferenceVideo(source: string): Promise<SeedanceReferenceVideoProbe> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    buildSeedanceReferenceFfprobeArgs(source),
    { timeout: MEDIA_TOOL_TIMEOUT_MS, maxBuffer: MEDIA_TOOL_MAX_BUFFER },
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('SEEDANCE_REFERENCE_FFPROBE_JSON_INVALID')
  }
  return parseSeedanceReferenceProbe(parsed)
}

export async function normalizeSeedanceReferenceVideoToCos(input: {
  sourceVideoUrl: string
  taskId: string
  requireAudio?: boolean
  sourceAudioMode?: SourceAudioMode
}): Promise<{
  cosKey: string
  probe: SeedanceReferenceVideoProbe
}> {
  if (input.sourceAudioMode === 'generate' && input.requireAudio === true) {
    throw new Error('PLAYGROUND_SOURCE_AUDIO_MODE_NORMALIZATION_CONFLICT')
  }
  const includeAudio = input.sourceAudioMode !== 'generate'
  const requireAudio = input.requireAudio === true
    || input.sourceAudioMode === 'preserve'
    || input.sourceAudioMode === 'reference-only'
  const sourceProbe = await probeReferenceVideoSource(input.sourceVideoUrl)
  const dir = await mkdtemp(path.join(tmpdir(), 'seedance-reference-video-'))
  const outputPath = path.join(dir, 'reference.mp4')
  try {
    await execFileAsync(
      'ffmpeg',
      buildSeedanceReferenceFfmpegArgs({
        sourceVideoUrl: input.sourceVideoUrl,
        outputPath,
        sourceWidth: sourceProbe.width,
        sourceHeight: sourceProbe.height,
        includeAudio,
      }),
      { timeout: MEDIA_TOOL_TIMEOUT_MS, maxBuffer: MEDIA_TOOL_MAX_BUFFER },
    )
    const normalizedProbe = await probeReferenceVideo(outputPath)
    assertAtlasCloudSeedanceReferenceVideo(normalizedProbe)
    if (requireAudio && !normalizedProbe.hasAudio) {
      throw new Error('PLAYGROUND_SOURCE_AUDIO_TRACK_MISSING_AFTER_NORMALIZATION')
    }
    if (input.sourceAudioMode === 'generate' && normalizedProbe.hasAudio) {
      throw new Error('PLAYGROUND_SOURCE_AUDIO_TRACK_PRESENT_AFTER_NORMALIZATION')
    }
    const video = await readFile(outputPath)
    if (video.length !== normalizedProbe.sizeBytes || video.length === 0) {
      throw new Error('SEEDANCE_REFERENCE_NORMALIZED_SIZE_MISMATCH')
    }
    const { uploadVideoSourceToCos } = await import('@/lib/workers/utils')
    const cosKey = await uploadVideoSourceToCos(
      video,
      'playground-runs/seedance-reference',
      input.taskId,
    )
    return { cosKey, probe: normalizedProbe }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

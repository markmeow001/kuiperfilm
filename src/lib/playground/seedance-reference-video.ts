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

export interface SeedanceReferenceTargetDimensions {
  width: number
  height: number
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
const MIN_TRIM_DURATION_SEC = 2
const MAX_OUTPUT_ID_LENGTH = 64
const TRIM_DURATION_TOLERANCE_SEC = 0.125

export const DEPTH_REBUILD_GUIDE_CONTRACT_VERSION = 2 as const
export const DEPTH_REBUILD_GUIDE_HARD_REFERENCE_LIMIT_SEC = 15
export const DEPTH_REBUILD_GUIDE_DUAL_REFERENCE_SAFE_LIMIT_SEC = 14.5
export const DEPTH_REBUILD_GUIDE_MIN_SOURCE_DURATION_SEC = 4
export const DEPTH_REBUILD_GUIDE_MAX_SOURCE_DURATION_SEC = 15
export const DEPTH_REBUILD_GUIDE_MIN_REFERENCE_DURATION_SEC = 2
// Three 24fps frames. This absorbs normal container timestamp/frame rounding
// without allowing a materially shorter or longer source to masquerade as the
// immutable guide duration.
export const DEPTH_REBUILD_GUIDE_SOURCE_DURATION_TOLERANCE_SEC = 0.125

function assertSeedanceReferenceSourceDimensions(
  width: number,
  height: number,
): void {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
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
}

function assertSeedanceReferenceTargetDimensions(
  dimensions: SeedanceReferenceTargetDimensions,
): void {
  const { width, height } = dimensions
  const aspectRatio = width / height
  const pixels = width * height
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width % 2 !== 0
    || height % 2 !== 0
    || width < MIN_DIMENSION
    || width > MAX_DIMENSION
    || height < MIN_DIMENSION
    || height > MAX_DIMENSION
    || aspectRatio < MIN_ASPECT_RATIO
    || aspectRatio > MAX_ASPECT_RATIO
    || pixels < MIN_PIXELS
    || pixels > MAX_PIXELS
  ) {
    throw new Error('SEEDANCE_REFERENCE_TARGET_DIMENSIONS_INVALID')
  }
}

/**
 * Resolve one deterministic AtlasCloud-safe frame size from the original RGB.
 * Adaptive Depth Rebuild passes this same size to both reference encodes so
 * small browser-capture aspect-ratio differences cannot create 1268x720 vs
 * 1280x720 provider inputs.
 */
export function resolveSeedanceReferenceTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
): SeedanceReferenceTargetDimensions {
  assertSeedanceReferenceSourceDimensions(sourceWidth, sourceHeight)
  const dimensions = sourceWidth >= sourceHeight
    ? {
        width: Math.round((sourceWidth / sourceHeight) * 360) * 2,
        height: 720,
      }
    : {
        width: 720,
        height: Math.round((sourceHeight / sourceWidth) * 360) * 2,
      }
  assertSeedanceReferenceTargetDimensions(dimensions)
  return dimensions
}

export type DepthRebuildGuideStrategyV2 =
  | 'full-depth-full-rgb'
  | 'full-depth-critical-rgb'
  | 'full-depth-only'

export interface DepthRebuildGuideReferenceWindowV2 {
  role: 'depth' | 'rgb'
  startSeconds: number
  durationSeconds: number
}

export interface DepthRebuildGuideContractV2 {
  version: typeof DEPTH_REBUILD_GUIDE_CONTRACT_VERSION
  strategy: DepthRebuildGuideStrategyV2
  sourceVideoKey: string
  sourceDurationSeconds: number
  outputDurationSeconds: number
  referenceVideoWindows: DepthRebuildGuideReferenceWindowV2[]
}

export interface SeedanceReferenceVideoTrim {
  startSeconds: number
  durationSeconds: number
}

function depthRebuildGuideNumbersEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.001
}

function parseDepthRebuildGuideWindowV2(
  value: unknown,
  index: number,
  sourceDurationSeconds: number,
): DepthRebuildGuideReferenceWindowV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_WINDOW_INVALID')
  }
  const record = value as Record<string, unknown>
  const expectedRole = index === 0 ? 'depth' : 'rgb'
  if (record.role !== expectedRole) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_ORDER_INVALID')
  }
  const startSeconds = record.startSeconds
  const durationSeconds = record.durationSeconds
  if (
    typeof startSeconds !== 'number'
    || !Number.isFinite(startSeconds)
    || startSeconds < 0
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_START_INVALID')
  }
  if (
    typeof durationSeconds !== 'number'
    || !Number.isFinite(durationSeconds)
    || durationSeconds < DEPTH_REBUILD_GUIDE_MIN_REFERENCE_DURATION_SEC
    || durationSeconds > DEPTH_REBUILD_GUIDE_HARD_REFERENCE_LIMIT_SEC
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_DURATION_INVALID')
  }
  if (startSeconds + durationSeconds > sourceDurationSeconds + 0.001) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_WINDOW_EXCEEDS_SOURCE')
  }
  return { role: expectedRole, startSeconds, durationSeconds }
}

/**
 * Parse the immutable adaptive Depth Rebuild guide contract.
 *
 * This is intentionally shared by the HTTP boundary and the worker: the
 * route rejects malformed requests before billing, while the worker repeats
 * the validation because queued payloads are an independent trust boundary.
 */
export function parseDepthRebuildGuideContractV2(
  value: unknown,
): DepthRebuildGuideContractV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DEPTH_REBUILD_GUIDE_CONTRACT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (record.version !== DEPTH_REBUILD_GUIDE_CONTRACT_VERSION) {
    throw new Error('DEPTH_REBUILD_GUIDE_VERSION_UNSUPPORTED')
  }
  const strategy = record.strategy
  if (
    strategy !== 'full-depth-full-rgb'
    && strategy !== 'full-depth-critical-rgb'
    && strategy !== 'full-depth-only'
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_STRATEGY_INVALID')
  }
  const sourceVideoKey = typeof record.sourceVideoKey === 'string'
    ? record.sourceVideoKey.trim()
    : ''
  if (!sourceVideoKey) {
    throw new Error('DEPTH_REBUILD_GUIDE_SOURCE_VIDEO_KEY_REQUIRED')
  }
  const sourceDurationSeconds = record.sourceDurationSeconds
  if (
    typeof sourceDurationSeconds !== 'number'
    || !Number.isFinite(sourceDurationSeconds)
    || sourceDurationSeconds < DEPTH_REBUILD_GUIDE_MIN_SOURCE_DURATION_SEC
    || sourceDurationSeconds > DEPTH_REBUILD_GUIDE_MAX_SOURCE_DURATION_SEC
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_SOURCE_DURATION_INVALID')
  }
  const outputDurationSeconds = record.outputDurationSeconds
  if (
    typeof outputDurationSeconds !== 'number'
    || !Number.isInteger(outputDurationSeconds)
    || outputDurationSeconds < DEPTH_REBUILD_GUIDE_MIN_SOURCE_DURATION_SEC
    || outputDurationSeconds > DEPTH_REBUILD_GUIDE_MAX_SOURCE_DURATION_SEC
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_OUTPUT_DURATION_INVALID')
  }
  if (outputDurationSeconds !== Math.ceil(sourceDurationSeconds)) {
    throw new Error('DEPTH_REBUILD_GUIDE_OUTPUT_DURATION_MISMATCH')
  }
  if (!Array.isArray(record.referenceVideoWindows)) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_WINDOWS_INVALID')
  }
  const expectedReferenceCount = strategy === 'full-depth-only' ? 1 : 2
  if (record.referenceVideoWindows.length !== expectedReferenceCount) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_COUNT_INVALID')
  }
  const referenceVideoWindows = record.referenceVideoWindows.map((window, index) => (
    parseDepthRebuildGuideWindowV2(window, index, sourceDurationSeconds)
  ))
  const depthWindow = referenceVideoWindows[0]
  if (
    !depthWindow
    || depthWindow.role !== 'depth'
    || !depthRebuildGuideNumbersEqual(depthWindow.startSeconds, 0)
    || !depthRebuildGuideNumbersEqual(
      depthWindow.durationSeconds,
      sourceDurationSeconds,
    )
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_FULL_DEPTH_REQUIRED')
  }
  const rgbWindow = referenceVideoWindows[1]
  if (strategy === 'full-depth-full-rgb') {
    if (
      !rgbWindow
      || !depthRebuildGuideNumbersEqual(rgbWindow.startSeconds, 0)
      || !depthRebuildGuideNumbersEqual(
        rgbWindow.durationSeconds,
        sourceDurationSeconds,
      )
    ) {
      throw new Error('DEPTH_REBUILD_GUIDE_FULL_RGB_REQUIRED')
    }
  }
  if (
    strategy === 'full-depth-critical-rgb'
    && (!rgbWindow || rgbWindow.durationSeconds >= sourceDurationSeconds)
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_CRITICAL_RGB_WINDOW_INVALID')
  }
  const totalReferenceSeconds = referenceVideoWindows.reduce(
    (sum, window) => sum + window.durationSeconds,
    0,
  )
  if (totalReferenceSeconds > DEPTH_REBUILD_GUIDE_HARD_REFERENCE_LIMIT_SEC + 0.001) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_TOTAL_OVER_HARD_LIMIT')
  }
  if (
    referenceVideoWindows.length === 2
    && totalReferenceSeconds
      > DEPTH_REBUILD_GUIDE_DUAL_REFERENCE_SAFE_LIMIT_SEC + 0.001
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_TOTAL_OVER_SAFE_LIMIT')
  }
  return {
    version: DEPTH_REBUILD_GUIDE_CONTRACT_VERSION,
    strategy,
    sourceVideoKey,
    sourceDurationSeconds,
    outputDurationSeconds,
    referenceVideoWindows,
  }
}

export function assertDepthRebuildGuideReferenceBindingsV2(
  contract: DepthRebuildGuideContractV2,
  referenceVideos: readonly string[],
): void {
  if (referenceVideos.length !== contract.referenceVideoWindows.length) {
    throw new Error('DEPTH_REBUILD_GUIDE_REFERENCE_COUNT_INVALID')
  }
  const depthVideoKey = referenceVideos[0]
  if (!depthVideoKey || depthVideoKey === contract.sourceVideoKey) {
    throw new Error('DEPTH_REBUILD_GUIDE_DEPTH_REFERENCE_INVALID')
  }
  if (
    contract.referenceVideoWindows.length === 2
    && referenceVideos[1] !== contract.sourceVideoKey
  ) {
    throw new Error('DEPTH_REBUILD_GUIDE_RGB_REFERENCE_MUST_MATCH_SOURCE')
  }
}

export function isSeedanceReferenceNormalizationModel(
  modelKey: string,
): modelKey is SeedanceReferenceNormalizationModelKey {
  return SEEDANCE_REFERENCE_NORMALIZATION_MODEL_KEYS.some((allowed) => allowed === modelKey)
}

function assertSeedanceReferenceOutputId(outputId: string): void {
  const isSafe = outputId.length <= MAX_OUTPUT_ID_LENGTH
    && /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(outputId)
  if (!isSafe) {
    throw new Error('SEEDANCE_REFERENCE_OUTPUT_ID_INVALID')
  }
}

export function assertSeedanceReferenceVideoTrim(
  trim: SeedanceReferenceVideoTrim,
): void {
  if (!Number.isFinite(trim.startSeconds) || trim.startSeconds < 0) {
    throw new Error('SEEDANCE_REFERENCE_TRIM_START_INVALID')
  }
  if (
    !Number.isFinite(trim.durationSeconds)
    || trim.durationSeconds < MIN_TRIM_DURATION_SEC
    || trim.durationSeconds > MAX_DURATION_SEC
  ) {
    throw new Error('SEEDANCE_REFERENCE_TRIM_DURATION_INVALID')
  }
  const endSeconds = trim.startSeconds + trim.durationSeconds
  if (!Number.isFinite(endSeconds) || endSeconds > MAX_DURATION_SEC) {
    throw new Error('SEEDANCE_REFERENCE_TRIM_RANGE_OUT_OF_RANGE')
  }
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
  assertSeedanceReferenceSourceDimensions(width, height)
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
  trim?: SeedanceReferenceVideoTrim
  targetDimensions?: SeedanceReferenceTargetDimensions
}): string[] {
  if (input.sourceWidth <= 0 || input.sourceHeight <= 0) {
    throw new Error('SEEDANCE_REFERENCE_SOURCE_DIMENSIONS_INVALID')
  }
  if (input.trim) assertSeedanceReferenceVideoTrim(input.trim)
  if (input.targetDimensions) {
    assertSeedanceReferenceTargetDimensions(input.targetDimensions)
  }
  const scale = input.targetDimensions
    ? `${input.targetDimensions.width}:${input.targetDimensions.height}`
    : input.sourceWidth >= input.sourceHeight ? '-2:720' : '720:-2'
  const audioMapArgs = input.includeAudio === false ? [] : ['-map', '0:a:0?']
  const audioCodecArgs = input.includeAudio === false
    ? ['-an']
    : ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
  const trimArgs = input.trim
    ? ['-ss', String(input.trim.startSeconds), '-t', String(input.trim.durationSeconds)]
    : []
  const videoFilter = input.trim
    ? `fps=24,scale=${scale},setpts=PTS-STARTPTS`
    : `fps=24,scale=${scale}`
  const audioTimestampArgs = input.trim && input.includeAudio !== false
    ? ['-af', 'asetpts=PTS-STARTPTS']
    : []
  const outputTimestampArgs = input.trim
    ? ['-avoid_negative_ts', 'make_zero']
    : ['-t', String(MAX_DURATION_SEC)]
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input.sourceVideoUrl,
    ...trimArgs,
    '-map', '0:v:0', ...audioMapArgs,
    '-vf', videoFilter,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-preset', 'medium', '-crf', '20',
    ...audioCodecArgs,
    ...audioTimestampArgs,
    ...outputTimestampArgs,
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

export async function probeSeedanceReferenceVideoSource(
  source: string,
): Promise<SeedanceReferenceSourceProbe> {
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
  trim?: SeedanceReferenceVideoTrim
  outputId?: string
  targetDimensions?: SeedanceReferenceTargetDimensions
}): Promise<{
  cosKey: string
  probe: SeedanceReferenceVideoProbe
  sourceProbe: SeedanceReferenceSourceProbe
}> {
  if (input.outputId !== undefined) {
    assertSeedanceReferenceOutputId(input.outputId)
  }
  if (input.trim) assertSeedanceReferenceVideoTrim(input.trim)
  if (input.sourceAudioMode === 'generate' && input.requireAudio === true) {
    throw new Error('PLAYGROUND_SOURCE_AUDIO_MODE_NORMALIZATION_CONFLICT')
  }
  const includeAudio = input.sourceAudioMode !== 'generate'
  const requireAudio = input.requireAudio === true
    || input.sourceAudioMode === 'preserve'
    || input.sourceAudioMode === 'reference-only'
  const sourceProbe = await probeSeedanceReferenceVideoSource(input.sourceVideoUrl)
  if (
    input.trim
    && sourceProbe.durationSec !== null
    && input.trim.startSeconds + input.trim.durationSeconds
      > sourceProbe.durationSec + TRIM_DURATION_TOLERANCE_SEC
  ) {
    throw new Error('SEEDANCE_REFERENCE_TRIM_EXCEEDS_SOURCE_DURATION')
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'seedance-reference-video-'))
  const outputPath = path.join(
    dir,
    input.outputId ? `reference-${input.outputId}.mp4` : 'reference.mp4',
  )
  try {
    await execFileAsync(
      'ffmpeg',
      buildSeedanceReferenceFfmpegArgs({
        sourceVideoUrl: input.sourceVideoUrl,
        outputPath,
        sourceWidth: sourceProbe.width,
        sourceHeight: sourceProbe.height,
        includeAudio,
        trim: input.trim,
        ...(input.targetDimensions
          ? { targetDimensions: input.targetDimensions }
          : {}),
      }),
      { timeout: MEDIA_TOOL_TIMEOUT_MS, maxBuffer: MEDIA_TOOL_MAX_BUFFER },
    )
    const normalizedProbe = await probeReferenceVideo(outputPath)
    assertAtlasCloudSeedanceReferenceVideo(normalizedProbe)
    if (
      input.targetDimensions
      && (
        normalizedProbe.width !== input.targetDimensions.width
        || normalizedProbe.height !== input.targetDimensions.height
      )
    ) {
      throw new Error('SEEDANCE_REFERENCE_TARGET_DIMENSIONS_MISMATCH')
    }
    if (
      input.trim
      && Math.abs(normalizedProbe.durationSec - input.trim.durationSeconds)
        > TRIM_DURATION_TOLERANCE_SEC
    ) {
      throw new Error('SEEDANCE_REFERENCE_TRIM_DURATION_MISMATCH')
    }
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
      input.outputId ? `${input.taskId}-${input.outputId}` : input.taskId,
    )
    return { cosKey, probe: normalizedProbe, sourceProbe }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

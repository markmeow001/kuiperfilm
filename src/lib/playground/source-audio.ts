import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { uploadAudioSourceToCos } from '@/lib/workers/utils'

const execFileAsync = promisify(execFile)
const FFMPEG_TIMEOUT_MS = 120_000
const GENERATED_VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000
const GENERATED_VIDEO_MAX_BYTES = 256 * 1024 * 1024

async function downloadGeneratedVideoToFile(input: {
  generatedVideoUrl: string
  generatedDownloadHeaders?: Record<string, string>
  outputPath: string
}): Promise<void> {
  const response = await fetch(input.generatedVideoUrl, {
    headers: input.generatedDownloadHeaders,
    signal: AbortSignal.timeout(GENERATED_VIDEO_DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok || !response.body) {
    throw new Error(`PLAYGROUND_GENERATED_VIDEO_DOWNLOAD_FAILED: ${response.status}`)
  }
  const declaredBytes = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredBytes) && declaredBytes > GENERATED_VIDEO_MAX_BYTES) {
    throw new Error('PLAYGROUND_GENERATED_VIDEO_TOO_LARGE')
  }
  let receivedBytes = 0
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength
      if (receivedBytes > GENERATED_VIDEO_MAX_BYTES) {
        throw new Error('PLAYGROUND_GENERATED_VIDEO_TOO_LARGE')
      }
      controller.enqueue(chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body.pipeThrough(limiter) as never),
    createWriteStream(input.outputPath),
  )
  if (receivedBytes === 0) {
    throw new Error('PLAYGROUND_GENERATED_VIDEO_EMPTY')
  }
}

export function buildReferenceAudioFfmpegArgs(
  sourceVideoUrl: string,
  outputPath: string,
): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', sourceVideoUrl,
    '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k',
    '-ar', '48000', outputPath,
  ]
}

export async function extractReferenceAudioToCos(
  sourceVideoUrl: string,
  taskId: string,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'playground-source-audio-'))
  const output = path.join(dir, 'reference.mp3')
  try {
    await execFileAsync(
      'ffmpeg',
      buildReferenceAudioFfmpegArgs(sourceVideoUrl, output),
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    )
    const audio = await readFile(output)
    if (audio.length === 0) throw new Error('PLAYGROUND_SOURCE_AUDIO_EMPTY')
    return await uploadAudioSourceToCos(audio, 'playground-runs/source-audio', taskId)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function buildStripGeneratedAudioFfmpegArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-map', '0:v:0', '-c:v', 'copy', '-an',
    '-movflags', '+faststart', outputPath,
  ]
}

export async function stripGeneratedVideoAudio(input: {
  generatedVideoUrl: string
  generatedDownloadHeaders?: Record<string, string>
}): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'playground-audio-strip-'))
  const generatedPath = path.join(dir, 'generated.mp4')
  const outputPath = path.join(dir, 'silent.mp4')
  try {
    await downloadGeneratedVideoToFile({
      ...input,
      outputPath: generatedPath,
    })
    await execFileAsync(
      'ffmpeg',
      buildStripGeneratedAudioFfmpegArgs(generatedPath, outputPath),
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    )
    const output = await readFile(outputPath)
    if (output.length === 0) throw new Error('PLAYGROUND_AUDIO_STRIP_EMPTY')
    return output
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function muxGeneratedVideoWithSourceAudio(input: {
  generatedVideoUrl: string
  generatedDownloadHeaders?: Record<string, string>
  sourceVideoUrl: string
}): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'playground-audio-mux-'))
  const generatedPath = path.join(dir, 'generated.mp4')
  const outputPath = path.join(dir, 'final.mp4')
  try {
    await downloadGeneratedVideoToFile({
      generatedVideoUrl: input.generatedVideoUrl,
      generatedDownloadHeaders: input.generatedDownloadHeaders,
      outputPath: generatedPath,
    })
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', generatedPath, '-i', input.sourceVideoUrl,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart', outputPath,
    ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
    const output = await readFile(outputPath)
    if (output.length === 0) throw new Error('PLAYGROUND_AUDIO_MUX_EMPTY')
    return output
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

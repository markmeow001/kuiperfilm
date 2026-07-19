import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { uploadAudioSourceToCos } from '@/lib/workers/utils'

const execFileAsync = promisify(execFile)
const FFMPEG_TIMEOUT_MS = 120_000

export async function extractReferenceAudioToCos(
  sourceVideoUrl: string,
  taskId: string,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'playground-source-audio-'))
  const output = path.join(dir, 'reference.m4a')
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', sourceVideoUrl,
      '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', output,
    ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
    const audio = await readFile(output)
    if (audio.length === 0) throw new Error('PLAYGROUND_SOURCE_AUDIO_EMPTY')
    return await uploadAudioSourceToCos(audio, 'playground-runs/source-audio', taskId)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
export async function muxGeneratedVideoWithSourceAudio(input: {
  generatedVideoUrl: string
  generatedDownloadHeaders?: Record<string, string>
  sourceVideoUrl: string
}): Promise<Buffer> {
  const response = await fetch(input.generatedVideoUrl, {
    headers: input.generatedDownloadHeaders,
  })
  if (!response.ok) {
    throw new Error(`PLAYGROUND_GENERATED_VIDEO_DOWNLOAD_FAILED: ${response.status}`)
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'playground-audio-mux-'))
  const generatedPath = path.join(dir, 'generated.mp4')
  const outputPath = path.join(dir, 'final.mp4')
  try {
    await writeFile(generatedPath, Buffer.from(await response.arrayBuffer()))
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

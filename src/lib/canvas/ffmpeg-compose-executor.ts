import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { generateUniqueKey, getSignedUrl, uploadToCOS } from '@/lib/cos'
import { CANVAS_COMPOSE_LIMITS, type CanvasComposeExecutor, type CanvasComposeExecutorInput } from './compose-contract'

const execFileAsync = promisify(execFile)
const EXEC_TIMEOUT_MS = 15 * 60 * 1000

export function buildComposeFilter(durations: number[], transition: 'cut' | 'crossfade', crossfadeSec: number): string {
  const normalize = durations.map((_, index) => `[${index}:v]scale=${CANVAS_COMPOSE_LIMITS.width}:${CANVAS_COMPOSE_LIMITS.height}:force_original_aspect_ratio=decrease,pad=${CANVAS_COMPOSE_LIMITS.width}:${CANVAS_COMPOSE_LIMITS.height}:(ow-iw)/2:(oh-ih)/2,fps=${CANVAS_COMPOSE_LIMITS.fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`)
  if (transition === 'cut' || durations.length === 1) {
    return `${normalize.join(';')};${durations.map((_, index) => `[v${index}]`).join('')}concat=n=${durations.length}:v=1:a=0[outv]`
  }
  const chain: string[] = []
  let elapsed = durations[0]
  let previous = 'v0'
  for (let index = 1; index < durations.length; index++) {
    const output = index === durations.length - 1 ? 'outv' : `x${index}`
    const offset = Math.max(0, elapsed - crossfadeSec * index)
    chain.push(`[${previous}][v${index}]xfade=transition=fade:duration=${crossfadeSec}:offset=${offset.toFixed(3)}[${output}]`)
    previous = output
    elapsed += durations[index]
  }
  return `${normalize.join(';')};${chain.join(';')}`
}

async function probeDuration(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath], { timeout: 60_000 })
  const duration = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('CANVAS_COMPOSE_INPUT_DURATION_INVALID')
  return duration
}

async function downloadToFile(key: string, outputPath: string): Promise<number> {
  const response = await fetch(getSignedUrl(key, 3600), { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) throw new Error(`CANVAS_COMPOSE_INPUT_FETCH_FAILED:${response.status}`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > CANVAS_COMPOSE_LIMITS.maxInputBytes) throw new Error('CANVAS_COMPOSE_INPUTS_TOO_LARGE')
  let bytes = 0
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength
      if (bytes > CANVAS_COMPOSE_LIMITS.maxInputBytes) throw new Error('CANVAS_COMPOSE_INPUTS_TOO_LARGE')
      controller.enqueue(chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body.pipeThrough(counter) as never), createWriteStream(outputPath))
  return bytes
}

export class FfmpegCanvasComposeExecutor implements CanvasComposeExecutor {
  async execute(input: CanvasComposeExecutorInput) {
    const dir = await mkdtemp(path.join(tmpdir(), 'canvas-compose-'))
    try {
      const paths: string[] = []
      let totalBytes = 0
      for (let index = 0; index < input.sourceKeys.length; index++) {
        const filePath = path.join(dir, `clip-${index}.mp4`)
        totalBytes += await downloadToFile(input.sourceKeys[index], filePath)
        if (totalBytes > CANVAS_COMPOSE_LIMITS.maxInputBytes) throw new Error('CANVAS_COMPOSE_INPUTS_TOO_LARGE')
        paths.push(filePath)
      }
      const durations = await Promise.all(paths.map(probeDuration))
      const rawDuration = durations.reduce((sum, value) => sum + value, 0)
      const durationSec = input.transition === 'crossfade'
        ? rawDuration - input.crossfadeSec * Math.max(0, durations.length - 1)
        : rawDuration
      if (durationSec > CANVAS_COMPOSE_LIMITS.maxDurationSec) throw new Error('CANVAS_COMPOSE_DURATION_TOO_LONG')
      const outPath = path.join(dir, 'output.mp4')
      const args = paths.flatMap((filePath) => ['-i', filePath])
      args.push(
        '-filter_complex', buildComposeFilter(durations, input.transition, input.crossfadeSec),
        '-map', '[outv]', '-an', '-t', String(CANVAS_COMPOSE_LIMITS.maxDurationSec),
        '-c:v', 'libx264', '-preset', 'veryfast', '-threads', String(CANVAS_COMPOSE_LIMITS.threads),
        '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outPath,
      )
      await execFileAsync('ffmpeg', args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 })
      const outputStat = await stat(outPath)
      if (outputStat.size > CANVAS_COMPOSE_LIMITS.maxOutputBytes) throw new Error('CANVAS_COMPOSE_OUTPUT_TOO_LARGE')
      const resultKey = generateUniqueKey(`video/playground-ref/${input.userId}/composition`, 'mp4')
      await uploadToCOS(await readFile(outPath), resultKey)
      return { resultKey, durationSec }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

export const canvasComposeExecutor: CanvasComposeExecutor = new FfmpegCanvasComposeExecutor()

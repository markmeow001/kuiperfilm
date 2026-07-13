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

async function probeMedia(inputPath: string): Promise<{ duration: number; hasAudio: boolean }> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', inputPath], { timeout: 60_000 })
  const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> }
  const duration = Number.parseFloat(parsed.format?.duration ?? '')
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('CANVAS_COMPOSE_INPUT_DURATION_INVALID')
  // 计画红线：无 video stream 的输入（纯音频/坏档）显式失败——否则要到
  // ffmpeg filter 引用 [N:v] 才炸出难懂错误（review 2026-07-13）
  if (!parsed.streams?.some((stream) => stream.codec_type === 'video')) throw new Error('CANVAS_COMPOSE_INPUT_NO_VIDEO_STREAM')
  return { duration, hasAudio: parsed.streams?.some((stream) => stream.codec_type === 'audio') ?? false }
}

export function buildComposeAudioFilter(options: {
  durations: number[]
  hasAudio: boolean[]
  transition: 'cut' | 'crossfade'
  crossfadeSec: number
  preserveOriginalAudio: boolean
  voiceInputIndex?: number
  musicInputIndex?: number
  voiceVolume: number
  musicVolume: number
  outputDuration: number
}): string {
  const { durations } = options
  const video = buildComposeFilter(durations, options.transition, options.crossfadeSec).replace(/\[outv\]$/, '[videoout]')
  const audioNormalize = durations.map((duration, index) => options.preserveOriginalAudio && options.hasAudio[index]
    ? `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`
    : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`)
  let baseAudio: string
  if (options.transition === 'crossfade' && durations.length > 1) {
    const chain: string[] = []
    let previous = 'a0'
    for (let index = 1; index < durations.length; index++) {
      const output = index === durations.length - 1 ? 'basea' : `ax${index}`
      chain.push(`[${previous}][a${index}]acrossfade=d=${options.crossfadeSec}:c1=tri:c2=tri[${output}]`)
      previous = output
    }
    baseAudio = chain.join(';')
  } else {
    baseAudio = `${durations.map((_, index) => `[a${index}]`).join('')}concat=n=${durations.length}:v=0:a=1[basea]`
  }
  const extra: string[] = []
  const mixInputs = ['[basea]']
  if (options.voiceInputIndex !== undefined) {
    extra.push(`[${options.voiceInputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${options.voiceVolume},apad,atrim=duration=${options.outputDuration.toFixed(3)}[voice]`)
    mixInputs.push('[voice]')
  }
  if (options.musicInputIndex !== undefined) {
    const fadeStart = Math.max(0, options.outputDuration - 1)
    extra.push(`[${options.musicInputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${options.musicVolume},atrim=duration=${options.outputDuration.toFixed(3)},afade=t=out:st=${fadeStart.toFixed(3)}:d=1[music]`)
    mixInputs.push('[music]')
  }
  extra.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0[outa]`)
  return [video, ...audioNormalize, baseAudio, ...extra].join(';')
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
      let voicePath: string | undefined
      if (input.voiceKey) {
        voicePath = path.join(dir, 'voice.wav')
        totalBytes += await downloadToFile(input.voiceKey, voicePath)
      }
      let musicPath: string | undefined
      if (input.musicKey) {
        musicPath = path.join(dir, 'music.wav')
        totalBytes += await downloadToFile(input.musicKey, musicPath)
      }
      if (totalBytes > CANVAS_COMPOSE_LIMITS.maxInputBytes) throw new Error('CANVAS_COMPOSE_INPUTS_TOO_LARGE')
      const media = await Promise.all(paths.map(probeMedia))
      const durations = media.map((item) => item.duration)
      const rawDuration = durations.reduce((sum, value) => sum + value, 0)
      const durationSec = input.transition === 'crossfade'
        ? rawDuration - input.crossfadeSec * Math.max(0, durations.length - 1)
        : rawDuration
      if (durationSec > CANVAS_COMPOSE_LIMITS.maxDurationSec) throw new Error('CANVAS_COMPOSE_DURATION_TOO_LONG')
      const outPath = path.join(dir, 'output.mp4')
      const args = paths.flatMap((filePath) => ['-i', filePath])
      const voiceInputIndex = voicePath ? paths.length : undefined
      if (voicePath) args.push('-i', voicePath)
      const musicInputIndex = musicPath ? paths.length + (voicePath ? 1 : 0) : undefined
      if (musicPath) args.push('-stream_loop', '-1', '-i', musicPath)
      args.push(
        '-filter_complex', buildComposeAudioFilter({ durations, hasAudio: media.map((item) => item.hasAudio), transition: input.transition, crossfadeSec: input.crossfadeSec, preserveOriginalAudio: input.preserveOriginalAudio, voiceInputIndex, musicInputIndex, voiceVolume: input.voiceVolume, musicVolume: input.musicVolume, outputDuration: durationSec }),
        '-map', '[videoout]', '-map', '[outa]', '-t', String(CANVAS_COMPOSE_LIMITS.maxDurationSec),
        '-c:v', 'libx264', '-preset', 'veryfast', '-threads', String(CANVAS_COMPOSE_LIMITS.threads),
        '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', outPath,
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

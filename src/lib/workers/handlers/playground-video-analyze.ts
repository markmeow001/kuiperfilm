import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Job } from 'bullmq'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import {
  reconstructionAnalysisSchema,
  type ReconstructionAnalysisResult,
  type ReconstructionVideoMetadata,
} from '@/lib/playground/reconstruction-contract'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive, toSignedUrlIfCos } from '@/lib/workers/utils'
import { generateUniqueKey, getSignedUrl, uploadToCOS } from '@/lib/cos'

const execFileAsync = promisify(execFile)
const SAMPLE_COUNT = 6
const PROCESS_TIMEOUT_MS = 90_000

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseRate(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const [numerator, denominator = '1'] = value.split('/')
  const n = Number(numerator)
  const d = Number(denominator)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null
  return n / d
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed
  return JSON.parse(unfenced)
}

async function probeVideo(inputUrl: string): Promise<ReconstructionVideoMetadata> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate',
    '-of', 'json',
    inputUrl,
  ], { timeout: PROCESS_TIMEOUT_MS, maxBuffer: 1024 * 1024 })
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }>
  }
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const durationSec = Number(parsed.format?.duration)
  if (!video || !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('PLAYGROUND_RECONSTRUCTION_VIDEO_METADATA_INVALID')
  }
  return {
    durationSec,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: parseRate(video.avg_frame_rate),
    hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === 'audio')),
  }
}

async function extractFrameDataUrls(
  inputUrl: string,
  durationSec: number,
  taskId: string,
  userId: string,
): Promise<{ imageUrls: string[]; sourceFrame: ReconstructionAnalysisResult['sourceFrame'] }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'playground-reconstruction-'))
  try {
    const frameRate = Math.max(0.1, SAMPLE_COUNT / durationSec)
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', inputUrl,
      '-vf', `fps=${frameRate.toFixed(6)},scale=768:-2`,
      '-frames:v', String(SAMPLE_COUNT),
      '-q:v', '3',
      path.join(dir, 'frame-%02d.jpg'),
    ], { timeout: PROCESS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
    const names = (await readdir(dir)).filter((name) => name.endsWith('.jpg')).sort()
    if (names.length < 2) throw new Error('PLAYGROUND_RECONSTRUCTION_FRAMES_MISSING')
    const frames = await Promise.all(names.map((name) => readFile(path.join(dir, name))))
    // The action frame becomes an input to a second Playground task. Store it
    // in the caller's guarded reference namespace so it remains authorized.
    const sourceFrameKey = generateUniqueKey(
      `images/playground-ref/${userId}/reconstruction-${taskId}-source-frame`,
      'jpg',
    )
    await uploadToCOS(frames[0] as Buffer, sourceFrameKey)
    const imageUrls = frames.map((frame) => {
      return `data:image/jpeg;base64,${frame.toString('base64')}`
    })
    return {
      imageUrls,
      sourceFrame: { key: sourceFrameKey, signedUrl: getSignedUrl(sourceFrameKey, 3600) },
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const ANALYSIS_PROMPT = `You are a film VFX supervisor analyzing six chronological frames sampled from one short live-action reference video.
Return exactly one JSON object, with no markdown and no commentary, using this shape:
{"summary":"...","camera":{"shotSize":"...","angle":"...","movement":"...","continuity":"..."},"subjects":[{"id":"person_1","description":"...","action":"...","position":"...","relation":"..."}],"performance":{"emotion":"...","timing":"...","mustPreserve":["..."]},"environment":{"description":"...","greenScreen":true,"studioEquipmentVisible":true,"motionNotes":"..."},"risks":["..."]}

Analyze only visually supported facts. The frames are chronological, so infer camera and subject movement conservatively. Identify every visible primary performer, their blocking, contact, gestures, gaze, and emotional performance. Explain which motion, timing, spatial relationship, camera behavior, parallax, foot contact, and occlusion must survive an AI reconstruction. Flag green screen and visible production equipment. Do not infer or invent spoken dialogue because frames contain no audio. Write concise Traditional Chinese values inside the JSON.`

export async function handlePlaygroundVideoAnalyzeTask(
  job: Job<TaskJobData>,
): Promise<ReconstructionAnalysisResult> {
  const payload = (job.data.payload ?? {}) as Record<string, unknown>
  const videoKey = readString(payload.videoKey)
  const model = readString(payload.analysisModel) || readString(payload.model)
  if (!videoKey) throw new Error('PLAYGROUND_RECONSTRUCTION_VIDEO_REQUIRED')
  if (!model) throw new Error('PLAYGROUND_RECONSTRUCTION_ANALYSIS_MODEL_REQUIRED')

  const inputUrl = toSignedUrlIfCos(videoKey, 3600)
  if (!inputUrl) throw new Error('PLAYGROUND_RECONSTRUCTION_VIDEO_URL_INVALID')

  await assertTaskActive(job, 'playground_reconstruction_probe')
  await reportTaskProgress(job, 15, { stage: 'probe_video', message: '正在讀取影片資料' })
  const metadata = await probeVideo(inputUrl)
  await reportTaskProgress(job, 35, { stage: 'extract_frames', message: '正在擷取代表畫面' })
  const { imageUrls, sourceFrame } = await extractFrameDataUrls(
    inputUrl,
    metadata.durationSec,
    job.data.taskId,
    job.data.userId,
  )
  await assertTaskActive(job, 'playground_reconstruction_analyze')
  await reportTaskProgress(job, 55, { stage: 'analyze_frames', message: '正在分析運鏡與表演' })

  const completion = await executeAiVisionStep({
    userId: job.data.userId,
    model,
    prompt: ANALYSIS_PROMPT,
    imageUrls,
    projectId: job.data.projectId,
    action: 'playground_video_analyze',
    temperature: 0.1,
    meta: {
      stepId: 'playground-video-analysis',
      stepTitle: '分析實拍鏡頭',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  let raw: unknown
  try {
    raw = parseJsonObject(completion.text)
  } catch (error) {
    throw new Error(`PLAYGROUND_RECONSTRUCTION_ANALYSIS_JSON_INVALID: ${error instanceof Error ? error.message : String(error)}`)
  }
  const analysis = reconstructionAnalysisSchema.parse(raw)
  await reportTaskProgress(job, 95, { stage: 'analysis_ready', message: '鏡頭分析完成' })
  return { analysis, metadata, model, sourceFrame }
}

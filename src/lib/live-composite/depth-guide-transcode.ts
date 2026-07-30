/**
 * 深度引導影片 WebM → MP4 伺服器轉檔（2026-07-30）。
 *
 * 瀏覽器 MediaRecorder 在 Chrome 只能輸出 WebM（vp8/vp9），本機播放器
 * （QuickTime 等）打不開。這裡沿用 depth-rebuild-finalize 的 ffmpeg 模式
 * 做一次性同步轉檔：4–15 秒的深度影片轉檔約 1–3 秒，不需要走 BullMQ。
 * 生成鏈路不受影響——worker 送模型前本來就會用 ffmpeg 正規化成 mp4，
 * 這個端點只服務「下載檢視」。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 15 秒 720p+ 的 MediaRecorder WebM 實測遠小於此值；超過視為異常輸入。 */
export const DEPTH_GUIDE_TRANSCODE_MAX_INPUT_BYTES = 300 * 1024 * 1024
export const DEPTH_GUIDE_TRANSCODE_MAX_OUTPUT_BYTES = 400 * 1024 * 1024
const MEDIA_TOOL_TIMEOUT_MS = 120_000
const MEDIA_TOOL_MAX_BUFFER = 16 * 1024 * 1024

export class DepthGuideTranscodeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DepthGuideTranscodeError'
    this.code = code
  }
}

export function assertDepthGuideTranscodeInput(
  byteLength: number,
  contentType: string,
): void {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new DepthGuideTranscodeError(
      'DEPTH_GUIDE_TRANSCODE_INPUT_EMPTY',
      '深度影片內容是空的，請重新產生後再下載',
    )
  }
  if (byteLength > DEPTH_GUIDE_TRANSCODE_MAX_INPUT_BYTES) {
    throw new DepthGuideTranscodeError(
      'DEPTH_GUIDE_TRANSCODE_INPUT_TOO_LARGE',
      `深度影片超過轉檔大小上限 ${Math.floor(DEPTH_GUIDE_TRANSCODE_MAX_INPUT_BYTES / 1024 / 1024)}MB`,
    )
  }
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalized !== 'video/webm') {
    throw new DepthGuideTranscodeError(
      'DEPTH_GUIDE_TRANSCODE_CONTENT_TYPE_INVALID',
      '只接受 video/webm 的本機深度影片轉檔',
    )
  }
}

/** Exported for unit testing (pure). */
export function buildDepthGuideMp4FfmpegArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-y',
    '-i', inputPath,
    // 深度引導影片沒有需要保留的音訊；下載用途只要畫面。
    '-an',
    // libx264 要求偶數寬高；MediaRecorder 可能錄出奇數尺寸。
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    // 灰階深度影像對壓縮失真敏感（帶狀偽影會誤導檢視），用較高品質。
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ]
}

export async function transcodeDepthGuideToMp4(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'depth-guide-mp4-'))
  try {
    const inputPath = path.join(dir, 'in.webm')
    const outputPath = path.join(dir, 'out.mp4')
    await writeFile(inputPath, input)
    try {
      await execFileAsync(
        'ffmpeg',
        buildDepthGuideMp4FfmpegArgs(inputPath, outputPath),
        { timeout: MEDIA_TOOL_TIMEOUT_MS, maxBuffer: MEDIA_TOOL_MAX_BUFFER },
      )
    } catch (error) {
      throw new DepthGuideTranscodeError(
        'DEPTH_GUIDE_TRANSCODE_MEDIA_TOOL_FAILED',
        `深度影片轉檔失敗：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const outputStat = await stat(outputPath)
    if (outputStat.size <= 0) {
      throw new DepthGuideTranscodeError(
        'DEPTH_GUIDE_TRANSCODE_OUTPUT_EMPTY',
        '轉檔輸出是空檔案',
      )
    }
    if (outputStat.size > DEPTH_GUIDE_TRANSCODE_MAX_OUTPUT_BYTES) {
      throw new DepthGuideTranscodeError(
        'DEPTH_GUIDE_TRANSCODE_OUTPUT_TOO_LARGE',
        '轉檔輸出超過大小上限',
      )
    }
    return await readFile(outputPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

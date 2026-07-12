/**
 * previz 导出转码 — 容器内 ffmpeg（同 video-tail-frame.ts 的 execFile 模式）。
 *
 * 浏览器 MediaRecorder 录出来的是全视口 webm；这里裁切到导出画幅、缩放到
 * 目标分辨率、转 H.264 MP4（yuv420p + faststart，各视频 provider 通吃），
 * 并抽首/尾帧 jpg 当关键帧参考图。≤15s 短片，秒级完成，route 内同步跑
 * （非分钟级长任务，不进 BullMQ；超时 120s 显式失败）。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const TRANSCODE_TIMEOUT_MS = 120_000
const FRAME_TIMEOUT_MS = 60_000

export interface PrevizCrop {
  x: number
  y: number
  w: number
  h: number
}

/** webm → 裁切/缩放/30fps → H.264 MP4（无音轨）。 */
export async function transcodePrevizClip(opts: {
  inputPath: string
  outPath: string
  crop: PrevizCrop
  outWidth: number
  outHeight: number
}): Promise<void> {
  const { inputPath, outPath, crop, outWidth, outHeight } = opts
  const vf = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${outWidth}:${outHeight},fps=30`
  // -t 16: 输出时长硬顶。meta.durationSec 只是客户端声明——恶意/异常 webm
  // 实际可长达数小时，没有这个 cap ffmpeg 会全量转码到 120s timeout 才被杀
  //（security review 2026-07-13 MEDIUM#1）。16s > R2V 上限 15.2s，正常导出不受影响。
  await execFileAsync(
    'ffmpeg',
    ['-y', '-i', inputPath, '-t', '16', '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath],
    { timeout: TRANSCODE_TIMEOUT_MS },
  )
}

/** 从 MP4 抽首帧或尾帧 jpg（尾帧用 -sseof 只解码尾部片段）。 */
export async function extractPrevizFrame(inputPath: string, outPath: string, which: 'first' | 'last'): Promise<void> {
  const args =
    which === 'first'
      ? ['-y', '-i', inputPath, '-frames:v', '1', '-q:v', '2', outPath]
      : ['-y', '-sseof', '-0.5', '-i', inputPath, '-frames:v', '1', '-q:v', '2', outPath]
  await execFileAsync('ffmpeg', args, { timeout: FRAME_TIMEOUT_MS })
}

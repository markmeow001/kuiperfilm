/**
 * 视频尾帧抽取 — 供无限画布「续镜链」使用(上一镜视频的最后一帧 = 下一镜
 * 的首帧参考)。
 *
 * 用容器内的 ffmpeg 从已上传的视频(COS/R2 signed URL 输入,ffmpeg 原生支持
 * https)抽最后一帧存回存储,返回 COS key。单帧抽取只解码尾部片段,资源
 * 占用与被退役的整集 ffmpeg concat 不是一个量级(见 episode-package-zip 的
 * 迁移注记),可以安全跑在 worker 里。
 *
 * 失败语义:调用方应视为非致命(视频本体已成功,只是丢了续镜便利),
 * catch 后记 log 继续。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSignedUrl, uploadToCOS, generateUniqueKey } from './cos'

const execFileAsync = promisify(execFile)

const FFMPEG_TIMEOUT_MS = 60_000

async function runFfmpegTailGrab(inputUrl: string, outPath: string, sseofSeconds: number): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    ['-y', '-sseof', `-${sseofSeconds}`, '-i', inputUrl, '-frames:v', '1', '-q:v', '2', outPath],
    { timeout: FFMPEG_TIMEOUT_MS },
  )
}

/**
 * 从 videoKey 指向的视频抽最后一帧,上传为 jpg,返回其存储 key。
 * @param videoKey 视频的存储 key(images/ 前缀,由 uploadVideoSourceToCos 产出)
 * @param targetId 命名用途的任务/运行 id
 */
export async function extractVideoTailFrameToCos(videoKey: string, targetId: string): Promise<string> {
  const inputUrl = getSignedUrl(videoKey, 600)
  const dir = await mkdtemp(path.join(tmpdir(), 'tailframe-'))
  const outPath = path.join(dir, 'tail.jpg')
  try {
    try {
      // 先从倒数 1s 抓;个别封装的最后 GOP 不完整时退回倒数 3s 再试。
      await runFfmpegTailGrab(inputUrl, outPath, 1)
    } catch {
      await runFfmpegTailGrab(inputUrl, outPath, 3)
    }
    const buf = await readFile(outPath)
    if (buf.length === 0) throw new Error('TAIL_FRAME_EMPTY_OUTPUT')
    const key = generateUniqueKey(`playground-runs/${targetId}-tailframe`, 'jpg')
    return await uploadToCOS(buf as Buffer, key)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

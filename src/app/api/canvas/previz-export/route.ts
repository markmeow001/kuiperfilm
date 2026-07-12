/**
 * 导演台 previz 导出 (2026-07-12, S3)。
 *
 * POST /api/canvas/previz-export
 *   multipart/form-data:
 *     file — 浏览器 MediaRecorder 录制的预演 webm（或 mp4）≤ 50MB
 *     meta — JSON 字符串 { aspect: '9:16'|'16:9', durationSec, crop: {x,y,w,h} }
 *   → ffmpeg 裁切/缩放/转 MP4 + 抽首尾帧 jpg → 上传存储
 *   → { success, videoKey, videoUrl, firstFrameKey, firstFrameUrl, lastFrameKey, lastFrameUrl }
 *
 * videoKey 直接可作 PlaygroundRun.referenceVideos 的元素（R2V 参考视频）；
 * 帧 key 可作 referenceImages。时长在此**再次**校验 ≤15.2s（AtlasCloud R2V
 * 上限）——不依赖前端守卫（2026-07-09 DurationTooLong 的教训）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { uploadToCOS, generateUniqueKey, getSignedUrl } from '@/lib/cos'
import { transcodePrevizClip, extractPrevizFrame, type PrevizCrop } from '@/lib/canvas/previz-transcode'
import { logInfo, logError } from '@/lib/logging/core'

export const maxDuration = 180

const MAX_FILE_BYTES = 50 * 1024 * 1024
/** AtlasCloud Seedance R2V 参考视频硬上限。 */
const MAX_DURATION_SEC = 15.2
const MIN_DURATION_SEC = 0.5
const ALLOWED_MIMES: ReadonlySet<string> = new Set(['video/webm', 'video/mp4'])
const ASPECT_OUTPUT: Record<string, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
}

interface ExportMeta {
  aspect: '9:16' | '16:9'
  durationSec: number
  crop: PrevizCrop
}

function parseMeta(raw: unknown): ExportMeta {
  if (typeof raw !== 'string') throw new ApiError('INVALID_PARAMS', { code: 'META_FIELD_MISSING' })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'META_NOT_JSON' })
  }
  const m = parsed as { aspect?: unknown; durationSec?: unknown; crop?: unknown }
  if (m.aspect !== '9:16' && m.aspect !== '16:9') {
    throw new ApiError('INVALID_PARAMS', { code: 'ASPECT_INVALID', details: { got: m.aspect, allowed: Object.keys(ASPECT_OUTPUT) } })
  }
  if (typeof m.durationSec !== 'number' || !Number.isFinite(m.durationSec) || m.durationSec < MIN_DURATION_SEC) {
    throw new ApiError('INVALID_PARAMS', { code: 'DURATION_INVALID', details: { got: m.durationSec } })
  }
  if (m.durationSec > MAX_DURATION_SEC) {
    throw new ApiError('REFERENCE_VIDEO_TOO_LONG', {
      message: `预演片长 ${m.durationSec.toFixed(1)}s 超过 R2V 参考视频上限 ${MAX_DURATION_SEC}s`,
      details: { durationSec: m.durationSec, max: MAX_DURATION_SEC },
    })
  }
  const c = m.crop as Partial<PrevizCrop> | undefined
  // 上限 8192：远超任何真实画布尺寸；挡掉喂给 ffmpeg 的天文数字 crop。
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8192
  if (!c || !num(c.x) || !num(c.y) || !num(c.w) || !num(c.h) || c.w === 0 || c.h === 0) {
    throw new ApiError('INVALID_PARAMS', { code: 'CROP_INVALID', details: { got: m.crop } })
  }
  // ffmpeg crop 要偶数尺寸（yuv420p），就地取整到偶数
  const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2)
  return { aspect: m.aspect, durationSec: m.durationSec, crop: { x: Math.floor(c.x!), y: Math.floor(c.y!), w: even(c.w!), h: even(c.h!) } }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    logError(`[canvas.previz-export] formData parse failed userId=${userId} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INVALID_PARAMS', { code: 'FORMDATA_PARSE_FAILED', details: { message: 'Expected multipart/form-data' } })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) throw new ApiError('INVALID_PARAMS', { code: 'FILE_FIELD_MISSING' })
  if (!ALLOWED_MIMES.has(file.type)) {
    throw new ApiError('INVALID_PARAMS', { code: 'MIME_NOT_ALLOWED', details: { got: file.type, allowed: Array.from(ALLOWED_MIMES) } })
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError('INVALID_PARAMS', { code: 'FILE_TOO_LARGE', details: { size: file.size, max: MAX_FILE_BYTES } })
  }
  const meta = parseMeta(formData.get('meta'))
  const out = ASPECT_OUTPUT[meta.aspect]

  const dir = await mkdtemp(path.join(tmpdir(), 'previz-'))
  try {
    const inPath = path.join(dir, file.type === 'video/mp4' ? 'in.mp4' : 'in.webm')
    const outPath = path.join(dir, 'out.mp4')
    const firstPath = path.join(dir, 'first.jpg')
    const lastPath = path.join(dir, 'last.jpg')
    await writeFile(inPath, Buffer.from(await file.arrayBuffer()))

    // ffmpeg 失败的原始 Error 带完整命令行（/tmp 路径、build 信息），不能
    // 透传给客户端 —— 记服务端 log，回统一的 FFMPEG_FAILED。
    try {
      await transcodePrevizClip({ inputPath: inPath, outPath, crop: meta.crop, outWidth: out.w, outHeight: out.h })
      await extractPrevizFrame(outPath, firstPath, 'first')
      await extractPrevizFrame(outPath, lastPath, 'last')
    } catch (err) {
      logError(`[canvas.previz-export] ffmpeg failed userId=${userId} aspect=${meta.aspect} err=${err instanceof Error ? err.message : String(err)}`)
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'FFMPEG_FAILED',
        message: '预演转码失败：录制文件可能损坏，请重试导出',
      })
    }

    const videoKey = generateUniqueKey(`video/playground-ref/${userId}/previz`, 'mp4')
    const firstFrameKey = generateUniqueKey(`images/playground-ref/${userId}/previz-first`, 'jpg')
    const lastFrameKey = generateUniqueKey(`images/playground-ref/${userId}/previz-last`, 'jpg')
    await uploadToCOS(await readFile(outPath), videoKey)
    await uploadToCOS(await readFile(firstPath), firstFrameKey)
    await uploadToCOS(await readFile(lastPath), lastFrameKey)

    logInfo(`✓ previz exported: userId=${userId} aspect=${meta.aspect} dur=${meta.durationSec.toFixed(1)}s key=${videoKey}`)
    return NextResponse.json({
      success: true,
      videoKey,
      videoUrl: getSignedUrl(videoKey, 3600),
      firstFrameKey,
      firstFrameUrl: getSignedUrl(firstFrameKey, 3600),
      lastFrameKey,
      lastFrameUrl: getSignedUrl(lastFrameKey, 3600),
    })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((err) => {
      logError(`[canvas.previz-export] temp cleanup failed dir=${dir} err=${err instanceof Error ? err.message : String(err)}`)
    })
  }
})

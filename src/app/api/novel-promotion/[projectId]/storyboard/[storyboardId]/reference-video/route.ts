/**
 * Phase S (2026-05-27) — per-group motion / camera reference video upload.
 *
 * POST    /api/novel-promotion/:projectId/storyboard/:storyboardId/reference-video
 *         body: multipart/form-data with `file` (mp4 / mov / webm, ≤50MB)
 *         → uploads to COS at video/reference-videos/<storyboardId>/<uuid>.<ext>
 *         → stores key in NovelPromotionStoryboard.referenceVideoUrl
 *         → returns { success, key, signedUrl }
 *
 * DELETE  /api/novel-promotion/:projectId/storyboard/:storyboardId/reference-video
 *         → clears the DB field (does NOT delete the COS object — cheap to
 *           keep, in case the user re-attaches later from another group; can
 *           be GC'd by a separate sweep later if storage cost becomes real)
 *
 * Worker reads `storyboard.referenceVideoUrl` (signed via toSignedUrlIfCos)
 * and forwards into the 4 multi-shot worker paths:
 *   - fal:        body.video_urls[0]
 *   - atlascloud: body.reference_videos[0]
 *   - BobAPI:     content[] entry `{type:'video_url', role:'reference_video', video_url:{url}}`
 *   - ARK:        content[] entry `{type:'video_url', role:'reference_video', video_url:{url}}`
 *
 * Duration cap (≤15s) is enforced CLIENT-SIDE via HTML5 video.duration probe
 * before upload — keeps the server simple (no ffprobe dependency). Internal
 * 10-20 person team makes the bypass risk acceptable; can add server-side
 * ffprobe later if needed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { uploadToCOS, generateUniqueKey, getSignedUrl } from '@/lib/cos'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const ALLOWED_VIDEO_MIMES: ReadonlySet<string> = new Set([
  'video/mp4',
  'video/quicktime', // .mov
  'video/webm',
])

function extensionFor(mime: string): string {
  switch (mime) {
    case 'video/mp4':
      return 'mp4'
    case 'video/quicktime':
      return 'mov'
    case 'video/webm':
      return 'webm'
    default:
      return 'mp4' // defensive fallback; gate above should reject anything else
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; storyboardId: string }> },
) => {
  const { projectId, storyboardId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // Multi-user isolation: ensure the storyboard chain back to this project.
  const owned = await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
    select: { id: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND', { code: 'STORYBOARD_NOT_FOUND' })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FORMDATA_PARSE_FAILED',
      details: { message: 'Expected multipart/form-data with `file`' },
    })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FILE_FIELD_MISSING',
      details: { message: 'multipart form must include `file` field' },
    })
  }

  // MIME gate
  if (!ALLOWED_VIDEO_MIMES.has(file.type)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_MIME_NOT_ALLOWED',
      details: {
        got: file.type,
        allowed: Array.from(ALLOWED_VIDEO_MIMES),
        message: '只接受 mp4 / mov / webm 格式',
      },
    })
  }

  // Size gate (50 MB) — also defends against accidentally-uploaded full
  // episodes. Long-clip duration cap is enforced client-side.
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_TOO_LARGE',
      details: {
        size: file.size,
        max: MAX_VIDEO_SIZE_BYTES,
        message: `檔案 ${(file.size / 1024 / 1024).toFixed(1)} MB 超過 50 MB 上限`,
      },
    })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const ext = extensionFor(file.type)
  const key = generateUniqueKey(`video/reference-videos/${storyboardId}/ref`, ext)
  await uploadToCOS(buffer, key)

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { referenceVideoUrl: key },
  })

  _ulogInfo(
    `✓ Reference video uploaded: storyboardId=${storyboardId} key=${key} size=${file.size} mime=${file.type}`,
  )

  return NextResponse.json({
    success: true,
    key,
    signedUrl: getSignedUrl(key, 3600),
  })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; storyboardId: string }> },
) => {
  const { projectId, storyboardId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const owned = await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
    select: { id: true, referenceVideoUrl: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND', { code: 'STORYBOARD_NOT_FOUND' })
  }
  if (!owned.referenceVideoUrl) {
    // Idempotent: clearing a not-set field is a no-op.
    return NextResponse.json({ success: true, cleared: false })
  }

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { referenceVideoUrl: null },
  })

  _ulogInfo(`✓ Reference video cleared: storyboardId=${storyboardId}`)

  // Deliberately NOT deleting the COS object — keeps the option open for
  // re-attach + simplifies the endpoint. A scheduled COS sweep can GC
  // orphaned reference-videos/ keys later if storage cost matters.

  return NextResponse.json({ success: true, cleared: true })
})

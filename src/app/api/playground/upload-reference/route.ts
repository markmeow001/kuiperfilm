/**
 * Phase T-1 (2026-05-27) — Playground reference upload.
 *
 * POST /api/playground/upload-reference
 *   multipart/form-data with `file` and `type` ('image' | 'video')
 *   - image: image/jpeg, image/png, image/webp ≤ 10MB
 *   - video: video/mp4, video/quicktime, video/webm ≤ 50MB
 *   → uploads to COS at images/playground-ref/<userId>/<uuid>.<ext>
 *     (image) or video/playground-ref/<userId>/<uuid>.<ext> (video)
 *   → returns { success, key, signedUrl }
 *
 * The key is what gets stored in PlaygroundRun.referenceImages /
 * referenceVideos JSON arrays. signedUrl is for immediate browser preview.
 *
 * Symmetric with /api/novel-promotion/[projectId]/storyboard/[storyboardId]/reference-video
 * but project-independent — Playground runs aren't bound to a project.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { uploadToCOS, generateUniqueKey, getSignedUrl } from '@/lib/cos'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_AUDIO_SIZE_BYTES = 15 * 1024 * 1024 // 15 MB (reference voice clip)
const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const ALLOWED_VIDEO_MIMES: ReadonlySet<string> = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
])
const ALLOWED_AUDIO_MIMES: ReadonlySet<string> = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
])

function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'video/mp4':
      return 'mp4'
    case 'video/quicktime':
      return 'mov'
    case 'video/webm':
      return 'webm'
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav'
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/mp4':
      return 'm4a'
    case 'audio/webm':
      return 'weba'
    case 'audio/ogg':
      return 'ogg'
    default:
      return 'bin'
  }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  // Per CLAUDE.md §3 (不靜默吞錯) — log parse failure with context before
  // surfacing INVALID_PARAMS so ops can correlate with the client's request.
  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    _ulogError(`[playground.upload-reference] formData parse failed userId=${userId} err=${errMsg}`)
    throw new ApiError('INVALID_PARAMS', {
      code: 'FORMDATA_PARSE_FAILED',
      details: { message: 'Expected multipart/form-data' },
    })
  }
  const file = formData.get('file')
  const type = formData.get('type')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS', { code: 'FILE_FIELD_MISSING' })
  }
  if (type !== 'image' && type !== 'video' && type !== 'audio') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TYPE_INVALID',
      details: { message: 'type must be "image", "video" or "audio"' },
    })
  }

  const allowed = type === 'image' ? ALLOWED_IMAGE_MIMES : type === 'video' ? ALLOWED_VIDEO_MIMES : ALLOWED_AUDIO_MIMES
  const sizeCap = type === 'image' ? MAX_IMAGE_SIZE_BYTES : type === 'video' ? MAX_VIDEO_SIZE_BYTES : MAX_AUDIO_SIZE_BYTES

  if (!allowed.has(file.type)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MIME_NOT_ALLOWED',
      details: {
        got: file.type,
        allowed: Array.from(allowed),
      },
    })
  }
  if (file.size > sizeCap) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FILE_TOO_LARGE',
      details: {
        size: file.size,
        max: sizeCap,
      },
    })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const ext = extensionFor(file.type)
  const keyPrefix = type === 'image'
    ? `images/playground-ref/${userId}/ref`
    : type === 'video'
      ? `video/playground-ref/${userId}/ref`
      : `voice/playground-ref/${userId}/ref`
  const key = generateUniqueKey(keyPrefix, ext)
  await uploadToCOS(buffer, key)

  _ulogInfo(
    `✓ Playground reference uploaded: userId=${userId} type=${type} key=${key} size=${file.size}`,
  )

  return NextResponse.json({
    success: true,
    key,
    signedUrl: getSignedUrl(key, 3600),
  })
})

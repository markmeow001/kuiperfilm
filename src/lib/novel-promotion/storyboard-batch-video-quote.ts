import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_VERSION = 'v1'
const SIGNING_DOMAIN = 'kuiper:storyboard-batch-video-quote:v1'
const DEFAULT_TTL_MS = 5 * 60_000
const MAX_TOKEN_LENGTH = 64 * 1024

type JsonPrimitive = string | number | boolean | null
export type StoryboardBatchVideoJsonValue =
  | JsonPrimitive
  | StoryboardBatchVideoJsonValue[]
  | { [key: string]: StoryboardBatchVideoJsonValue }

export type StoryboardBatchVideoPanelSource = {
  updatedAt: string
  imageUrl: string | null
  imageMediaId: string | null
  description: string | null
  videoPrompt: string | null
  firstLastFramePrompt: string | null
  srtSegment: string | null
  videoUrl: string | null
  videoMediaId: string | null
}

export type StoryboardBatchVideoQuoteClaims = {
  userId: string
  projectId: string
  episodeId: string
  batchRunId: string
  settings: {
    videoModel: string
    generationOptions?: Record<string, StoryboardBatchVideoJsonValue>
    firstLastFrame?: Record<string, StoryboardBatchVideoJsonValue>
  }
  pricing: {
    version: string
    currency: 'CNY'
    estimatedCostPerTask: number | null
    estimatedTotalCost: number | null
  }
  targets: Array<{
    panelId: string
    disposition: 'new' | 'already_active'
    taskId: string | null
    status: string | null
    source: StoryboardBatchVideoPanelSource
  }>
}

type SignedStoryboardBatchVideoQuote = StoryboardBatchVideoQuoteClaims & {
  tokenVersion: 1
  issuedAtMs: number
  expiresAtMs: number
}

type QuoteContext = Pick<StoryboardBatchVideoQuoteClaims, 'userId' | 'projectId' | 'episodeId'>

function fail(code: string): never {
  throw new Error(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableCost(value: unknown): value is number | null {
  return value === null || (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  )
}

function parseDisposition(value: unknown): 'new' | 'already_active' {
  if (value === 'new' || value === 'already_active') return value
  fail('BATCH_VIDEO_QUOTE_INVALID')
}

function isJsonValue(value: unknown, depth = 0): value is StoryboardBatchVideoJsonValue {
  if (depth > 8) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1))
  if (!isRecord(value)) return false
  return Object.entries(value).every(([key, item]) => (
    key.length <= 128 && isJsonValue(item, depth + 1)
  ))
}

function canonicalize(value: StoryboardBatchVideoJsonValue): StoryboardBatchVideoJsonValue {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  const next: Record<string, StoryboardBatchVideoJsonValue> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (isJsonValue(item)) next[key] = canonicalize(item)
  }
  return next
}

function resolveSigningSecret(): Buffer {
  const secret = process.env.API_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET
  if (!secret || secret.trim().length < 16) {
    throw new Error('BATCH_VIDEO_QUOTE_SIGNING_SECRET_MISSING')
  }
  return Buffer.from(secret, 'utf8')
}

function signatureFor(encodedPayload: string): Buffer {
  return createHmac('sha256', resolveSigningSecret())
    .update(SIGNING_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(encodedPayload, 'ascii')
    .digest()
}

function parseSource(value: unknown): StoryboardBatchVideoPanelSource {
  if (!isRecord(value) || !isNonEmptyString(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt))) {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  const imageUrl = value.imageUrl
  const imageMediaId = value.imageMediaId
  const description = value.description
  const videoPrompt = value.videoPrompt
  const firstLastFramePrompt = value.firstLastFramePrompt
  const srtSegment = value.srtSegment
  const videoUrl = value.videoUrl
  const videoMediaId = value.videoMediaId
  if (
    !isNullableString(imageUrl)
    || !isNullableString(imageMediaId)
    || !isNullableString(description)
    || !isNullableString(videoPrompt)
    || !isNullableString(firstLastFramePrompt)
    || !isNullableString(srtSegment)
    || !isNullableString(videoUrl)
    || !isNullableString(videoMediaId)
  ) {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  return {
    updatedAt: value.updatedAt,
    imageUrl,
    imageMediaId,
    description,
    videoPrompt,
    firstLastFramePrompt,
    srtSegment,
    videoUrl,
    videoMediaId,
  }
}

function parseClaims(value: unknown): SignedStoryboardBatchVideoQuote {
  if (
    !isRecord(value)
    || value.tokenVersion !== 1
    || !isNonEmptyString(value.userId)
    || !isNonEmptyString(value.projectId)
    || !isNonEmptyString(value.episodeId)
    || !isNonEmptyString(value.batchRunId)
    || typeof value.issuedAtMs !== 'number'
    || !Number.isFinite(value.issuedAtMs)
    || typeof value.expiresAtMs !== 'number'
    || !Number.isFinite(value.expiresAtMs)
    || value.expiresAtMs <= value.issuedAtMs
    || !isRecord(value.settings)
    || !isNonEmptyString(value.settings.videoModel)
    || !isRecord(value.pricing)
    || !isNonEmptyString(value.pricing.version)
    || value.pricing.currency !== 'CNY'
    || !isNullableCost(value.pricing.estimatedCostPerTask)
    || !isNullableCost(value.pricing.estimatedTotalCost)
    || !Array.isArray(value.targets)
  ) {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  const generationOptions = value.settings.generationOptions
  const firstLastFrame = value.settings.firstLastFrame
  if (
    generationOptions !== undefined
    && (!isRecord(generationOptions) || !isJsonValue(generationOptions))
  ) fail('BATCH_VIDEO_QUOTE_INVALID')
  if (
    firstLastFrame !== undefined
    && (!isRecord(firstLastFrame) || !isJsonValue(firstLastFrame))
  ) fail('BATCH_VIDEO_QUOTE_INVALID')

  const targets = value.targets.map((target) => {
    if (
      !isRecord(target)
      || !isNonEmptyString(target.panelId)
      || !isNullableString(target.taskId)
      || !isNullableString(target.status)
    ) fail('BATCH_VIDEO_QUOTE_INVALID')
    const disposition = parseDisposition(target.disposition)
    if (
      (disposition === 'new' && (target.taskId !== null || target.status !== null))
      || (disposition === 'already_active' && (!isNonEmptyString(target.taskId) || !isNonEmptyString(target.status)))
    ) fail('BATCH_VIDEO_QUOTE_INVALID')
    return {
      panelId: target.panelId,
      disposition,
      taskId: target.taskId,
      status: target.status,
      source: parseSource(target.source),
    }
  })
  if (new Set(targets.map((target) => target.panelId)).size !== targets.length) {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }

  return {
    tokenVersion: 1,
    userId: value.userId,
    projectId: value.projectId,
    episodeId: value.episodeId,
    batchRunId: value.batchRunId,
    issuedAtMs: value.issuedAtMs,
    expiresAtMs: value.expiresAtMs,
    settings: {
      videoModel: value.settings.videoModel,
      ...(generationOptions === undefined ? {} : { generationOptions }),
      ...(firstLastFrame === undefined ? {} : { firstLastFrame }),
    },
    pricing: {
      version: value.pricing.version,
      currency: 'CNY',
      estimatedCostPerTask: value.pricing.estimatedCostPerTask,
      estimatedTotalCost: value.pricing.estimatedTotalCost,
    },
    targets,
  }
}

export function issueStoryboardBatchVideoQuote(
  claims: StoryboardBatchVideoQuoteClaims,
  options: { now?: Date; ttlMs?: number } = {},
): string {
  const nowMs = (options.now ?? new Date()).getTime()
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > DEFAULT_TTL_MS) {
    throw new Error('BATCH_VIDEO_QUOTE_TTL_INVALID')
  }
  const payload = parseClaims({
    ...claims,
    tokenVersion: 1,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  })
  const encodedPayload = Buffer.from(
    JSON.stringify(canonicalize(payload as unknown as StoryboardBatchVideoJsonValue)),
    'utf8',
  ).toString('base64url')
  const signature = signatureFor(encodedPayload).toString('base64url')
  return `${TOKEN_VERSION}.${encodedPayload}.${signature}`
}

export function verifyStoryboardBatchVideoQuote(
  token: string,
  context: QuoteContext,
  options: { now?: Date } = {},
): SignedStoryboardBatchVideoQuote {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) fail('BATCH_VIDEO_QUOTE_INVALID')
  const [, encodedPayload, encodedSignature] = parts
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload) || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  let suppliedSignature: Buffer
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url')
  } catch {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  if (suppliedSignature.toString('base64url') !== encodedSignature) {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  const expectedSignature = signatureFor(encodedPayload)
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) fail('BATCH_VIDEO_QUOTE_INVALID')

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    fail('BATCH_VIDEO_QUOTE_INVALID')
  }
  const claims = parseClaims(decoded)
  if (
    claims.userId !== context.userId
    || claims.projectId !== context.projectId
    || claims.episodeId !== context.episodeId
  ) fail('BATCH_VIDEO_QUOTE_CONTEXT_MISMATCH')
  const nowMs = (options.now ?? new Date()).getTime()
  if (!Number.isFinite(nowMs) || nowMs > claims.expiresAtMs) {
    fail('BATCH_VIDEO_QUOTE_EXPIRED')
  }
  return claims
}

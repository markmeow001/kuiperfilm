import type {
  StoryboardBatchVideoJsonValue,
  StoryboardBatchVideoPanelSource,
  StoryboardBatchVideoQuoteClaims,
} from './storyboard-batch-video-quote'

type PanelSourceRow = {
  updatedAt: Date | string
  imageUrl: string | null
  imageMediaId: string | null
  description: string | null
  videoPrompt: string | null
  firstLastFramePrompt: string | null
  srtSegment: string | null
  videoUrl: string | null
  videoMediaId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function readJsonValue(value: unknown, depth = 0): StoryboardBatchVideoJsonValue | null | undefined {
  if (depth > 8) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items = value.map((item) => readJsonValue(item, depth + 1))
    return items.some((item) => item === undefined)
      ? undefined
      : items as StoryboardBatchVideoJsonValue[]
  }
  if (!isRecord(value)) return undefined
  const next: Record<string, StoryboardBatchVideoJsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    const parsed = readJsonValue(item, depth + 1)
    if (parsed === undefined) return undefined
    next[key] = parsed
  }
  return next
}

function readJsonRecord(value: unknown): Record<string, StoryboardBatchVideoJsonValue> | null {
  const parsed = readJsonValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : null
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function buildStoryboardBatchVideoPanelSource(
  panel: PanelSourceRow,
): StoryboardBatchVideoPanelSource {
  return {
    updatedAt: panel.updatedAt instanceof Date
      ? panel.updatedAt.toISOString()
      : new Date(panel.updatedAt).toISOString(),
    imageUrl: panel.imageUrl,
    imageMediaId: panel.imageMediaId,
    description: panel.description,
    videoPrompt: panel.videoPrompt,
    firstLastFramePrompt: panel.firstLastFramePrompt,
    srtSegment: panel.srtSegment,
    videoUrl: panel.videoUrl,
    videoMediaId: panel.videoMediaId,
  }
}

export function readStoryboardBatchVideoPanelSource(
  value: unknown,
): StoryboardBatchVideoPanelSource | null {
  if (!isRecord(value)) return null
  const updatedAt = value.updatedAt
  const imageUrl = value.imageUrl
  const imageMediaId = value.imageMediaId
  const description = value.description
  const videoPrompt = value.videoPrompt
  const firstLastFramePrompt = value.firstLastFramePrompt
  const srtSegment = value.srtSegment
  const videoUrl = value.videoUrl
  const videoMediaId = value.videoMediaId
  if (
    typeof updatedAt !== 'string'
    || !Number.isFinite(Date.parse(updatedAt))
    || !isNullableString(imageUrl)
    || !isNullableString(imageMediaId)
    || !isNullableString(description)
    || !isNullableString(videoPrompt)
    || !isNullableString(firstLastFramePrompt)
    || !isNullableString(srtSegment)
    || !isNullableString(videoUrl)
    || !isNullableString(videoMediaId)
  ) return null
  return {
    updatedAt,
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

export function buildStoryboardBatchVideoGenerationIdentity(input: {
  settings: StoryboardBatchVideoQuoteClaims['settings']
  source: StoryboardBatchVideoPanelSource
}): string {
  return JSON.stringify(canonicalize(input))
}

export function isStoryboardBatchVideoPanelSourceCurrent(
  expected: StoryboardBatchVideoPanelSource,
  panel: PanelSourceRow,
): boolean {
  return buildStoryboardBatchVideoGenerationIdentity({
    settings: { videoModel: '__source-only__' },
    source: expected,
  }) === buildStoryboardBatchVideoGenerationIdentity({
    settings: { videoModel: '__source-only__' },
    source: buildStoryboardBatchVideoPanelSource(panel),
  })
}

export function readStoryboardBatchVideoTaskIdentity(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const source = readStoryboardBatchVideoPanelSource(payload.panelSourceSnapshot)
  const videoModel = payload.videoModel
  if (!source || typeof videoModel !== 'string' || !videoModel.trim()) return null
  try {
    const generationOptions = readJsonRecord(payload.generationOptions)
    const firstLastFrame = readJsonRecord(payload.firstLastFrame)
    if (payload.generationOptions !== undefined && !generationOptions) return null
    if (payload.firstLastFrame !== undefined && !firstLastFrame) return null
    const settings: StoryboardBatchVideoQuoteClaims['settings'] = {
      videoModel,
      ...(generationOptions
        ? { generationOptions }
        : {}),
      ...(firstLastFrame
        ? { firstLastFrame }
        : {}),
    }
    const computedIdentity = buildStoryboardBatchVideoGenerationIdentity({ settings, source })
    const declaredIdentity = payload.batchGenerationIdentity
    if (
      declaredIdentity !== undefined
      && (typeof declaredIdentity !== 'string' || declaredIdentity !== computedIdentity)
    ) return null
    return computedIdentity
  } catch {
    return null
  }
}

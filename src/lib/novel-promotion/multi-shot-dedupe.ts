import { createHash } from 'node:crypto'

type MultiShotDedupeInput = {
  storyboardId: string
  payload: Record<string, unknown>
  skillId: string | null
  videoModelSource: 'skill-default' | 'user-explicit'
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    const item = source[key]
    if (item !== undefined) normalized[key] = canonicalize(item)
  }
  return normalized
}

/**
 * Task identity is the exact resolved render request. Arrays deliberately keep
 * their order because changing panel order changes the resulting film.
 */
export function buildMultiShotDedupeKey(input: MultiShotDedupeInput): string {
  const fingerprint = JSON.stringify(canonicalize({
    payload: input.payload,
    skillId: input.skillId,
    videoModelSource: input.videoModelSource,
  }))
  const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)
  return `video_multi_shot:${input.storyboardId}:${hash}`
}

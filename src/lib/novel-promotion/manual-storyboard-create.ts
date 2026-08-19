import { createHash } from 'node:crypto'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MANUAL_PANEL_DURATIONS = new Set([5, 10, 15])

export interface ManualStoryboardInitialPanel {
  description: string
  characterNames: string[]
  locationName: string | null
  durationSeconds: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

export function parseManualStoryboardInitialPanel(
  value: unknown,
): ManualStoryboardInitialPanel | null {
  if (value === undefined) return null
  if (!isRecord(value)) throw new Error('INVALID_MANUAL_STORYBOARD_INITIAL_PANEL')

  const description = readTrimmedString(value.description, 10_000)
  if (!description) throw new Error('INVALID_MANUAL_STORYBOARD_DESCRIPTION')

  if (!Array.isArray(value.characterNames) || value.characterNames.length > 50) {
    throw new Error('INVALID_MANUAL_STORYBOARD_CHARACTERS')
  }
  const characterNames = [...new Set(value.characterNames.map((name) => {
    const normalized = readTrimmedString(name, 200)
    if (!normalized) throw new Error('INVALID_MANUAL_STORYBOARD_CHARACTERS')
    return normalized
  }))]

  let locationName: string | null = null
  if (value.locationName !== null && value.locationName !== undefined) {
    locationName = readTrimmedString(value.locationName, 500)
    if (!locationName) throw new Error('INVALID_MANUAL_STORYBOARD_LOCATION')
  }

  if (
    typeof value.durationSeconds !== 'number'
    || !MANUAL_PANEL_DURATIONS.has(value.durationSeconds)
  ) {
    throw new Error('INVALID_MANUAL_STORYBOARD_DURATION')
  }

  return {
    description,
    characterNames,
    locationName,
    durationSeconds: value.durationSeconds,
  }
}

export function normalizeManualStoryboardIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error('INVALID_MANUAL_STORYBOARD_IDEMPOTENCY_KEY')
  }
  return value.toLowerCase()
}

function deterministicUuid(input: string): string {
  const bytes = createHash('sha256').update(input).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function deriveManualStoryboardIds(
  projectId: string,
  episodeId: string,
  idempotencyKey: string,
) {
  const namespace = `kuiper:manual-storyboard:${projectId}:${episodeId}:${idempotencyKey}`
  return {
    clipId: deterministicUuid(`${namespace}:clip`),
    storyboardId: deterministicUuid(`${namespace}:storyboard`),
    panelId: deterministicUuid(`${namespace}:panel`),
    multiShotGroupId: `manual-${deterministicUuid(`${namespace}:multi-shot-group`)}`,
  }
}

/** A manual insert retry must target the same unique row even when the
 * client lost the first response. Keep the request key out of the mutable
 * position/payload inputs so a changed replay collides and can fail closed. */
export function deriveManualPanelInsertId(
  projectId: string,
  episodeId: string,
  idempotencyKey: string,
): string {
  return deterministicUuid(
    `kuiper:manual-panel-insert:${projectId}:${episodeId}:${idempotencyKey}:panel`,
  )
}

export function manualStoryboardPanelMatches(
  panel: Record<string, unknown>,
  expected: ManualStoryboardInitialPanel,
  expectedGroupId: string,
): boolean {
  return panel.panelIndex === 0
    && panel.panelNumber === 1
    && panel.description === expected.description
    && panel.characters === JSON.stringify(expected.characterNames)
    && panel.location === expected.locationName
    && panel.duration === expected.durationSeconds
    && panel.multiShotGroupId === expectedGroupId
    && panel.multiShotGroupOrder === 0
}

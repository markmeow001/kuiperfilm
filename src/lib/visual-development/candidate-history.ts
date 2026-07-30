import type { Prisma } from '@prisma/client'

const HISTORY_KEY = 'candidateGenerationHistory'
const HISTORY_VERSION = 1
const MAX_REVISIONS_PER_CANDIDATE = 30

type JsonRecord = Record<string, unknown>

export interface CandidateGenerationSnapshot {
  taskId: string
  prompt: string
  negativePrompt: string | null
  requestedSeed: number | null
  effectiveSeed: number | null
  seedStatus: string
  modelKey: string
  provider: string
  modelId: string
  modelVersion: string | null
  aspectRatio: string
  resolution: string | null
  shortlisted: boolean
  isCanon: boolean
  rejectionNote: string | null
  createdAt: string
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseCandidateGenerationSnapshot(value: unknown): CandidateGenerationSnapshot | null {
  const record = toRecord(value)
  if (typeof record.taskId !== 'string' || typeof record.prompt !== 'string') return null
  if (
    typeof record.seedStatus !== 'string'
    || typeof record.modelKey !== 'string'
    || typeof record.provider !== 'string'
    || typeof record.modelId !== 'string'
    || typeof record.aspectRatio !== 'string'
    || typeof record.createdAt !== 'string'
  ) return null
  return {
    taskId: record.taskId,
    prompt: record.prompt,
    negativePrompt: nullableString(record.negativePrompt),
    requestedSeed: nullableNumber(record.requestedSeed),
    effectiveSeed: nullableNumber(record.effectiveSeed),
    seedStatus: record.seedStatus,
    modelKey: record.modelKey,
    provider: record.provider,
    modelId: record.modelId,
    modelVersion: nullableString(record.modelVersion),
    aspectRatio: record.aspectRatio,
    resolution: nullableString(record.resolution),
    shortlisted: record.shortlisted === true,
    isCanon: record.isCanon === true,
    rejectionNote: nullableString(record.rejectionNote),
    createdAt: record.createdAt,
  }
}

export function readCandidateGenerationHistory(
  promptStack: unknown,
  candidateId: string,
): CandidateGenerationSnapshot[] {
  const history = toRecord(toRecord(promptStack)[HISTORY_KEY])
  const byCandidate = toRecord(history.byCandidate)
  const snapshots = byCandidate[candidateId]
  if (!Array.isArray(snapshots)) return []
  return snapshots.flatMap((snapshot) => {
    const parsed = parseCandidateGenerationSnapshot(snapshot)
    return parsed ? [parsed] : []
  })
}

export function appendCandidateGenerationHistory(
  promptStack: unknown,
  candidateId: string,
  snapshot: CandidateGenerationSnapshot,
): Prisma.InputJsonObject {
  const root = toRecord(promptStack)
  const history = toRecord(root[HISTORY_KEY])
  const byCandidate = toRecord(history.byCandidate)
  const current = readCandidateGenerationHistory(promptStack, candidateId)
  const appended = [...current, snapshot]
  const next = appended.length <= MAX_REVISIONS_PER_CANDIDATE || !appended[0]
    ? appended
    : [appended[0], ...appended.slice(-(MAX_REVISIONS_PER_CANDIDATE - 1))]
  return {
    ...root,
    [HISTORY_KEY]: {
      version: HISTORY_VERSION,
      byCandidate: {
        ...byCandidate,
        [candidateId]: next.map((entry) => ({ ...entry })),
      },
    },
  } as Prisma.InputJsonObject
}

export function collectCandidateHistoryTaskIds(promptStacks: readonly unknown[]): string[] {
  const taskIds = new Set<string>()
  for (const promptStack of promptStacks) {
    const history = toRecord(toRecord(promptStack)[HISTORY_KEY])
    const byCandidate = toRecord(history.byCandidate)
    for (const snapshots of Object.values(byCandidate)) {
      if (!Array.isArray(snapshots)) continue
      for (const snapshot of snapshots) {
        const record = toRecord(snapshot)
        if (typeof record.taskId === 'string' && record.taskId) taskIds.add(record.taskId)
      }
    }
  }
  return [...taskIds]
}

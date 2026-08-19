'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../keys'

interface ReadyEpisodeDeliveryBase {
  status: 'ready'
  filename: string
  downloadUrl: string
  createdAt: string
}

export interface EpisodeDeliveryManifestSummary {
  version: 1
  fileCount: number
  selectedVideoCount: number
  multiShotVideoCount: number
  imageCount: number
  voiceAudioCount: number
  excludedVoiceLineCount: number
  scriptIncluded: true
  checksumAlgorithm: 'sha256'
}

export interface ReadyEpisodeDeliveryV1 extends ReadyEpisodeDeliveryBase {
  version: 'v1'
  taskId: string
  sourceFingerprint: string
  stale: boolean
  manifest: EpisodeDeliveryManifestSummary
}

export interface ReadyEpisodeDeliveryLegacy extends ReadyEpisodeDeliveryBase {
  version: 'legacy'
  taskId: null
  sourceFingerprint: null
  stale: null
  manifest: null
}

export type ReadyEpisodeDelivery =
  | ReadyEpisodeDeliveryV1
  | ReadyEpisodeDeliveryLegacy

export interface EpisodeDeliveryInput {
  canCreate: boolean
  selectedVideoCount: number
  imageCount: number
  multiShotVideoCount: number
  voiceAudioCount: number
  missingVoiceAudioCount: number
}

export interface EpisodeDeliveryResponse {
  success: true
  input: EpisodeDeliveryInput
  delivery: ReadyEpisodeDelivery | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseManifestSummary(
  value: unknown,
): EpisodeDeliveryManifestSummary | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonNegativeInteger(value.fileCount) ||
    !isNonNegativeInteger(value.selectedVideoCount) ||
    !isNonNegativeInteger(value.multiShotVideoCount) ||
    !isNonNegativeInteger(value.imageCount) ||
    !isNonNegativeInteger(value.voiceAudioCount) ||
    !isNonNegativeInteger(value.excludedVoiceLineCount) ||
    value.scriptIncluded !== true ||
    value.checksumAlgorithm !== 'sha256'
  ) {
    return null
  }
  return {
    version: 1,
    fileCount: value.fileCount,
    selectedVideoCount: value.selectedVideoCount,
    multiShotVideoCount: value.multiShotVideoCount,
    imageCount: value.imageCount,
    voiceAudioCount: value.voiceAudioCount,
    excludedVoiceLineCount: value.excludedVoiceLineCount,
    scriptIncluded: true,
    checksumAlgorithm: 'sha256',
  }
}

export function parseEpisodeDeliveryResponse(
  payload: unknown,
): EpisodeDeliveryResponse {
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error('Invalid episode delivery response')
  }

  const input = payload.input
  if (
    !isRecord(input) ||
    typeof input.canCreate !== 'boolean' ||
    !isNonNegativeInteger(input.selectedVideoCount) ||
    !isNonNegativeInteger(input.imageCount) ||
    !isNonNegativeInteger(input.multiShotVideoCount) ||
    !isNonNegativeInteger(input.voiceAudioCount) ||
    !isNonNegativeInteger(input.missingVoiceAudioCount)
  ) {
    throw new Error('Invalid episode delivery response')
  }

  const parsedInput: EpisodeDeliveryInput = {
    canCreate: input.canCreate,
    selectedVideoCount: input.selectedVideoCount,
    imageCount: input.imageCount,
    multiShotVideoCount: input.multiShotVideoCount,
    voiceAudioCount: input.voiceAudioCount,
    missingVoiceAudioCount: input.missingVoiceAudioCount,
  }

  if (payload.delivery === null) {
    return { success: true, input: parsedInput, delivery: null }
  }
  if (!isRecord(payload.delivery)) {
    throw new Error('Invalid episode delivery response')
  }

  const {
    status,
    filename,
    downloadUrl,
    version,
    taskId,
    createdAt,
    sourceFingerprint,
    stale,
    manifest,
  } = payload.delivery
  const validFilename =
    typeof filename === 'string' &&
    filename.trim().length > 0 &&
    !filename.includes('/') &&
    !filename.includes('\\')
  const validDownloadUrl =
    typeof downloadUrl === 'string' &&
    ((downloadUrl.startsWith('/') && !downloadUrl.startsWith('//')) ||
      isHttpUrl(downloadUrl))

  if (
    status !== 'ready' ||
    !validFilename ||
    !validDownloadUrl ||
    !isNonEmptyString(createdAt)
  ) {
    throw new Error('Invalid episode delivery response')
  }

  if (version === 'v1') {
    const parsedManifest = parseManifestSummary(manifest)
    if (
      !isNonEmptyString(taskId) ||
      !isNonEmptyString(sourceFingerprint) ||
      typeof stale !== 'boolean' ||
      !parsedManifest
    ) {
      throw new Error('Invalid episode delivery response')
    }
    return {
      success: true,
      input: parsedInput,
      delivery: {
        status: 'ready',
        filename: filename.trim(),
        downloadUrl,
        version: 'v1',
        taskId: taskId.trim(),
        createdAt: createdAt.trim(),
        sourceFingerprint: sourceFingerprint.trim(),
        stale,
        manifest: parsedManifest,
      },
    }
  }

  if (
    version !== 'legacy' ||
    taskId !== null ||
    sourceFingerprint !== null ||
    stale !== null ||
    manifest !== null
  ) {
    throw new Error('Invalid episode delivery response')
  }

  return {
    success: true,
    input: parsedInput,
    delivery: {
      status: 'ready',
      filename: filename.trim(),
      downloadUrl,
      version: 'legacy',
      taskId: null,
      createdAt: createdAt.trim(),
      sourceFingerprint: null,
      stale: null,
      manifest: null,
    },
  }
}

export function resolveSafeDeliveryDownloadUrl(
  candidate: string | null | undefined,
  currentOrigin?: string,
): string | null {
  if (!candidate) return null
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate
  }
  try {
    const url = new URL(candidate)
    if (url.protocol === 'https:') return url.href
    const origin =
      currentOrigin ??
      (typeof window !== 'undefined' ? window.location.origin : undefined)
    if (
      origin &&
      url.protocol === 'http:' &&
      url.origin === new URL(origin).origin
    ) {
      return url.href
    }
  } catch {
    return null
  }
  return null
}

export function useEpisodeDelivery(
  projectId: string | null,
  episodeId: string | null,
) {
  return useQuery({
    queryKey: queryKeys.episodeDelivery(projectId ?? '', episodeId ?? ''),
    queryFn: async (): Promise<EpisodeDeliveryResponse> => {
      if (!projectId || !episodeId) {
        throw new Error('Project ID and Episode ID are required')
      }
      const response = await fetch(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}/delivery`,
      )
      if (!response.ok) {
        throw new Error(`Delivery status request failed: HTTP ${response.status}`)
      }
      const payload: unknown = await response.json()
      return parseEpisodeDeliveryResponse(payload)
    },
    enabled: Boolean(projectId && episodeId),
    staleTime: 5_000,
  })
}

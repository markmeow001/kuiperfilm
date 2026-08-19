import { createHash } from 'node:crypto'
import { EpisodeDeliverySourceError } from '@/lib/novel-promotion/final-delivery'

export type EpisodeDeliveryManifestFileKind =
  | 'panel_selected_video'
  | 'panel_image'
  | 'multi_shot_video'
  | 'voice_audio'
  | 'script'
  | 'readme'

export type EpisodeDeliveryManifestFile = {
  sourceId: string
  kind: EpisodeDeliveryManifestFileKind
  path: string
  bytes: number
  sha256: string
}

export type EpisodeDeliveryManifestExcluded = {
  sourceId: string
  kind: 'voice_audio'
  reason: 'audio_url_missing'
}

export type EpisodeDeliveryManifestSummary = {
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

export type EpisodeDeliveryManifestV1 = {
  version: 1
  episodeId: string
  taskId: string
  sourceFingerprint: string
  checksumAlgorithm: 'sha256'
  files: EpisodeDeliveryManifestFile[]
  excluded: EpisodeDeliveryManifestExcluded[]
  summary: EpisodeDeliveryManifestSummary
}

function safeKeyPart(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
}

export function episodePackageStorageKey(episodeId: string, taskId: string): string {
  if (!safeKeyPart(episodeId) || !safeKeyPart(taskId)) {
    throw new EpisodeDeliverySourceError('EPISODE_PACKAGE_OUTPUT_INVALID')
  }
  return `images/episode-pack-${episodeId}-${taskId}.zip`
}

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function parseEpisodeDeliveryManifestSummary(
  value: unknown,
): EpisodeDeliveryManifestSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const manifest = value as Record<string, unknown>
  if (
    manifest.version !== 1
    || !nonNegativeInteger(manifest.fileCount)
    || !nonNegativeInteger(manifest.selectedVideoCount)
    || !nonNegativeInteger(manifest.multiShotVideoCount)
    || !nonNegativeInteger(manifest.imageCount)
    || !nonNegativeInteger(manifest.voiceAudioCount)
    || !nonNegativeInteger(manifest.excludedVoiceLineCount)
    || manifest.scriptIncluded !== true
    || manifest.checksumAlgorithm !== 'sha256'
  ) {
    return null
  }
  return {
    version: 1,
    fileCount: manifest.fileCount,
    selectedVideoCount: manifest.selectedVideoCount,
    multiShotVideoCount: manifest.multiShotVideoCount,
    imageCount: manifest.imageCount,
    voiceAudioCount: manifest.voiceAudioCount,
    excludedVoiceLineCount: manifest.excludedVoiceLineCount,
    scriptIncluded: true,
    checksumAlgorithm: 'sha256',
  }
}

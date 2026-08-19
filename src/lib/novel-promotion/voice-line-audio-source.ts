import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import {
  fetchVoiceAudioResource,
  VOICE_AUDIO_MAX_BYTES,
} from '@/lib/voice/safe-audio-fetch'

export type VoiceLineAudioSourceInput = {
  id: string
  episodeId: string
  audioUrl: string | null
  audioMediaId: string | null
  audioMedia: {
    id: string
    publicId: string
    storageKey: string
    mimeType: string | null
    sizeBytes: bigint | null
  } | null
}

export type OwnedVoiceLineAudioSource = {
  lineId: string
  episodeId: string
  storageKey: string
  provenance: 'audio_media' | 'legacy_generated'
  mediaId: string | null
  mimeType: string | null
  declaredSizeBytes: bigint | null
}

export class VoiceLineAudioSourceError extends Error {
  constructor() {
    super('VOICE_DOWNLOAD_SOURCE_INVALID')
    this.name = 'VoiceLineAudioSourceError'
  }
}

function mediaPublicIdFromRoute(value: string): string | null {
  if (!value.startsWith('/m/')) return null
  const encoded = value.slice('/m/'.length).split(/[?#]/, 1)[0]
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

function localStorageKeyFromValue(value: string): string | null {
  let candidate: string | null = null
  if (value.startsWith('/api/files/')) {
    const encoded = value.slice('/api/files/'.length).split(/[?#]/, 1)[0]
    try {
      candidate = decodeURIComponent(encoded).replace(/^\/+/, '') || null
    } catch {
      return null
    }
  } else {
    if (value.startsWith('/') || /^https?:/i.test(value) || /^data:/i.test(value)) return null
    candidate = value.replace(/^\/+/, '') || null
  }
  if (
    !candidate?.startsWith('voice/')
    || candidate.includes('..')
    || /[\\\r\n\0]/.test(candidate)
  ) {
    return null
  }
  return candidate
}

/**
 * Resolves a voice-line source only after the caller loaded the line through
 * its project/episode ownership chain. A MediaObject relation is exact proof;
 * generated rows are accepted only at either the legacy deterministic line
 * key or the immutable publication grammar scoped to the exact line.
 */
export function resolveOwnedVoiceLineAudioSource(
  scope: { projectId: string; episodeId: string },
  line: VoiceLineAudioSourceInput,
): OwnedVoiceLineAudioSource {
  if (line.episodeId !== scope.episodeId) throw new VoiceLineAudioSourceError()
  const value = line.audioUrl?.trim() || ''
  if (!value || /^https?:/i.test(value) || /^data:/i.test(value)) {
    throw new VoiceLineAudioSourceError()
  }
  if (
    line.audioMedia?.sizeBytes != null
    && line.audioMedia.sizeBytes > BigInt(VOICE_AUDIO_MAX_BYTES)
  ) {
    throw new VoiceLineAudioSourceError()
  }

  if (value.startsWith('/m/')) {
    const publicId = mediaPublicIdFromRoute(value)
    if (
      !publicId
      || !line.audioMediaId
      || !line.audioMedia
      || line.audioMedia.id !== line.audioMediaId
      || line.audioMedia.publicId !== publicId
      || !line.audioMedia.storageKey.trim()
    ) {
      throw new VoiceLineAudioSourceError()
    }
    return {
      lineId: line.id,
      episodeId: line.episodeId,
      storageKey: line.audioMedia.storageKey.trim(),
      provenance: 'audio_media',
      mediaId: line.audioMedia.id,
      mimeType: line.audioMedia.mimeType,
      declaredSizeBytes: line.audioMedia.sizeBytes,
    }
  }

  const legacyStorageKey = localStorageKeyFromValue(value)
  const expectedGeneratedKey = `voice/${scope.projectId}/${scope.episodeId}/${line.id}.wav`
  const immutableGeneratedPrefix = `voice/${scope.projectId}/${scope.episodeId}/${line.id}/`
  const immutableGeneratedSuffix = legacyStorageKey?.startsWith(immutableGeneratedPrefix)
    ? legacyStorageKey.slice(immutableGeneratedPrefix.length)
    : ''
  const isImmutableGeneratedKey = /^[a-f0-9]{32}-[a-f0-9]{64}\.wav$/.test(immutableGeneratedSuffix)
  if (
    !legacyStorageKey
    || (legacyStorageKey !== expectedGeneratedKey && !isImmutableGeneratedKey)
  ) {
    throw new VoiceLineAudioSourceError()
  }
  if (
    line.audioMediaId
    && (
      !line.audioMedia
      || line.audioMedia.id !== line.audioMediaId
      || line.audioMedia.storageKey.trim() !== legacyStorageKey
    )
  ) {
    throw new VoiceLineAudioSourceError()
  }
  return {
    lineId: line.id,
    episodeId: line.episodeId,
    storageKey: legacyStorageKey,
    provenance: 'legacy_generated',
    mediaId: line.audioMedia?.id ?? null,
    mimeType: line.audioMedia?.mimeType ?? null,
    declaredSizeBytes: line.audioMedia?.sizeBytes ?? null,
  }
}

export async function fetchOwnedVoiceLineAudio(
  source: OwnedVoiceLineAudioSource,
): Promise<{ data: Buffer; contentType: string }> {
  const fetchUrl = toFetchableUrl(getSignedUrl(source.storageKey, 3600))
  let trustedOrigin: string
  try {
    trustedOrigin = new URL(fetchUrl).origin
  } catch {
    throw new VoiceLineAudioSourceError()
  }
  return await fetchVoiceAudioResource(fetchUrl, {
    trustedInternalOrigins: [trustedOrigin],
  })
}

export function voiceAudioFileExtension(contentType: string): string {
  const extension = ({
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  } as Record<string, string>)[contentType]
  if (!extension) throw new VoiceLineAudioSourceError()
  return extension
}

const ACCEPTED_WAVE_CONTENT_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'application/octet-stream',
])

function invalidWave(): never {
  throw Object.assign(new Error('VOICE_PROVIDER_OUTPUT_WAV_INVALID'), {
    code: 'INVALID_PARAMS',
  })
}

export function inspectWaveAudio(
  data: Buffer,
  contentType: string,
): { durationMs: number } {
  const normalizedType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!ACCEPTED_WAVE_CONTENT_TYPES.has(normalizedType)) invalidWave()
  if (
    data.byteLength < 44
    || data.subarray(0, 4).toString('ascii') !== 'RIFF'
    || data.subarray(8, 12).toString('ascii') !== 'WAVE'
  ) {
    invalidWave()
  }

  const riffEnd = data.readUInt32LE(4) + 8
  if (riffEnd < 44 || riffEnd > data.byteLength) invalidWave()

  let byteRate: number | null = null
  let dataBytes: number | null = null
  let offset = 12
  while (offset + 8 <= riffEnd) {
    const chunkId = data.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = data.readUInt32LE(offset + 4)
    const chunkDataStart = offset + 8
    const chunkEnd = chunkDataStart + chunkSize
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > riffEnd) invalidWave()

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) invalidWave()
      const candidateByteRate = data.readUInt32LE(chunkDataStart + 8)
      const blockAlign = data.readUInt16LE(chunkDataStart + 12)
      if (candidateByteRate === 0 || blockAlign === 0) invalidWave()
      byteRate = candidateByteRate
    } else if (chunkId === 'data') {
      if (chunkSize === 0) invalidWave()
      dataBytes = chunkSize
    }

    const paddedEnd = chunkEnd + (chunkSize % 2)
    if (paddedEnd > riffEnd) invalidWave()
    offset = paddedEnd
  }

  if (byteRate === null || dataBytes === null) invalidWave()
  const durationMs = Math.round((dataBytes / byteRate) * 1000)
  if (!Number.isFinite(durationMs) || durationMs <= 0) invalidWave()
  return { durationMs }
}

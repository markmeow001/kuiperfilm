import { describe, expect, it } from 'vitest'
import { inspectWaveAudio } from '@/lib/voice/wave-audio'

function pcmWave(durationMs = 1000): Buffer {
  const sampleRate = 24_000
  const bytesPerSample = 2
  const dataSize = Math.round(sampleRate * bytesPerSample * durationMs / 1000)
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28)
  buffer.writeUInt16LE(bytesPerSample, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

describe('Atlas WAV output validation', () => {
  it('[完整 RIFF/WAVE 與 bounded chunks] -> [回傳精確音訊長度]', () => {
    expect(inspectWaveAudio(pcmWave(1250), 'audio/wav')).toEqual({ durationMs: 1250 })
  })

  it('[octet-stream 但 bytes 是合法 WAV] -> [依 magic 接受]', () => {
    expect(inspectWaveAudio(pcmWave(500), 'application/octet-stream')).toEqual({ durationMs: 500 })
  })

  it.each([
    ['錯誤 magic', Buffer.from('not-a-wave'), 'audio/wav'],
    ['偽造 MIME', pcmWave(), 'audio/mpeg'],
    ['chunk 宣告超出 buffer', (() => {
      const value = pcmWave()
      value.writeUInt32LE(0xffffffff, 40)
      return value
    })(), 'audio/wav'],
  ])('[%s] -> [顯式拒絕，不計價或持久化]', (_name, data, contentType) => {
    expect(() => inspectWaveAudio(data, contentType)).toThrow('VOICE_PROVIDER_OUTPUT_WAV_INVALID')
  })
})

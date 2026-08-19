import { describe, expect, it } from 'vitest'
import { canvasAudioPlaybackUrl } from '@/app/[locale]/canvas/nodes/audio-playback'

describe('canvas audio playback URL', () => {
  it('[有 durable audioKey 與過期 signed URL] -> [優先使用登入保護的同源代理]', () => {
    expect(canvasAudioPlaybackUrl({
      audioKey: 'voice/playground-ref/user-1/tts-node 1.wav',
      audioUrl: 'https://cos.example/expired.wav?signature=old',
    })).toBe('/api/canvas/asset?key=voice%2Fplayground-ref%2Fuser-1%2Ftts-node%201.wav')
  })

  it('[只有 legacy audioUrl] -> [保留既有播放網址]', () => {
    expect(canvasAudioPlaybackUrl({
      audioKey: null,
      audioUrl: 'https://cos.example/legacy.wav?signature=still-valid',
    })).toBe('https://cos.example/legacy.wav?signature=still-valid')
  })

  it('[沒有任何輸出] -> [不渲染播放來源]', () => {
    expect(canvasAudioPlaybackUrl({ audioKey: null, audioUrl: null })).toBeNull()
  })
})

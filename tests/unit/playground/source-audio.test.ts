import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workers/utils', () => ({
  uploadAudioSourceToCos: vi.fn(),
}))

import { buildReferenceAudioFfmpegArgs } from '@/lib/playground/source-audio'

describe('Playground source-audio encoding contract', () => {
  it('MP3 COS 副檔名 -> ffmpeg 產出真正 libmp3lame bytes，不再把 AAC/M4A 偽裝成 MP3', () => {
    const args = buildReferenceAudioFfmpegArgs(
      'https://storage.example/reference.mp4',
      '/tmp/reference.mp3',
    )

    expect(args).toEqual([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', 'https://storage.example/reference.mp4',
      '-map', '0:a:0', '-vn',
      '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000',
      '/tmp/reference.mp3',
    ])
    expect(args).not.toContain('aac')
  })
})

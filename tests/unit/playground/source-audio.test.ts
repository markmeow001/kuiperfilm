import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workers/utils', () => ({
  uploadAudioSourceToCos: vi.fn(),
}))

import {
  buildReferenceAudioFfmpegArgs,
  buildStripGeneratedAudioFfmpegArgs,
  stripGeneratedVideoAudio,
} from '@/lib/playground/source-audio'

describe('Playground source-audio encoding contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

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

  it('reference-only -> 輸出只映射生成影片畫面並明確移除所有音軌', () => {
    const args = buildStripGeneratedAudioFfmpegArgs(
      '/tmp/generated.mp4',
      '/tmp/silent.mp4',
    )

    expect(args).toEqual([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', '/tmp/generated.mp4',
      '-map', '0:v:0', '-c:v', 'copy', '-an',
      '-movflags', '+faststart', '/tmp/silent.mp4',
    ])
  })

  it('音軌後處理下載 -> 使用逾時訊號，並在供應商宣告檔案過大時先拒絕', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new Uint8Array([1]),
      {
        status: 200,
        headers: { 'content-length': String(256 * 1024 * 1024 + 1) },
      },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(stripGeneratedVideoAudio({
      generatedVideoUrl: 'https://provider.example/generated.mp4',
    })).rejects.toThrow('PLAYGROUND_GENERATED_VIDEO_TOO_LARGE')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

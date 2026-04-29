import { describe, expect, it } from 'vitest'
import {
  computeEpisodeProgress,
  type EpisodeProgressInput,
} from '@/app/[locale]/workspace/[projectId]/components/episode-progress'

/**
 * Phase 11.1 — episode progress (純函式)
 *
 * 合約（C/B/B/A 拍板）：
 *   scriptTotal     = clips.length
 *   scriptDone      = clips with non-empty screenplay
 *   storyboardTotal = sum of all panels across all storyboards
 *   storyboardDone  = panels with non-empty imageUrl
 *   videoTotal      = same as storyboardTotal
 *   videoDone       = panels with non-empty videoUrl
 */

function buildInput(input: Partial<EpisodeProgressInput>): EpisodeProgressInput {
  return {
    clips: input.clips ?? [],
    storyboards: input.storyboards ?? [],
  }
}

describe('computeEpisodeProgress', () => {
  it('空 clips + 空 storyboards -> 全部欄位為 0', () => {
    const result = computeEpisodeProgress(buildInput({}))

    expect(result).toEqual({
      scriptDone: 0,
      scriptTotal: 0,
      storyboardDone: 0,
      storyboardTotal: 0,
      videoDone: 0,
      videoTotal: 0,
    })
  })

  it('3 個 clips, 2 個有 screenplay -> scriptDone:2, scriptTotal:3', () => {
    const result = computeEpisodeProgress(
      buildInput({
        clips: [
          { screenplay: 'INT. LAB - DAY\nA scientist enters.' },
          { screenplay: null },
          { screenplay: 'EXT. STREET - NIGHT' },
        ],
      }),
    )

    expect(result.scriptTotal).toBe(3)
    expect(result.scriptDone).toBe(2)
  })

  it('空白字串 screenplay 視為未完成 -> scriptDone 不計入', () => {
    const result = computeEpisodeProgress(
      buildInput({
        clips: [
          { screenplay: '   ' },
          { screenplay: '\n' },
          { screenplay: 'real script' },
        ],
      }),
    )

    expect(result.scriptDone).toBe(1)
    expect(result.scriptTotal).toBe(3)
  })

  it('2 個 storyboards 合計 5 panels (3 imageUrl, 2 videoUrl) -> storyboardDone:3, videoDone:2, total:5', () => {
    const result = computeEpisodeProgress(
      buildInput({
        storyboards: [
          {
            panels: [
              { imageUrl: 'https://cdn/p1.png', videoUrl: 'https://cdn/v1.mp4' },
              { imageUrl: 'https://cdn/p2.png', videoUrl: null },
              { imageUrl: null, videoUrl: null },
            ],
          },
          {
            panels: [
              { imageUrl: 'https://cdn/p4.png', videoUrl: 'https://cdn/v4.mp4' },
              { imageUrl: null, videoUrl: null },
            ],
          },
        ],
      }),
    )

    expect(result.storyboardTotal).toBe(5)
    expect(result.storyboardDone).toBe(3)
    expect(result.videoTotal).toBe(5)
    expect(result.videoDone).toBe(2)
  })

  it('全完成: 10 個 panels 全有 image + video -> 所有 done = total', () => {
    const panels = Array.from({ length: 10 }, (_, i) => ({
      imageUrl: `https://cdn/img-${i}.png`,
      videoUrl: `https://cdn/vid-${i}.mp4`,
    }))
    const result = computeEpisodeProgress(
      buildInput({
        clips: [
          { screenplay: 'A' },
          { screenplay: 'B' },
        ],
        storyboards: [{ panels }],
      }),
    )

    expect(result.scriptDone).toBe(2)
    expect(result.scriptTotal).toBe(2)
    expect(result.storyboardDone).toBe(10)
    expect(result.storyboardTotal).toBe(10)
    expect(result.videoDone).toBe(10)
    expect(result.videoTotal).toBe(10)
  })

  it('imageUrl 有但 videoUrl 為空字串 -> videoDone 不計入', () => {
    const result = computeEpisodeProgress(
      buildInput({
        storyboards: [
          {
            panels: [
              { imageUrl: 'https://cdn/p1.png', videoUrl: '' },
              { imageUrl: 'https://cdn/p2.png', videoUrl: '   ' },
            ],
          },
        ],
      }),
    )

    expect(result.storyboardDone).toBe(2)
    expect(result.videoDone).toBe(0)
    expect(result.videoTotal).toBe(2)
  })

  it('storyboards 存在但 panels 全空 -> totals 為 0', () => {
    const result = computeEpisodeProgress(
      buildInput({
        storyboards: [{ panels: [] }, { panels: [] }],
      }),
    )

    expect(result.storyboardTotal).toBe(0)
    expect(result.videoTotal).toBe(0)
  })

  it('immutable -> 不會 mutate 入參的 clips / storyboards 陣列', () => {
    const input = buildInput({
      clips: [{ screenplay: 'A' }, { screenplay: null }],
      storyboards: [
        {
          panels: [
            { imageUrl: 'x', videoUrl: null },
          ],
        },
      ],
    })
    const beforeClips = JSON.stringify(input.clips)
    const beforeBoards = JSON.stringify(input.storyboards)

    computeEpisodeProgress(input)

    expect(JSON.stringify(input.clips)).toBe(beforeClips)
    expect(JSON.stringify(input.storyboards)).toBe(beforeBoards)
  })
})

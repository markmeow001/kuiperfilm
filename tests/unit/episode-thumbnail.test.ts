import { describe, expect, it } from 'vitest'
import {
  pickEpisodeThumbnail,
  type ThumbnailInput,
} from '@/app/[locale]/workspace/[projectId]/components/episode-thumbnail'

/**
 * Phase 11.1 — episode thumbnail 純函式
 *
 * 規則（依優先順序）：
 *   1. 第一個 storyboard 第一個 panel.imageUrl（非空）
 *   2. 沒 storyboard 但有 shots 第一個有 imageUrl → 回 shot url
 *   3. 全空 → null
 *   4. storyboards 存在但 panels 全空 → fallback shots
 *   5. shots 存在但全 imageUrl null → null
 */

function buildInput(input: Partial<ThumbnailInput>): ThumbnailInput {
  return {
    storyboards: input.storyboards ?? [],
    shots: input.shots ?? [],
  }
}

describe('pickEpisodeThumbnail', () => {
  it('第一個 storyboard 第一個 panel 有 imageUrl -> 回該 url', () => {
    const result = pickEpisodeThumbnail(
      buildInput({
        storyboards: [
          {
            panels: [
              { imageUrl: 'https://cdn.example/first.png' },
              { imageUrl: 'https://cdn.example/second.png' },
            ],
          },
          {
            panels: [
              { imageUrl: 'https://cdn.example/third.png' },
            ],
          },
        ],
        shots: [{ imageUrl: 'https://cdn.example/shot.png' }],
      }),
    )

    expect(result).toBe('https://cdn.example/first.png')
  })

  it('沒 storyboard 但 shots 第一個有 imageUrl -> 回 shot url', () => {
    const result = pickEpisodeThumbnail(
      buildInput({
        storyboards: [],
        shots: [
          { imageUrl: 'https://cdn.example/shot-a.png' },
          { imageUrl: 'https://cdn.example/shot-b.png' },
        ],
      }),
    )

    expect(result).toBe('https://cdn.example/shot-a.png')
  })

  it('全空（無 storyboard / 無 shots）-> 回 null', () => {
    const result = pickEpisodeThumbnail(buildInput({}))
    expect(result).toBeNull()
  })

  it('storyboards 存在但 panels 全空 -> fallback 至 shots', () => {
    const result = pickEpisodeThumbnail(
      buildInput({
        storyboards: [{ panels: [] }, { panels: [] }],
        shots: [{ imageUrl: 'https://cdn.example/fallback.png' }],
      }),
    )

    expect(result).toBe('https://cdn.example/fallback.png')
  })

  it('shots 存在但全 imageUrl null -> 回 null', () => {
    const result = pickEpisodeThumbnail(
      buildInput({
        storyboards: [],
        shots: [
          { imageUrl: null },
          { imageUrl: null },
        ],
      }),
    )

    expect(result).toBeNull()
  })

  it('storyboard panel imageUrl 是空字串 -> 跳過, 用後續第一個有效值', () => {
    const result = pickEpisodeThumbnail(
      buildInput({
        storyboards: [
          {
            panels: [
              { imageUrl: '' },
              { imageUrl: '   ' },
              { imageUrl: 'https://cdn.example/real.png' },
            ],
          },
        ],
      }),
    )

    expect(result).toBe('https://cdn.example/real.png')
  })

  it('storyboard panels 都空字串/null + shots 有效 -> fallback 至 shots', () => {
    const result = pickEpisodeThumbnail(
      buildInput({
        storyboards: [
          {
            panels: [
              { imageUrl: null },
              { imageUrl: '' },
            ],
          },
        ],
        shots: [{ imageUrl: 'https://cdn.example/shot-fallback.png' }],
      }),
    )

    expect(result).toBe('https://cdn.example/shot-fallback.png')
  })
})

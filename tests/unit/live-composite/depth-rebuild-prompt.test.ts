import { describe, expect, it } from 'vitest'
import { buildDepthRebuildPrompt } from '@/app/[locale]/live-composite/lib/depth-rebuild-prompt'

describe('深度引導 Seedance prompt', () => {
  it('有角色圖、場景圖與原音 -> 固定 video 1 / image 1 / image 2 角色並保留音訊時間', () => {
    const prompt = buildDepthRebuildPrompt({
      durationSeconds: 8,
      characterDescription: '穿黑色長風衣的年輕女偵探',
      sceneDescription: '雨夜的 1930 年代上海街道',
      hasSceneImage: true,
      preserveSourceAudio: true,
    })

    expect(prompt).toContain('video 1 = grayscale inverse-depth performance guide')
    expect(prompt).toContain('image 1 = the only identity and appearance reference')
    expect(prompt).toContain('image 2 = new environment and art-direction reference')
    expect(prompt).toContain('Use video 1 only for body silhouette, action order, walk path')
    expect(prompt).toContain('Do not copy grayscale color, original clothing, original face')
    expect(prompt).toContain('Preserve its dialogue timing, pauses, rhythm and emotional intensity')
    expect(prompt).toContain('穿黑色長風衣的年輕女偵探')
    expect(prompt).toContain('雨夜的 1930 年代上海街道')
  })

  it('沒有場景圖 -> 不建立不存在的 image 2 映射', () => {
    const prompt = buildDepthRebuildPrompt({
      durationSeconds: 5,
      characterDescription: '寫實電影角色',
      sceneDescription: '有動態人群與霓虹反射的夜市',
      hasSceneImage: false,
      preserveSourceAudio: false,
    })

    expect(prompt).not.toContain('image 2 =')
    expect(prompt).toContain('Build the new environment strictly from the scene direction below')
    expect(prompt).toContain('Do not invent spoken dialogue')
  })

  it('影片超過 15 秒 -> 生成 prompt 前顯式失敗', () => {
    expect(() => buildDepthRebuildPrompt({
      durationSeconds: 15.1,
      characterDescription: '角色',
      sceneDescription: '場景',
      hasSceneImage: false,
      preserveSourceAudio: false,
    })).toThrow('只支援 4–15 秒')
  })
})

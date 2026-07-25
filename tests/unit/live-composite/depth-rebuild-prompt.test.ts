import { describe, expect, it } from 'vitest'
import { buildDepthRebuildPrompt } from '@/app/[locale]/live-composite/lib/depth-rebuild-prompt'

describe('深度引導 Seedance prompt', () => {
  it('兩名角色與兩張場景圖 -> image 1-2 綁角色、image 3-4 綁場景且保留原音時間', () => {
    const prompt = buildDepthRebuildPrompt({
      durationSeconds: 8,
      characters: [
        {
          label: '新郎',
          sourceBinding: '原片左側、手持花束的男性',
          description: '電影寫實的民國青年，深色三件式西裝，短髮',
        },
        {
          label: '新娘',
          sourceBinding: '原片右側、挽著新郎手臂的女性',
          description: '電影寫實的民國女性，象牙白旗袍，低髮髻',
        },
      ],
      sceneReferences: [
        { note: '宅邸外觀與庭院構圖' },
        { note: '雨夜燈光與石板路材質' },
      ],
      sceneDescription: '雨夜的 1930 年代上海街道',
      preserveSourceAudio: true,
    })

    expect(prompt).toContain('video 1 = grayscale inverse-depth performance guide')
    expect(prompt).toContain('image 1 = identity, face, hair, body proportions, costume and styling for "新郎"')
    expect(prompt).toContain('image 2 = identity, face, hair, body proportions, costume and styling for "新娘"')
    expect(prompt).toContain('image 3 = new environment reference (宅邸外觀與庭院構圖)')
    expect(prompt).toContain('image 4 = new environment reference (雨夜燈光與石板路材質)')
    expect(prompt).toContain('Replace only the performer identified as "原片左側、手持花束的男性" with "新郎" from image 1')
    expect(prompt).toContain('Replace only the performer identified as "原片右側、挽著新郎手臂的女性" with "新娘" from image 2')
    expect(prompt).toContain('Use image 3 and image 4 together as visual references for the new environment')
    expect(prompt).toContain('Never swap, merge or duplicate identities')
    expect(prompt).toContain('Preserve its dialogue timing, pauses, rhythm and emotional intensity')
    expect(prompt).toContain('電影寫實的民國青年，深色三件式西裝，短髮')
    expect(prompt).toContain('電影寫實的民國女性，象牙白旗袍，低髮髻')
    expect(prompt).toContain('雨夜的 1930 年代上海街道')
  })

  it('沒有場景圖 -> 只建立角色 image 1，不引用不存在的 image 2', () => {
    const prompt = buildDepthRebuildPrompt({
      durationSeconds: 5,
      characters: [
        {
          label: '女偵探',
          sourceBinding: '原片唯一表演者',
          description: '穿黑色長風衣的寫實電影角色',
        },
      ],
      sceneReferences: [],
      sceneDescription: '有動態人群與霓虹反射的夜市',
      preserveSourceAudio: false,
    })

    expect(prompt).toContain('image 1 = identity, face, hair, body proportions, costume and styling for "女偵探"')
    expect(prompt).not.toContain('image 2 =')
    expect(prompt).toContain('Build the new environment strictly from the scene direction below')
    expect(prompt).toContain('Do not invent spoken dialogue')
  })

  it('影片超過 15 秒 -> 生成 prompt 前顯式失敗', () => {
    expect(() => buildDepthRebuildPrompt({
      durationSeconds: 15.1,
      characters: [
        {
          label: '角色',
          sourceBinding: '原片唯一表演者',
          description: '寫實人物',
        },
      ],
      sceneReferences: [],
      sceneDescription: '場景',
      preserveSourceAudio: false,
    })).toThrow('只支援 4–15 秒')
  })

  it('多人與場景描述合成後超過 6000 字 -> 建立 prompt 時顯式失敗', () => {
    expect(() => buildDepthRebuildPrompt({
      durationSeconds: 10,
      characters: [
        {
          label: '角色 A',
          sourceBinding: '原片左側人物',
          description: '角色外觀'.repeat(900),
        },
      ],
      sceneReferences: [{ note: '場景參考' }],
      sceneDescription: '動態場景'.repeat(900),
      preserveSourceAudio: false,
    })).toThrow('超過 Seedance Prompt 上限 6000 字')
  })
})

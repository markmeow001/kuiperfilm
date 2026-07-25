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
        { note: '宅邸外觀與庭院材質' },
        { note: '雨夜燈光與石板路材質' },
      ],
      sceneDescription: '雨夜的 1930 年代上海街道',
      sourceAudioMode: 'preserve',
    })

    expect(prompt).toContain('video 1 = grayscale inverse-depth performance guide')
    expect(prompt).toContain('image 1 = identity, face, hair, body proportions, costume and styling for "新郎"')
    expect(prompt).toContain('image 2 = identity, face, hair, body proportions, costume and styling for "新娘"')
    expect(prompt).toContain('image 3 = new environment reference (宅邸外觀與庭院材質)')
    expect(prompt).toContain('image 4 = new environment reference (雨夜燈光與石板路材質)')
    expect(prompt).toContain('Replace only the performer identified as "原片左側、手持花束的男性" with "新郎" from image 1')
    expect(prompt).toContain('Replace only the performer identified as "原片右側、挽著新郎手臂的女性" with "新娘" from image 2')
    expect(prompt).toContain('Use image 3 and image 4 together only as visual references for the new environment')
    expect(prompt).toContain('Never swap, merge or duplicate identities')
    expect(prompt).toContain('must remain in the final output')
    expect(prompt).toContain('Do not clean, replace or reinterpret the source recording')
    expect(prompt).toContain('電影寫實的民國青年，深色三件式西裝，短髮')
    expect(prompt).toContain('電影寫實的民國女性，象牙白旗袍，低髮髻')
    expect(prompt).toContain('雨夜的 1930 年代上海街道')
  })

  it('人物與場景參考只控制外觀，逐格沿用原片景別且不得拉遠露出畫外肢體', () => {
    const prompt = buildDepthRebuildPrompt({
      durationSeconds: 6,
      characters: [
        {
          label: '新角色',
          sourceBinding: '原片中央、畫面只拍到大腿的人物',
          description: '電影寫實的新角色造型',
        },
      ],
      sceneReferences: [{ note: '老宅建築、牆面材質與暖色光線' }],
      sceneDescription: '有微風吹動樹葉的老宅庭院',
      sourceAudioMode: 'generate',
    })

    expect(prompt).toContain('Use image 1 only for appearance')
    expect(prompt).toContain(
      'Ignore its pose, action, original background, camera distance, lens, framing and full-body crop or composition',
    )
    expect(prompt).toContain(
      'Do not use scene reference images to control or change composition, crop, framing, camera path, lens, camera distance',
    )
    expect(prompt).toContain('[HIGH PRIORITY FRAMING LOCK]')
    expect(prompt).toContain('not an API-level camera lock')
    expect(prompt).toContain(
      'In every frame, follow video 1 exactly for camera path, lens perspective, camera-to-subject distance, headroom',
    )
    expect(prompt).toContain('subject pixel height, subject screen occupancy and anatomical crop')
    expect(prompt).toContain(
      'Never zoom out, dolly out, reframe, widen the shot or reveal a full body when video 1 does not',
    )
    expect(prompt).toContain(
      'Lower legs, feet, arms, props or any other body parts outside video 1 at a given moment must remain outside the output frame',
    )
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
      sourceAudioMode: 'generate',
    })

    expect(prompt).toContain('image 1 = identity, face, hair, body proportions, costume and styling for "女偵探"')
    expect(prompt).not.toContain('image 2 =')
    expect(prompt).toContain('Build the new environment strictly from the scene direction below')
    expect(prompt).toContain('The source audio has been removed')
    expect(prompt).toContain('spoken words may differ')
  })

  it('只參考原音 -> 保留口型節奏，但明確要求輸出靜音', () => {
    const prompt = buildDepthRebuildPrompt({
      durationSeconds: 5,
      characters: [{
        label: '新角色',
        sourceBinding: '原片唯一表演者',
        description: '電影寫實角色',
      }],
      sceneReferences: [],
      sceneDescription: '持續有細微環境動態的室內場景',
      sourceAudioMode: 'reference-only',
    })

    expect(prompt).toContain('only as a timing reference for dialogue')
    expect(prompt).toContain('The final output must be silent')
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
      sourceAudioMode: 'generate',
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
      sourceAudioMode: 'generate',
    })).toThrow('超過 Seedance Prompt 上限 6000 字')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildDepthRebuildPrompt,
  buildDepthRebuildSegmentPrompt,
  type DepthRebuildPromptInput,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-prompt'
import {
  createDepthRebuildMotionContract,
  DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
  type DepthRebuildMotionSettings,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-motion-contract'

const DEFAULT_CHARACTERS: DepthRebuildPromptInput['characters'] = [{
  label: '新角色',
  sourceBinding: '原片唯一表演者',
  description: '電影寫實角色',
}]

function buildPromptInput(
  overrides: Partial<DepthRebuildPromptInput> = {},
  motionOverrides: Partial<DepthRebuildMotionSettings> = {},
): DepthRebuildPromptInput {
  const durationSeconds = overrides.durationSeconds ?? 6
  const characters = overrides.characters ?? DEFAULT_CHARACTERS
  const motionCharacters = characters.map((character, index) => ({
    id: `character-${index + 1}`,
    label: character.label,
    sourceBinding: character.sourceBinding,
  }))
  const settings: DepthRebuildMotionSettings = {
    ...DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
    ...motionOverrides,
  }

  return {
    durationSeconds,
    characters,
    sceneReferences: [],
    sceneDescription: '有持續環境動態的電影寫實場景',
    sourceAudioMode: 'generate',
    ...overrides,
    motionContract: overrides.motionContract ?? createDepthRebuildMotionContract({
      durationSeconds,
      characters: motionCharacters,
      settings,
    }),
  }
}

describe('深度引導 Seedance prompt', () => {
  it('兩名角色與兩張場景圖 -> RGB 掌管表演、Depth 只管幾何，image 1–4 綁定正確', () => {
    const prompt = buildDepthRebuildPrompt(buildPromptInput({
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
    }))

    expect(prompt).toContain(
      'video 1 = original RGB performance video. It is the sole authority for camera path, camera direction, shot timing, framing, head direction, gaze',
    )
    expect(prompt).toContain(
      'video 2 = synchronized grayscale inverse-depth geometry guide; white is nearer to camera and black is farther away',
    )
    expect(prompt).toContain(
      'It must never override video 1 for camera direction, head direction, gaze, expression or interaction',
    )
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
  })

  it('後退跟拍＋人物前進＋大腿景 -> Prompt 明確禁止運鏡反轉、拉遠與視線漂移', () => {
    const prompt = buildDepthRebuildPrompt(buildPromptInput({
      durationSeconds: 6,
      characters: [
        {
          label: '男方',
          sourceBinding: '原片左側男性',
          description: '深色西裝的電影寫實男性',
        },
        {
          label: '女方',
          sourceBinding: '原片右側女性',
          description: '象牙白洋裝的電影寫實女性',
        },
      ],
      sceneReferences: [{ note: '老宅建築、牆面材質與暖色光線' }],
      sceneDescription: '有微風吹動樹葉的老宅庭院',
    }, {
      cameraDirection: 'backward',
      framingCrop: 'thigh-up',
      subjectDirection: 'forward',
      singleTake: true,
      noDirectionReversal: true,
      gazeSourceCharacterId: 'character-1',
      gazeTargetCharacterId: 'character-2',
      interactionDescription: 'maintains linked-arm contact and matched walking rhythm',
    }))

    expect(prompt).toContain('[MOTION CONTRACT — HIGHEST PRIORITY]')
    expect(prompt).toContain('The camera tracks backward, away from the advancing subjects')
    expect(prompt).toContain('The camera must never advance, push in, or reverse direction at any moment')
    expect(prompt).toContain('The 男方 stays on screen-left and moves forward toward the camera')
    expect(prompt).toContain('keeps their eyes on the 女方 for the entire interval')
    expect(prompt).toContain(
      'Maintain the same thigh-up crop in every frame. Do not widen, zoom out, reveal lower legs or feet, or change the anatomical cutoff',
    )
    expect(prompt).toContain(
      'Do not use scene reference images to control or change composition, crop, framing, camera path, lens, camera distance',
    )
    expect(prompt).toContain('not an API-level camera lock')
    expect(prompt).toContain(
      'Never zoom out, dolly out, reframe, widen the shot or reveal a full body when video 1 does not',
    )
  })

  it('沒有場景圖 -> 只建立角色 image 1，不引用不存在的 image 2', () => {
    const prompt = buildDepthRebuildPrompt(buildPromptInput({
      durationSeconds: 5,
      characters: [{
        label: '女偵探',
        sourceBinding: '原片唯一表演者',
        description: '穿黑色長風衣的寫實電影角色',
      }],
      sceneReferences: [],
      sceneDescription: '有動態人群與霓虹反射的夜市',
      sourceAudioMode: 'generate',
    }))

    expect(prompt).toContain('image 1 = identity, face, hair, body proportions, costume and styling for "女偵探"')
    expect(prompt).not.toContain('image 2 =')
    expect(prompt).toContain('Build the new environment strictly from the scene direction below')
    expect(prompt).toContain('The source audio has been removed')
    expect(prompt).toContain('spoken words may differ')
  })

  it('只參考原音 -> video 1 提供口型節奏，但成片明確保持靜音', () => {
    const prompt = buildDepthRebuildPrompt(buildPromptInput({
      durationSeconds: 5,
      sourceAudioMode: 'reference-only',
    }))

    expect(prompt).toContain('original audio carried by video 1 only as a timing reference for dialogue')
    expect(prompt).toContain('The final output must be silent')
  })

  it('第二分段含銜接末幀 -> 延續同一鏡且銜接圖不得改寫 RGB 運鏡、動作與視線', () => {
    const prompt = buildDepthRebuildSegmentPrompt(
      buildPromptInput({ durationSeconds: 5.5 }),
      {
        index: 1,
        count: 2,
        sourceStartSeconds: 5.5,
        sourceEndSeconds: 11,
        continuityImageToken: 'image 3',
      },
    )

    expect(prompt).toContain('[SEGMENT 2 OF 2]')
    expect(prompt).toContain('source interval 5.50s–11.00s')
    expect(prompt).toContain('video 1 and video 2 are already trimmed to this exact synchronized interval')
    expect(prompt).toContain(
      'Continue the same uninterrupted take. Do not restart the action, reverse camera direction, reset the performers, or introduce a new shot',
    )
    expect(prompt).toContain('[SEGMENT CONTINUITY IMAGE]')
    expect(prompt).toContain('image 3 = the previous generated segment\'s final frame')
    expect(prompt).toContain('It must not change the RGB camera path, action, gaze or timing')
  })

  it('第一分段 -> 從來源姿勢與運鏡直接開始，不新增開場建立鏡頭', () => {
    const prompt = buildDepthRebuildSegmentPrompt(
      buildPromptInput({ durationSeconds: 5.5 }),
      {
        index: 0,
        count: 2,
        sourceStartSeconds: 0,
        sourceEndSeconds: 5.5,
      },
    )

    expect(prompt).toContain('[SEGMENT 1 OF 2]')
    expect(prompt).toContain(
      'Begin at the exact source pose, framing and camera direction; do not add an establishing lead-in',
    )
    expect(prompt).not.toContain('[SEGMENT CONTINUITY IMAGE]')
  })

  it('影片超過 15 秒 -> 生成 Prompt 前顯式失敗', () => {
    expect(() => buildDepthRebuildPrompt(buildPromptInput({
      durationSeconds: 15.1,
    }))).toThrow('只支援 4–15 秒')
  })

  it('分段序號或來源時間窗無效 -> 明確阻擋，不建立含糊 Prompt', () => {
    const input = buildPromptInput({ durationSeconds: 5 })

    expect(() => buildDepthRebuildSegmentPrompt(input, {
      index: 2,
      count: 2,
      sourceStartSeconds: 5,
      sourceEndSeconds: 10,
    })).toThrow('深度重建分段序號無效')
    expect(() => buildDepthRebuildSegmentPrompt(input, {
      index: 0,
      count: 1,
      sourceStartSeconds: 5,
      sourceEndSeconds: 5,
    })).toThrow('深度重建來源時間窗無效')
  })

  it('多人與場景描述合成後超過 6000 字 -> 建立 Prompt 時顯式失敗', () => {
    expect(() => buildDepthRebuildPrompt(buildPromptInput({
      durationSeconds: 10,
      characters: [{
        label: '角色 A',
        sourceBinding: '原片左側人物',
        description: '角色外觀'.repeat(900),
      }],
      sceneReferences: [{ note: '場景參考' }],
      sceneDescription: '動態場景'.repeat(900),
    }))).toThrow('超過 Seedance Prompt 上限 6000 字')
  })
})

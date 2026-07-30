import { describe, expect, it } from 'vitest'
import {
  buildMotionContractPromptSection,
  createDepthRebuildMotionContract,
  DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
  DEFAULT_WEDDING_MOTION_CONTRACT,
  type DepthRebuildMotionContract,
  validateMotionContract,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-motion-contract'

describe('深度重建動作契約', () => {
  it('通用預設 -> 運鏡、人物、構圖、頭部與視線逐格跟隨 RGB 原片', () => {
    const contract = createDepthRebuildMotionContract({
      durationSeconds: 8,
      characters: [{
        id: 'performer',
        label: 'performer',
        sourceBinding: '原片主要表演者',
      }],
      settings: DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
    })
    const prompt = buildMotionContractPromptSection(contract)

    expect(contract.camera).toEqual({
      direction: 'source-matched',
      continuous: false,
      noDirectionReversal: false,
      speed: 'source-matched',
    })
    expect(contract.framing).toEqual({
      crop: 'source-matched',
      locked: true,
      subjectScale: 'source-matched',
    })
    expect(contract.characters[0]).toMatchObject({
      screenSide: 'source-matched',
      motion: {
        direction: 'source-matched',
        relationToCamera: 'source-matched',
        continuous: false,
      },
      gaze: { kind: 'source-matched' },
      headDirection: { kind: 'source-matched' },
    })
    expect(prompt).toContain(
      'The camera path, direction, speed, distance, pauses and accelerations must match video 1 at each timestamp.',
    )
    expect(prompt).toContain(
      'matches their head direction and turn timing to video 1 at each timestamp and matches their gaze target and eye movement to video 1 at each timestamp',
    )
    expect(prompt).not.toContain('toward-camera')
    expect(prompt).not.toContain('full-body crop')
  })

  it('角色上傳順序與原片左右相反 -> 只採用明確 sourceBinding，不以陣列順序猜站位', () => {
    const contract = createDepthRebuildMotionContract({
      durationSeconds: 6,
      characters: [
        { id: 'bride', label: 'bride', sourceBinding: '原片右側、挽著手臂的女性' },
        { id: 'groom', label: 'groom', sourceBinding: '原片左侧、手持花束的男性' },
        { id: 'guest', label: 'guest', sourceBinding: '原片戴帽子的來賓' },
      ],
      settings: DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
    })

    expect(contract.characters.map((character) => ({
      id: character.id,
      screenSide: character.screenSide,
    }))).toEqual([
      { id: 'bride', screenSide: 'screen-right' },
      { id: 'groom', screenSide: 'screen-left' },
      { id: 'guest', screenSide: 'source-matched' },
    ])
  })

  it('預設婚禮片 -> 契約通過時間與角色交叉引用驗證', () => {
    expect(validateMotionContract(DEFAULT_WEDDING_MOTION_CONTRACT)).toEqual({
      valid: true,
      issues: [],
    })
  })

  it('零角色自由重繪 -> 契約通過驗證，Prompt 只輸出運鏡與構圖規則', () => {
    const contract = createDepthRebuildMotionContract({
      durationSeconds: 6,
      characters: [],
      settings: DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
    })
    expect(validateMotionContract(contract)).toEqual({ valid: true, issues: [] })
    const prompt = buildMotionContractPromptSection(contract)
    expect(prompt).toContain('SHOT CONTINUITY')
  })

  it('預設婚禮片 -> 英文 Prompt 強制全程後退、人物前進且不得反向', () => {
    const prompt = buildMotionContractPromptSection(DEFAULT_WEDDING_MOTION_CONTRACT)

    expect(prompt).toContain('[0.0s–11.2s | SHOT CONTINUITY]')
    expect(prompt).toContain(
      'ONE continuous take from the first frame to the last. No cuts, transitions, time jumps, or alternate angles.',
    )
    expect(prompt).toContain(
      'The camera tracks backward, away from the advancing subjects at a steady speed.',
    )
    expect(prompt).toContain(
      'This camera motion is continuous and may not pause or change direction.',
    )
    expect(prompt).toContain(
      'The camera must never advance, push in, or reverse direction at any moment.',
    )
    expect(prompt).toContain(
      'The groom stays on screen-left and moves forward toward the camera continuously, without stopping or reversing direction at a steady speed.',
    )
    expect(prompt).toContain(
      'The bride stays on screen-right and moves forward toward the camera continuously, without stopping or reversing direction at a steady speed.',
    )
  })

  it('預設婚禮片 -> Prompt 全程維持大腿景且新郎頭部與視線朝向新娘', () => {
    const prompt = buildMotionContractPromptSection(DEFAULT_WEDDING_MOTION_CONTRACT)

    expect(prompt).toContain('[0.0s–11.2s | FRAMING]')
    expect(prompt).toContain(
      'Maintain the same thigh-up crop in every frame. Do not widen, zoom out, reveal lower legs or feet, or change the anatomical cutoff.',
    )
    expect(prompt).toContain(
      "Keep each subject's apparent on-screen size nearly constant from the first frame to the last.",
    )
    expect(prompt).toContain('[0.0s–11.2s | GROOM]')
    expect(prompt).toContain(
      'The groom keeps their head turned screen-right toward the bride continuously and keeps their eyes on the bride for the entire interval.',
    )
    expect(prompt).toContain(
      'Interaction: the groom maintains the linked-arm contact and matched walking rhythm with the bride continuously.',
    )
  })

  it('契約引用不存在角色 -> 建立 Prompt 時顯式失敗並指出角色 id', () => {
    const invalidContract: DepthRebuildMotionContract = {
      ...DEFAULT_WEDDING_MOTION_CONTRACT,
      characters: [
        {
          ...DEFAULT_WEDDING_MOTION_CONTRACT.characters[0],
          gaze: {
            kind: 'toward-character',
            targetCharacterId: 'missing-bride',
            continuous: true,
          },
        },
        DEFAULT_WEDDING_MOTION_CONTRACT.characters[1],
      ],
    }

    expect(() => buildMotionContractPromptSection(invalidContract)).toThrow(
      '角色 1 引用了不存在的角色 id：missing-bride',
    )
  })

  it('建立 Prompt -> 不改寫輸入契約', () => {
    const before = JSON.stringify(DEFAULT_WEDDING_MOTION_CONTRACT)

    buildMotionContractPromptSection(DEFAULT_WEDDING_MOTION_CONTRACT)

    expect(JSON.stringify(DEFAULT_WEDDING_MOTION_CONTRACT)).toBe(before)
  })
})

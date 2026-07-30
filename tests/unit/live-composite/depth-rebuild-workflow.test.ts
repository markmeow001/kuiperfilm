import { describe, expect, it } from 'vitest'
import {
  buildDepthRebuildFingerprint,
  depthRebuildAspectRatio,
  depthRebuildDurationSeconds,
  getDepthRebuildPromptValidationError,
  getDepthRebuildValidationError,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-workflow'
import { DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS } from '@/app/[locale]/live-composite/lib/depth-rebuild-motion-contract'

function validationCharacter(index: number) {
  return {
    label: `新角色 ${index}`,
    sourceBinding: `替換原片開場畫面第 ${index} 位人物`,
    description: `電影寫實的新角色 ${index}，服裝與髮型保持逐幀一致`,
    imageExists: true,
  }
}

const baseValidation = {
  sourceDurationSeconds: 12,
  sourceVideoAvailable: true,
  depthGuideExists: true,
  depthGuideSufficient: true,
  characters: [validationCharacter(1)],
  sceneReferenceCount: 0,
  reservedReferenceImageCount: 0,
  sceneDescription: '上海雨夜街道，車流與招牌持續運動',
  modelKey: 'atlascloud::seedance-2.0-r2v',
  resolution: '720p',
  enabledModelKeys: ['atlascloud::seedance-2.0-r2v'],
  sourceAudioMode: 'preserve',
  sourceAudioDetected: true,
  prompt: 'depth-guided reconstruction prompt',
  segmentPromptCount: 1,
  promptIsFresh: true,
} as const

function promptValidation(overrides: Partial<Parameters<typeof getDepthRebuildPromptValidationError>[0]> = {}) {
  return getDepthRebuildPromptValidationError({
    sourceDurationSeconds: baseValidation.sourceDurationSeconds,
    characters: baseValidation.characters,
    sceneReferenceCount: baseValidation.sceneReferenceCount,
    sceneDescription: baseValidation.sceneDescription,
    ...overrides,
  })
}

describe('depth rebuild workflow', () => {
  it('完整有效設定 -> 通過提交前驗證', () => {
    expect(getDepthRebuildValidationError(baseValidation)).toBeNull()
    expect(depthRebuildDurationSeconds(12.4)).toBe(13)
    expect(depthRebuildAspectRatio(1920, 1080)).toBe('16:9')
    expect(depthRebuildAspectRatio(1080, 1920)).toBe('9:16')
    expect(depthRebuildAspectRatio(1440, 1080)).toBe('4:3')
    expect(depthRebuildAspectRatio(1080, 1440)).toBe('3:4')
    expect(depthRebuildAspectRatio(2520, 1080)).toBe('21:9')
  })

  it('多角色時缺少原片人物綁定 -> 明確阻擋付費生成', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      characters: [
        validationCharacter(1),
        {
          ...validationCharacter(2),
          label: '女記者',
          sourceBinding: '   ',
        },
      ],
    })).toBe('請描述「女記者」要替換原片中的哪一位人物')
  })

  it('單一角色留空綁定 -> 自動綁定唯一表演者、通過驗證', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      characters: [{
        ...validationCharacter(1),
        sourceBinding: '   ',
      }],
    })).toBeNull()
  })

  it('零角色自由重繪模式 -> 保留原表演者、通過驗證', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      characters: [],
    })).toBeNull()
    expect(promptValidation({ characters: [] })).toBeNull()
  })

  it('免費 Prompt 驗證 -> 不依賴深度影片、模型、估價或既有 Prompt', () => {
    expect(promptValidation()).toBeNull()
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      depthGuideExists: false,
    })).toBe('請先產生深度引導影片')
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      depthGuideSufficient: false,
    })).toBe('深度引導影片有效幀率不足，請重新產生後再生成')
  })

  it('只有預覽網址而沒有 RGB 原始檔 -> 付費前明確阻擋雙引導生成', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      sourceVideoAvailable: false,
    })).toBe('目前只找到預覽網址，缺少可安全送出的 RGB 原片；請重新上傳原始表演影片')
  })

  it.each([
    {
      label: '缺少原片',
      overrides: { sourceDurationSeconds: null },
      expected: '請先上傳原始表演影片',
    },
    {
      label: '角色缺圖',
      overrides: { characters: [{ ...validationCharacter(1), imageExists: false }] },
      expected: '請上傳角色 1 的參考圖片',
    },
    {
      label: '角色缺名稱',
      overrides: { characters: [{ ...validationCharacter(1), label: ' ' }] },
      expected: '請填寫角色 1 的名稱',
    },
    {
      // 單一角色留空綁定會自動綁定唯一表演者；多角色才要求逐一指定。
      label: '多角色缺人物對應',
      overrides: {
        characters: [
          validationCharacter(1),
          { ...validationCharacter(2), label: '女記者', sourceBinding: ' ' },
        ],
      },
      expected: '請描述「女記者」要替換原片中的哪一位人物',
    },
    {
      label: '角色缺正式描述',
      overrides: {
        characters: [{ ...validationCharacter(1), label: '女記者', description: ' ' }],
      },
      expected: '請填寫「女記者」的角色補充描述',
    },
    {
      label: '缺場景描述',
      overrides: { sceneDescription: ' ' },
      expected: '請填寫新場景描述',
    },
  ])('$label -> Step 03 回傳第一個可修正缺項', ({ overrides, expected }) => {
    expect(promptValidation(overrides)).toBe(expected)
  })

  it('角色名稱重複 -> 阻擋含糊的多人圖片對應', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      characters: [
        { ...validationCharacter(1), label: '女記者' },
        { ...validationCharacter(2), label: '女記者' },
      ],
    })).toBe('角色名稱「女記者」重複，請使用不同名稱')
  })

  it('兩位新角色綁定同一位原片人物 -> 阻擋互相衝突的替換指令', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      characters: [
        {
          ...validationCharacter(1),
          label: '新郎',
          sourceBinding: ' 開場畫面左側男性 ',
        },
        {
          ...validationCharacter(2),
          label: '新娘',
          sourceBinding: '開場畫面左側男性',
        },
      ],
    })).toBe('兩位角色都綁定「開場畫面左側男性」，請分別指定不同的原片人物')
  })

  it('單次生成不保留銜接末幀 -> 使用者參考圖 9 張通過、10 張明確阻擋', () => {
    const characters = [validationCharacter(1), validationCharacter(2)]

    expect(getDepthRebuildValidationError({
      ...baseValidation,
      characters,
      sceneReferenceCount: 7,
    })).toBeNull()

    expect(getDepthRebuildValidationError({
      ...baseValidation,
      characters,
      sceneReferenceCount: 8,
    })).toBe('人物與場景參考圖片合計最多 9 張')
  })

  it('12 秒自適應引導 -> 只需要一份 Prompt；舊分段 Prompt 數量會被阻擋', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      segmentPromptCount: 1,
    })).toBeNull()
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      segmentPromptCount: 2,
    })).toBe('自適應引導計畫或 Prompt 已變更，請重新建立 Prompt')
  })

  it('7.6 秒不再平均拆段 -> 完整 Depth 加關鍵 RGB 可直接通過', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      sourceDurationSeconds: 7.6,
      segmentPromptCount: 1,
    })).toBeNull()
  })

  it('深度有效幀率不足 -> 明確阻擋付費生成', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      depthGuideSufficient: false,
    })).toBe('深度引導影片有效幀率不足，請重新產生後再生成')
  })

  it('設定變更但 Prompt 尚未重建 -> 明確阻擋付費生成', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      promptIsFresh: false,
    })).toBe('設定或參考素材已變更，請重新建立 Prompt')
  })

  it('需要原音但尚未偵測到音軌 -> 在付費前阻擋；重新生成聲音則可繼續', () => {
    expect(getDepthRebuildValidationError({
      ...baseValidation,
      sourceAudioMode: 'preserve',
      sourceAudioDetected: false,
    })).toBe('原片未偵測到音軌；請改選「AI 重新生成聲音」')

    expect(getDepthRebuildValidationError({
      ...baseValidation,
      sourceAudioMode: 'generate',
      sourceAudioDetected: false,
    })).toBeNull()
  })

  it('Fast 選到 1080p -> 回傳供應商解析度錯誤而非靜默降級', () => {
    const error = getDepthRebuildValidationError({
      ...baseValidation,
      modelKey: 'atlascloud::seedance-2.0-fast-r2v',
      resolution: '1080p',
      enabledModelKeys: ['atlascloud::seedance-2.0-fast-r2v'],
    })
    expect(error).toContain('不支援 1080p')
    expect(error).toContain('480p、720p')
  })

  it('角色、音訊或運鏡設定變更 -> fingerprint 改變使舊 Prompt 過期', () => {
    const actorImageA = {
      name: 'actor-a.png',
      size: 20,
      type: 'image/png',
      lastModified: 2,
    }
    const actorImageB = {
      name: 'actor-b.png',
      size: 21,
      type: 'image/png',
      lastModified: 3,
    }
    const base = {
      sourceDurationSeconds: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      depthGuide: { name: 'depth.webm', size: 30, type: 'video/webm', lastModified: 1 },
      characters: [
        {
          id: 'character-a',
          label: '女記者',
          sourceBinding: '替換原片開場畫面左側人物',
          description: '短髮，墨綠羊毛大衣',
          image: actorImageA,
        },
        {
          id: 'character-b',
          label: '男記者',
          sourceBinding: '替換原片開場畫面右側人物',
          description: '黑髮，深灰西裝',
          image: actorImageB,
        },
      ],
      sceneReferences: [{
        id: 'scene-a',
        note: '主要建築與色調',
        image: { name: 'scene.png', size: 40, type: 'image/png', lastModified: 4 },
      }],
      sceneDescription: '場景 A',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      resolution: '720p',
      sourceAudioMode: 'preserve' as const,
      motionSettings: DEFAULT_DEPTH_REBUILD_MOTION_SETTINGS,
    }
    const original = buildDepthRebuildFingerprint(base)
    const reordered = buildDepthRebuildFingerprint({
      ...base,
      characters: [base.characters[1], base.characters[0]],
    })
    const rebound = buildDepthRebuildFingerprint({
      ...base,
      characters: [
        { ...base.characters[0], sourceBinding: '替換原片開場畫面中央人物' },
        base.characters[1],
      ],
    })
    const redescribed = buildDepthRebuildFingerprint({
      ...base,
      characters: [
        { ...base.characters[0], description: '短髮，酒紅色羊毛大衣' },
        base.characters[1],
      ],
    })
    const changedAudioMode = buildDepthRebuildFingerprint({
      ...base,
      sourceAudioMode: 'reference-only',
    })
    const changedMotionSettings = buildDepthRebuildFingerprint({
      ...base,
      motionSettings: {
        ...base.motionSettings,
        cameraDirection: 'forward',
        noDirectionReversal: false,
      },
    })

    expect(reordered).not.toBe(original)
    expect(rebound).not.toBe(original)
    expect(redescribed).not.toBe(original)
    expect(changedAudioMode).not.toBe(original)
    expect(changedMotionSettings).not.toBe(original)
  })

  it('超過 15 秒 -> 秒數正規化明確失敗', () => {
    expect(() => depthRebuildDurationSeconds(15.1)).toThrow('原片需介於 4–15 秒')
  })
})

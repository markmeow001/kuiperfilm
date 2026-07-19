import { describe, expect, it } from 'vitest'
import {
  ALLOWED_TRACK_B_MODELS,
  DEFAULT_VIDEO2_DISABLE_SHOT_SECONDS,
  TRACK_B_FAST_MODEL,
  TRACK_B_STANDARD_MODEL,
  buildReferenceOrderMapping,
  computeVideo2Quota,
  isAllowedTrackBModel,
  validateR2VRequest,
  type ReferenceSlots,
} from '@/app/[locale]/live-composite/lib/atlascloud-r2v-contract'

const fullSlots: ReferenceSlots = {
  performanceVideo: { assetId: 'perf', durationSeconds: 10 },
  faceCloseupVideo: { assetId: 'face', durationSeconds: 4 },
  originalAudio: { assetId: 'audio', durationSeconds: 10 },
  characterImages: [{ assetId: 'char-front' }, { assetId: 'char-side' }, { assetId: 'char-back' }],
  detailImages: [{ assetId: 'costume' }, { assetId: 'weapon' }],
  backgroundConceptImage: { assetId: 'bg-concept' },
  extraImages: [{ assetId: 'lighting' }],
}

const validDraft = {
  modelKey: TRACK_B_STANDARD_MODEL,
  durationSeconds: 10,
  resolution: '1080p',
  referenceImageCount: 6,
  referenceVideoDurationsSeconds: [10, 4],
  referenceAudioCount: 1,
} as const

describe('atlascloud r2v contract — 模型白名單', () => {
  it('只允許 AtlasCloud Seedance 2.0 Fast/Standard R2V 兩個模型', () => {
    expect(ALLOWED_TRACK_B_MODELS).toEqual([
      'atlascloud::seedance-2.0-fast-r2v',
      'atlascloud::seedance-2.0-r2v',
    ])
    expect(isAllowedTrackBModel(TRACK_B_FAST_MODEL)).toBe(true)
    expect(isAllowedTrackBModel(TRACK_B_STANDARD_MODEL)).toBe(true)
  })

  it('ARK / fal / Kling / BobAPI 模型一律拒絕', () => {
    const rejected = [
      'ark::seedance-2.0-i2v',
      'fal::seedance-2.0-r2v',
      'kling::o3-r2v',
      'bobapi::seedance-2.0',
      'atlascloud::seedance-1.5-r2v',
      '',
    ]
    for (const key of rejected) {
      expect(isAllowedTrackBModel(key), key).toBe(false)
      const result = validateR2VRequest({ ...validDraft, resolution: '720p', modelKey: key })
      expect(result.ok, key).toBe(false)
      expect(result.issues.some((issue) => issue.field === 'modelKey'), key).toBe(true)
    }
  })
})

describe('atlascloud r2v contract — video 2 十五秒配額', () => {
  it('主表演 10 秒 -> video 2 剩 5 秒可用', () => {
    const quota = computeVideo2Quota(10)
    expect(quota.video2BudgetSeconds).toBe(5)
    expect(quota.video2Enabled).toBe(true)
    expect(quota.disabledReason).toBeNull()
  })

  it('主表演 12 秒 -> 超過產品預設門檻，video 2 停用並附原因與剩餘秒數', () => {
    const quota = computeVideo2Quota(12)
    expect(quota.video2Enabled).toBe(false)
    expect(quota.video2BudgetSeconds).toBe(3)
    expect(quota.disabledReason).toContain('12 秒')
    expect(quota.disabledReason).toContain(`${DEFAULT_VIDEO2_DISABLE_SHOT_SECONDS} 秒`)
    expect(quota.disabledReason).toContain('剩餘 3 秒')
    expect(quota.disabledReason).toContain('B0')
  })

  it('主表演剛好等於門檻 11 秒 -> 仍啟用，剩 4 秒', () => {
    const quota = computeVideo2Quota(DEFAULT_VIDEO2_DISABLE_SHOT_SECONDS)
    expect(quota.video2Enabled).toBe(true)
    expect(quota.video2BudgetSeconds).toBe(4)
  })

  it('門檻是產品預設值，可由呼叫端覆寫（B0 驗證後調整）', () => {
    const quota = computeVideo2Quota(12, { disableShotThresholdSeconds: 13 })
    expect(quota.video2Enabled).toBe(true)
    expect(quota.video2BudgetSeconds).toBe(3)
  })

  it('主表演 15 秒 -> 配額歸零', () => {
    const quota = computeVideo2Quota(15)
    expect(quota.video2Enabled).toBe(false)
    expect(quota.video2BudgetSeconds).toBe(0)
  })
})

describe('atlascloud r2v contract — 素材順序映射', () => {
  it('完整素材 -> 依 §2.3 固定順序產生 token 與角色說明', () => {
    const mapping = buildReferenceOrderMapping(fullSlots)
    expect(mapping.videos.map((asset) => asset.assetId)).toEqual(['perf', 'face'])
    expect(mapping.audios.map((asset) => asset.assetId)).toEqual(['audio'])
    expect(mapping.images.map((asset) => asset.assetId)).toEqual([
      'char-front', 'char-side', 'char-back', 'costume', 'weapon', 'bg-concept', 'lighting',
    ])
    expect(mapping.rows.map((row) => row.token)).toEqual([
      'video 1', 'video 2', 'audio 1',
      'image 1', 'image 2', 'image 3', 'image 4', 'image 5', 'image 6', 'image 7',
    ])
    const video1Row = mapping.rows.find((row) => row.token === 'video 1')
    expect(video1Row?.role).toContain('主表演')
    const image6Row = mapping.rows.find((row) => row.token === 'image 6')
    expect(image6Row?.role).toContain('背景概念圖')
  })

  it('映射順序穩定：同樣輸入重算兩次結果一致', () => {
    const first = buildReferenceOrderMapping(fullSlots)
    const second = buildReferenceOrderMapping(fullSlots)
    expect(second).toEqual(first)
  })

  it('部分素材缺席 -> token 重新編號，不留空洞（必須重建映射，不沿用舊 prompt）', () => {
    const mapping = buildReferenceOrderMapping({
      performanceVideo: { assetId: 'perf', durationSeconds: 8 },
      backgroundConceptImage: { assetId: 'bg-concept' },
    })
    expect(mapping.rows.map((row) => row.token)).toEqual(['video 1', 'image 1'])
    expect(mapping.rows[1].role).toContain('背景概念圖')
  })
})

describe('atlascloud r2v contract — 顯式失敗驗證（§8.3）', () => {
  it('合法請求 -> 通過', () => {
    expect(validateR2VRequest(validDraft)).toEqual({ ok: true, issues: [] })
  })

  it('時長 3 秒或 16 秒 -> 顯式失敗', () => {
    for (const durationSeconds of [3, 16]) {
      const result = validateR2VRequest({ ...validDraft, durationSeconds })
      expect(result.ok).toBe(false)
      expect(result.issues.some((issue) => issue.field === 'durationSeconds')).toBe(true)
    }
  })

  it('Fast 模型要求 1080p -> 顯式失敗', () => {
    const result = validateR2VRequest({ ...validDraft, modelKey: TRACK_B_FAST_MODEL, resolution: '1080p' })
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'resolution')).toBe(true)
  })

  it('Fast 模型 720p -> 通過', () => {
    const result = validateR2VRequest({ ...validDraft, modelKey: TRACK_B_FAST_MODEL, resolution: '720p' })
    expect(result.ok).toBe(true)
  })

  it('參考圖片超過 9 張 -> 顯式失敗', () => {
    const result = validateR2VRequest({ ...validDraft, referenceImageCount: 10 })
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'referenceImageCount')).toBe(true)
  })

  it('參考影片超過 3 支 -> 顯式失敗', () => {
    const result = validateR2VRequest({ ...validDraft, referenceVideoDurationsSeconds: [4, 4, 3, 3] })
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'referenceVideoDurationsSeconds')).toBe(true)
  })

  it('參考影片總長超過 15 秒 -> 顯式失敗', () => {
    const result = validateR2VRequest({ ...validDraft, referenceVideoDurationsSeconds: [12, 4] })
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'referenceVideoDurationsSeconds')).toBe(true)
  })

  it('音訊參考但沒有任何圖片或影片 -> 顯式失敗', () => {
    const result = validateR2VRequest({
      ...validDraft,
      referenceImageCount: 0,
      referenceVideoDurationsSeconds: [],
      referenceAudioCount: 1,
    })
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'referenceAudioCount')).toBe(true)
  })

  it('音訊超過 3 支 -> 顯式失敗', () => {
    const result = validateR2VRequest({ ...validDraft, referenceAudioCount: 4 })
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.field === 'referenceAudioCount')).toBe(true)
  })

  it('payload 含 seed / camera_fixed / negative_prompt / 權重欄位 -> 逐欄位大聲拒絕，不靜默刪除', () => {
    const forbiddenKeys = ['seed', 'camera_fixed', 'negative_prompt', 'performance_weight', 'character_weights']
    for (const key of forbiddenKeys) {
      const payload = { [key]: 1 }
      const result = validateR2VRequest({ ...validDraft, payload })
      expect(result.ok, key).toBe(false)
      const issue = result.issues.find((candidate) => candidate.field === key)
      expect(issue, key).toBeDefined()
      expect(issue?.message, key).toContain(key)
      // 驗證是純函數：payload 不被就地刪改（不靜默 strip）
      expect(payload).toEqual({ [key]: 1 })
    }
  })

  it('payload 只含允許欄位 -> 通過', () => {
    const result = validateR2VRequest({
      ...validDraft,
      payload: { generate_audio: true, watermark: false, return_last_frame: true, ratio: '16:9' },
    })
    expect(result.ok).toBe(true)
  })
})

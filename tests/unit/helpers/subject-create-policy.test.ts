import { describe, expect, it } from 'vitest'
import {
  getCharacterCreatePolicy,
  getLocationCreatePolicy,
  getNamedSubjectCreatePolicy,
  resolveLocationCreateSubmission,
} from '../../../src/app/[locale]/v2/workspace/[projectId]/subjects/subject-create-policy'

describe('subject create policy', () => {
  it('[角色只有名稱] -> [可只建立資料且不誤啟動 AI 生成]', () => {
    const policy = getCharacterCreatePolicy({
      name: '陳警官',
      description: '',
      mode: 'description',
      referenceImageCount: 0,
      isBusy: false,
    })

    expect(policy).toEqual({
      canCreateOnly: true,
      canGenerate: false,
      hint: '可直接建立角色；如要同時生成設定圖，請填寫外觀描述',
    })
  })

  it('[角色名稱與外觀描述完整] -> [可生成並建立]', () => {
    const policy = getCharacterCreatePolicy({
      name: '陳警官',
      description: '三十歲，黑色短髮，穿深色西裝',
      mode: 'description',
      referenceImageCount: 0,
      isBusy: false,
    })

    expect(policy.canCreateOnly).toBe(true)
    expect(policy.canGenerate).toBe(true)
    expect(policy.hint).toBeNull()
  })

  it('[參考圖模式沒有圖片] -> [不可生成但仍可只建立角色]', () => {
    const policy = getCharacterCreatePolicy({
      name: '角色 A',
      description: '',
      mode: 'reference',
      referenceImageCount: 0,
      isBusy: false,
    })

    expect(policy.canCreateOnly).toBe(true)
    expect(policy.canGenerate).toBe(false)
    expect(policy.hint).toBe('請先上傳圖片，或直接建立角色後再補圖')
  })

  it('[場景或道具只有空白名稱] -> [拒絕送出並顯示原因]', () => {
    expect(getNamedSubjectCreatePolicy('   ', '場景', false)).toEqual({
      canSubmit: false,
      hint: '請先輸入場景名稱',
    })
    expect(getNamedSubjectCreatePolicy('', '道具', false)).toEqual({
      canSubmit: false,
      hint: '請先輸入道具名稱',
    })
  })

  it('[場景有名稱且未送出中] -> [可建立資料]', () => {
    expect(getNamedSubjectCreatePolicy('雨夜停車場', '場景', false)).toEqual({
      canSubmit: true,
      hint: null,
    })
  })

  it('[自行上傳場景但沒有圖片] -> [拒絕送出並顯示圖片提示]', () => {
    expect(
      getLocationCreatePolicy({
        name: '客廳',
        mode: 'upload',
        hasFile: false,
        isBusy: false,
      }),
    ).toEqual({
      canSubmit: false,
      hint: '請先選擇要上傳的場景圖片',
    })
  })

  it('[自行上傳場景並填說明] -> [上傳原圖且不啟動 AI 生圖]', () => {
    expect(resolveLocationCreateSubmission('upload', ' 白牆客廳，午後自然光 ')).toEqual({
      apiDescription: '',
      summaryNote: '白牆客廳，午後自然光',
      shouldUpload: true,
    })
  })

  it('[描述詞生成場景] -> [只送 AI 描述且不附帶上傳圖片]', () => {
    expect(resolveLocationCreateSubmission('description', ' 雨夜停車場 ')).toEqual({
      apiDescription: '雨夜停車場',
      summaryNote: '',
      shouldUpload: false,
    })
  })
})

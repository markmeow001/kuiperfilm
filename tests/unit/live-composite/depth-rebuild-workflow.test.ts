import { describe, expect, it } from 'vitest'
import {
  buildDepthRebuildFingerprint,
  depthRebuildAspectRatio,
  depthRebuildDurationSeconds,
  getDepthRebuildValidationError,
} from '@/app/[locale]/live-composite/lib/depth-rebuild-workflow'

const baseValidation = {
  sourceDurationSeconds: 12,
  depthGuideExists: true,
  depthGuideSufficient: true,
  characterImageExists: true,
  sceneImageExists: false,
  characterDescription: '寫實民國女演員，短髮',
  sceneDescription: '上海雨夜街道，車流與招牌持續運動',
  modelKey: 'atlascloud::seedance-2.0-r2v',
  resolution: '720p',
  enabledModelKeys: ['atlascloud::seedance-2.0-r2v'],
  prompt: 'depth-guided reconstruction prompt',
  promptIsFresh: true,
} as const

describe('depth rebuild workflow', () => {
  it('完整有效設定 -> 通過提交前驗證', () => {
    expect(getDepthRebuildValidationError(baseValidation)).toBeNull()
    expect(depthRebuildDurationSeconds(12.4)).toBe(12)
    expect(depthRebuildAspectRatio(1920, 1080)).toBe('16:9')
    expect(depthRebuildAspectRatio(1080, 1920)).toBe('9:16')
    expect(depthRebuildAspectRatio(1440, 1080)).toBe('4:3')
    expect(depthRebuildAspectRatio(1080, 1440)).toBe('3:4')
    expect(depthRebuildAspectRatio(2520, 1080)).toBe('21:9')
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

  it('角色描述變更 -> 產生不同 fingerprint 使舊 Prompt 可被判定過期', () => {
    const base = {
      sourceDurationSeconds: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      depthGuide: { name: 'depth.webm', size: 30, type: 'video/webm', lastModified: 1 },
      characterImage: { name: 'actor.png', size: 20, type: 'image/png', lastModified: 2 },
      sceneImage: null,
      characterDescription: '角色 A',
      sceneDescription: '場景 A',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      resolution: '720p',
      preserveSourceAudio: true,
    }
    const before = buildDepthRebuildFingerprint(base)
    const after = buildDepthRebuildFingerprint({ ...base, characterDescription: '角色 B' })
    expect(after).not.toBe(before)
  })

  it('超過 15 秒 -> 秒數正規化明確失敗', () => {
    expect(() => depthRebuildDurationSeconds(15.1)).toThrow('深度重建只支援 4–15 秒影片')
  })
})

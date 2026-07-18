import { describe, expect, it } from 'vitest'
import type { VoiceAsset, VoiceLine } from '@/app/[locale]/v2/workspace/[projectId]/voice/voice-workspace-types'
import {
  clampEmotionStrength,
  collectEpisodeSpeakers,
  countGeneratableLines,
  filterVoiceAssets,
  getVoicePreviewUrl,
} from '@/app/[locale]/v2/workspace/[projectId]/voice/voice-workspace-helpers'

function voice(overrides: Partial<VoiceAsset> = {}): VoiceAsset {
  return {
    id: 'voice-1',
    name: '沉稳旁白',
    description: '低沉、克制',
    voiceId: 'provider-voice-1',
    voiceType: 'qwen-designed',
    customVoiceUrl: 'https://media.example/voice.mp3',
    voicePrompt: '成年男性，沉稳',
    gender: '男',
    language: 'zh',
    folderId: null,
    ...overrides,
  }
}

function line(overrides: Partial<VoiceLine> = {}): VoiceLine {
  return {
    id: 'line-1',
    lineIndex: 1,
    speaker: '角色A',
    content: '你好。',
    emotionPrompt: null,
    emotionStrength: 0.4,
    audioUrl: null,
    lineTaskRunning: false,
    ...overrides,
  }
}

describe('voice workspace helpers', () => {
  it('资产音色只有 customVoiceUrl -> 返回真实可绑定试听地址', () => {
    const result = getVoicePreviewUrl(voice())

    expect(result).toBe('https://media.example/voice.mp3')
  })

  it('筛选指定性别 -> 排除性别缺失与不匹配音色', () => {
    const result = filterVoiceAssets([
      voice({ id: 'male', gender: '男' }),
      voice({ id: 'female', gender: '女' }),
      voice({ id: 'unknown', gender: null }),
    ], '', '男')

    expect(result.map((item) => item.id)).toEqual(['male'])
  })

  it('台词与项目角色有重复 -> 去重后保留所有有效发言人', () => {
    const result = collectEpisodeSpeakers([
      line({ speaker: '角色A' }),
      line({ id: 'line-2', speaker: '角色B' }),
    ], ['角色A', '旁白', ''])

    expect(result).toEqual(['角色A', '角色B', '旁白'])
  })

  it('批量生成候选 -> 只计算已绑音色且尚无音频的台词', () => {
    const result = countGeneratableLines([
      line({ id: 'ready', speaker: '角色A', audioUrl: 'https://media.example/ready.mp3' }),
      line({ id: 'eligible', speaker: '角色A', audioUrl: null }),
      line({ id: 'unbound', speaker: '角色B', audioUrl: null }),
    ], new Set(['角色A']))

    expect(result).toBe(1)
  })

  it('情绪强度超出范围 -> 限制到后端允许的 0.1 至 1', () => {
    expect(clampEmotionStrength(-2)).toBe(0.1)
    expect(clampEmotionStrength(2)).toBe(1)
    expect(clampEmotionStrength(Number.NaN)).toBe(0.4)
  })
})

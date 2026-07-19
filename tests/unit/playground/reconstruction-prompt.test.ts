import { describe, expect, it } from 'vitest'
import { buildReconstructionPrompt } from '@/lib/playground/reconstruction-prompt'

const baseInput = {
  analysis: {
    summary: '兩人沿街快速前進',
    camera: { shotSize: '中景', angle: '平視', movement: '手持跟拍', continuity: '單一連續鏡頭' },
    subjects: [{ id: 'person_1', description: '主要演員', action: '快走並回頭', position: '畫面中央', relation: '與 person_2 並肩' }],
    performance: { emotion: '焦急但克制', timing: '全程連續', mustPreserve: ['回頭時機', '步伐節奏'] },
    environment: { description: '現代街道', greenScreen: false, studioEquipmentVisible: false, motionNotes: '背景隨跟拍產生視差' },
    risks: ['腳步滑動'],
  },
  metadata: { durationSec: 12, width: 1920, height: 1080, fps: 25, hasAudio: true },
  creative: {
    era: '1930 年代民國', location: '上海法租界', story: '秘密交接',
    characterDesign: '新的電影寫實人物', wardrobe: '民國長衫與旗袍', mood: '緊張寫實',
    weatherAndTime: '雨後黃昏', backgroundMotion: '黃包車、路人與招牌持續運動', replacePeople: true,
  },
  dialogue: [{ id: 'line-1', speaker: '阿珍', startSec: 1.2, endSec: 2.8, text: '你確定沒有人跟著？', emotion: '壓低聲音' }],
  audioMode: 'preserve-original' as const,
}

describe('buildReconstructionPrompt', () => {
  it('pins camera motion, moving environment, actor replacement and exact dialogue', () => {
    const prompt = buildReconstructionPrompt(baseInput)
    expect(prompt).toContain('hand')
    expect(prompt).toContain('Replace every original performer completely')
    expect(prompt).toContain('阿珍 says exactly: “你確定沒有人跟著？”')
    expect(prompt).toContain('original source audio')
    expect(prompt).toContain('黃包車、路人與招牌持續運動')
    expect(prompt).toContain('three-dimensional parallax')
  })

  it('does not invent a transcript when no dialogue lines were supplied', () => {
    const prompt = buildReconstructionPrompt({ ...baseInput, dialogue: [] })
    expect(prompt).toContain('Do not invent or rewrite speech')
  })
})

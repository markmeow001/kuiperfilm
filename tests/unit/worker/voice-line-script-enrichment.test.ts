import { describe, expect, it } from 'vitest'
import { enrichVoiceLinesFromScript } from '@/lib/workers/handlers/script-to-storyboard-voice'

const IANGYC_SCRIPT = `第一集
        1-1洞府、洞府外 日 内、外
            人物：王玄(成年、青年) 群演若干
△ 洞府内，王玄盘膝悬空而坐。
字幕：结界洞府
王玄OS：洞府一甲子，凡尘弹指间...
△ 镜头切洞府外。
王玄OS：位列仙班！
桃桃（哽咽VO）：爸爸,你在哪，快来救救妈妈...
王玄（闭眼皱眉，OS）：这是来自我血脉的呼喊？
王玄OS：不好......`

describe('enrichVoiceLinesFromScript', () => {
  it('returns existing rows untouched when raw script is empty', () => {
    const llmRows = [
      { lineIndex: 1, speaker: '王玄', content: '你好' },
    ]
    expect(enrichVoiceLinesFromScript(llmRows, null)).toBe(llmRows)
    expect(enrichVoiceLinesFromScript(llmRows, '')).toBe(llmRows)
    expect(enrichVoiceLinesFromScript(llmRows, '   ')).toBe(llmRows)
  })

  it('backfills all 5 lines when LLM extracted nothing (iangyc scenario)', () => {
    const enriched = enrichVoiceLinesFromScript([], IANGYC_SCRIPT)
    expect(enriched).toHaveLength(5)
    // Speakers: 4× 王玄, 1× 桃桃
    const taotaoCount = enriched.filter((r) => r.speaker === '桃桃').length
    const wangxuanCount = enriched.filter((r) => r.speaker === '王玄').length
    expect(taotaoCount).toBe(1)
    expect(wangxuanCount).toBe(4)
  })

  it('assigns valid lineIndex (>0, monotonic) and emotionStrength (0.1-0.5) to enriched rows', () => {
    const enriched = enrichVoiceLinesFromScript([], IANGYC_SCRIPT)
    let prevIdx = 0
    for (const row of enriched) {
      expect(row.lineIndex).toBeGreaterThan(prevIdx)
      prevIdx = row.lineIndex as number
      const emo = row.emotionStrength as number
      expect(emo).toBeGreaterThanOrEqual(0.1)
      expect(emo).toBeLessThanOrEqual(0.5)
    }
  })

  it('sets matchedPanel: null on enriched rows (LLM never ran)', () => {
    const enriched = enrichVoiceLinesFromScript([], IANGYC_SCRIPT)
    for (const row of enriched) {
      expect(row.matchedPanel).toBeNull()
    }
  })

  it('dedupes when LLM already captured the dialogue (quoted variant)', () => {
    const llmRows = [
      {
        lineIndex: 1,
        speaker: '王玄',
        content: '洞府一甲子，凡尘弹指间，我王玄意外闯入',
        emotionStrength: 0.15,
        matchedPanel: { storyboardId: 'sb1', panelIndex: 1 },
      },
    ]
    const enriched = enrichVoiceLinesFromScript(llmRows, IANGYC_SCRIPT)
    // Regex extracts 5 lines, LLM has 1 that dedupes against regex's first → 4 new
    expect(enriched).toHaveLength(5)
    // LLM's row stays first with its matchedPanel intact
    expect(enriched[0]).toEqual(llmRows[0])
    // Enriched rows preserve matchedPanel: null
    for (let i = 1; i < enriched.length; i++) {
      expect(enriched[i].matchedPanel).toBeNull()
    }
  })

  it('appends enriched rows with lineIndex above LLM rows max', () => {
    const llmRows = [
      { lineIndex: 7, speaker: '王玄', content: '已知的台词', emotionStrength: 0.2 },
    ]
    const enriched = enrichVoiceLinesFromScript(llmRows, IANGYC_SCRIPT)
    const enrichedIdxs = enriched
      .filter((r) => r.matchedPanel === null)
      .map((r) => r.lineIndex as number)
    for (const idx of enrichedIdxs) {
      expect(idx).toBeGreaterThan(7)
    }
  })

  it('preserves 桃桃 VO content with elision marks', () => {
    const enriched = enrichVoiceLinesFromScript([], IANGYC_SCRIPT)
    const taotao = enriched.find((r) => r.speaker === '桃桃')
    expect(taotao).toBeDefined()
    expect(taotao!.content).toMatch(/爸爸/)
    expect(taotao!.content).toMatch(/妈妈/)
  })
})

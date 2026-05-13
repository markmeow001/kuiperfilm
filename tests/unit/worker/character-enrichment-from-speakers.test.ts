import { describe, expect, it } from 'vitest'
import { mineSpeakersMissingFromRoster } from '@/lib/workers/handlers/analyze-novel-create-characters'

const IANGYC_SCRIPT = `1-1洞府、洞府外 日 内、外
            人物：王玄(成年、青年) 群演若干
△ 洞府内，王玄盘膝悬空而坐。
字幕：结界洞府
王玄OS：洞府一甲子，凡尘弹指间...
桃桃（哽咽VO）：爸爸,你在哪，快来救救妈妈...
王玄（闭眼皱眉，OS）：这是来自我血脉的呼喊？
柳如烟：殿下，请留步。
王玄OS：不好......
路人：闪开！`

describe('mineSpeakersMissingFromRoster', () => {
  it('returns empty when raw script is missing', () => {
    expect(mineSpeakersMissingFromRoster({ rawScript: null, parsedCharacters: [], existingCharacters: [] })).toEqual([])
    expect(mineSpeakersMissingFromRoster({ rawScript: '', parsedCharacters: [], existingCharacters: [] })).toEqual([])
  })

  it('mines 桃桃 + 柳如烟 when LLM only extracted 王玄', () => {
    const mined = mineSpeakersMissingFromRoster({
      rawScript: IANGYC_SCRIPT,
      parsedCharacters: [{ name: '王玄' }],
      existingCharacters: [],
    })
    const names = new Set(mined.map((m) => m.name))
    // 路人 is in the narrative-speaker blocklist → excluded
    expect(names).toEqual(new Set(['桃桃', '柳如烟']))
  })

  it('flags 桃桃 as voice_only (only appears via VO)', () => {
    const mined = mineSpeakersMissingFromRoster({
      rawScript: IANGYC_SCRIPT,
      parsedCharacters: [{ name: '王玄' }],
      existingCharacters: [],
    })
    const taotao = mined.find((m) => m.name === '桃桃')!
    expect(taotao.voiceOnly).toBe(true)
  })

  it('flags 柳如烟 as not-voice-only (appears as plain dialogue)', () => {
    const mined = mineSpeakersMissingFromRoster({
      rawScript: IANGYC_SCRIPT,
      parsedCharacters: [{ name: '王玄' }],
      existingCharacters: [],
    })
    const liu = mined.find((m) => m.name === '柳如烟')!
    expect(liu.voiceOnly).toBe(false)
  })

  it('skips speakers already in parsedCharacters', () => {
    const mined = mineSpeakersMissingFromRoster({
      rawScript: IANGYC_SCRIPT,
      parsedCharacters: [{ name: '王玄' }, { name: '桃桃' }, { name: '柳如烟' }],
      existingCharacters: [],
    })
    expect(mined).toEqual([])
  })

  it('skips speakers already in existingCharacters (alias-aware)', () => {
    const mined = mineSpeakersMissingFromRoster({
      rawScript: IANGYC_SCRIPT,
      parsedCharacters: [{ name: '王玄' }],
      existingCharacters: [{ name: '桃桃' }, { name: '柳如烟' }],
    })
    expect(mined).toEqual([])
  })

  it('blocks narrative speakers (旁白/群众/路人/group extras)', () => {
    const script = `旁白：很久很久以前。
群众：太可怕了！
众人：救命！
路人：闪开！
narrator: a long time ago`
    const mined = mineSpeakersMissingFromRoster({
      rawScript: script,
      parsedCharacters: [],
      existingCharacters: [],
    })
    expect(mined).toEqual([])
  })

  it('captures first content sample for each mined speaker', () => {
    const mined = mineSpeakersMissingFromRoster({
      rawScript: IANGYC_SCRIPT,
      parsedCharacters: [{ name: '王玄' }],
      existingCharacters: [],
    })
    const taotao = mined.find((m) => m.name === '桃桃')!
    expect(taotao.sampleContent).toMatch(/爸爸/)
  })
})

/**
 * 2026-06-03 — Shared audio-directive for all multi-shot composite paths.
 *
 * Audit (4-agent review) found the audio directive was hand-copied in FOUR
 * places (atlascloud / seedance / fal / raw branches) and had drifted:
 *  - fal's dialogue branch lacked the "ban extra gasps/moans" clause that
 *    the 2026-06-02 fix added to atlascloud+seedance → re-exposed AtlasCloud
 *    audio-moderation false-positives on fal.
 *  - atlascloud & fal rawPrompt branches appended NO audio directive at all
 *    → re-exposed both the moderation false-positive AND the 2026-05-29
 *    "低頻貝斯沉音 → fake human hum" incident on the primary R2V flow.
 *  - When the user turns audio OFF but a group HAS dialogue, every path
 *    still emitted "逐字配音 + 唇形嚴格同步" while the API sends
 *    generateAudio:false → TTS silently lost + visible lip-sync desync.
 *
 * This consolidates the directive into ONE pure function that all paths
 * call, and adds the missing `soundEnabled` dimension.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAudioDirective,
  buildSpeechDialogueBlock,
  countDialogueBeats,
  extractRawDialogueBeats,
} from '@/lib/workers/handlers/multi-shot-audio-directive'

describe('buildAudioDirective', () => {
  it('defaults soundEnabled to true (back-compat with single-arg callers)', () => {
    expect(buildAudioDirective(0)).toBe(buildAudioDirective(0, true))
    expect(buildAudioDirective(2)).toBe(buildAudioDirective(2, true))
  })

  describe('sound ON', () => {
    it('with dialogue: lip-sync TTS + ambient, and bans EXTRA non-dialogue vocals', () => {
      const d = buildAudioDirective(2, true)
      expect(d).toMatch(/逐字配音/)
      expect(d).toMatch(/唇形/)
      expect(d).toMatch(/環境音|环境音/)
      // the 2026-06-02 moderation-avoidance clause must be present
      expect(d).toMatch(/喘息|呻吟|尖叫/)
      expect(d).toMatch(/勿|禁/)
    })

    it('no dialogue: ambient-only, hard-bans any human/human-like voice', () => {
      const d = buildAudioDirective(0, true)
      expect(d).toMatch(/嚴禁|禁止/)
      expect(d).toMatch(/人聲/)
      expect(d).toMatch(/類人聲|哼唱|歌聲/)
      expect(d).toMatch(/環境音|自然.*音/)
      // does NOT promise dialogue lip-sync
      expect(d).not.toMatch(/逐字配音/)
    })
  })

  describe('sound OFF (the core bug fix)', () => {
    it('with dialogue present: must NOT promise 配音 / 唇形同步 (avoids TTS-lost + desync)', () => {
      const d = buildAudioDirective(3, false)
      expect(d).not.toMatch(/逐字配音/)
      expect(d).not.toMatch(/唇形.*同步|唇形與配音/)
      // explicitly silent
      expect(d).toMatch(/靜音|不生成聲音|不生成任何聲音|無聲/)
    })

    it('no dialogue: also silent', () => {
      const d = buildAudioDirective(0, false)
      expect(d).toMatch(/靜音|不生成聲音|不生成任何聲音|無聲/)
      expect(d).not.toMatch(/逐字配音/)
    })

    it('silent branch is identical regardless of dialogue count', () => {
      expect(buildAudioDirective(0, false)).toBe(buildAudioDirective(5, false))
    })
  })
})

describe('countDialogueBeats — 2026-06-17 R2V dialogue regression', () => {
  // GroupCard buildInitialNarrativeSeedance renders dialogue as 王玄:「…」 and
  // VO as 「…」. The old raw-branch regex (/對白：|说「|: "/) missed these, so
  // dialogueBeatCount was 0 → buildAudioDirective emitted the ambient-only
  // "嚴禁合成…說話聲" directive → R2V went silent on dialogue. These cases lock
  // the fix: the Seedance narrative format MUST count as dialogue.
  it('counts Seedance 「…」 on-camera + VO dialogue (the bug case)', () => {
    const narrative = [
      '【開場】環境音效：整齊的腳步停頓聲與厚重衣物摩擦的下跪聲。',
      '王玄:「位列仙班！」',
      '王玄 聲音(僅音頻，無畫面文字，嘴部不動):',
      '「洞府一甲子，凡塵彈指間，我王玄今日終於要突破劍仙境。」',
    ].join('\n')
    expect(countDialogueBeats(narrative)).toBeGreaterThan(0)
    // → drives the lip-synced-TTS branch, NOT the speech-ban branch
    const directive = buildAudioDirective(countDialogueBeats(narrative), true)
    expect(directive).toMatch(/逐字配音/)
    expect(directive).not.toMatch(/嚴禁合成任何人聲/)
  })

  it('still counts the auto-built 對白： and Kling : " forms', () => {
    expect(countDialogueBeats('第1鏡：他開門。對白：王玄說「走吧」')).toBeGreaterThan(0)
    expect(countDialogueBeats('young man opens the door, 王玄: "let\'s go"')).toBeGreaterThan(0)
  })

  it('returns 0 for a pure-ambient narrative (no dialogue) → ambient directive', () => {
    const narrative = '【開場】洞府內，霧氣繚繞。環境音效：低頻風聲穿過石壁的回響。'
    expect(countDialogueBeats(narrative)).toBe(0)
    expect(buildAudioDirective(0, true)).toMatch(/嚴禁/)
  })
})

// 2026-06-16 — countDialogueBeats only flips the directive branch (ask for TTS).
// AtlasCloud Seedance R2V still ships SILENT on plain {speaker}「…」 because the
// line lacks the 说 speech-verb the model gates TTS on (sibling BobAPI seedance
// path proves {speaker}说「…」 is required). extractRawDialogueBeats +
// buildSpeechDialogueBlock turn the verbatim narrative dialogue into an explicit
// 说「…」 list so the dialogue is actually voiced.
// 2026-06-25 — v3 字段格式把台词写成 角色（情绪）：“台词”（弯引号 U+201C/U+201D），
// 不是 「」。parser 必须同时吃两种，否则改格式后对白侦测归零 → R2V 又静音。
describe('v3 字段格式 “…” 弯引号对白', () => {
  it('countDialogueBeats counts the v3 “…” form', () => {
    expect(countDialogueBeats('【人物对应台词】曹古拉（恐惧）：“你为什么会有半神手段？”')).toBeGreaterThan(0)
  })

  it('extractRawDialogueBeats extracts speaker + content from 角色（情绪）：“…”', () => {
    const narrative = '【人物对应台词】曹古拉（歇斯底里、恐惧）：“你不过是个二十出头的愣头青”'
    expect(extractRawDialogueBeats(narrative, ['曹古拉', '王玄'])).toEqual([
      { speaker: '曹古拉', content: '你不过是个二十出头的愣头青' },
    ])
  })

  it('does NOT count “…” used for emphasis/quotation in ambient prose (no colon)', () => {
    // curly quotes are general Chinese quotation; only count them in 角色：“…” dialogue position
    expect(countDialogueBeats('被称为“绝世高手”的剑客缓缓转身')).toBe(0)
    expect(countDialogueBeats('画面必须包含“动”的元素')).toBe(0)
  })

  it('counts the colon-prefixed v3 dialogue form but not bare emphasis in the same string', () => {
    expect(countDialogueBeats('被称为“高手”的人；曹古拉（恐惧）：“你是谁”')).toBe(1)
  })

  it('extracts beats from a narrative mixing 「」 and “” styles', () => {
    const beats = extractRawDialogueBeats('王玄「走吧」\n曹古拉（恐惧）：“你是谁？”', ['王玄', '曹古拉'])
    expect(beats).toEqual([
      { speaker: '王玄', content: '走吧' },
      { speaker: '曹古拉', content: '你是谁？' },
    ])
  })

  it('still extracts the legacy 「」 form (back-compat)', () => {
    expect(extractRawDialogueBeats('王玄:「走吧」', ['王玄'])).toEqual([{ speaker: '王玄', content: '走吧' }])
  })

  it('does not treat the 【人物对应台词】 field label as a speaker (heuristic mode)', () => {
    // bare label + quote, no roster — label must be denylisted
    expect(extractRawDialogueBeats('人物对应台词：“无关内容”')).toEqual([])
  })
})

describe('extractRawDialogueBeats — R2V narrative dialogue → speech beats', () => {
  it('extracts on-camera dialogue with no colon (the reported bug case)', () => {
    const narrative =
      '镜头1：[开头]…环境音效：牙齿上下碰撞的微弱声。\n'
      + '沈冰雪「我警告你，乖乖陪我演完这场戏，否则你和王玄生的那个小野种，死！」\n'
      + '镜头2：急速推近…'
    const beats = extractRawDialogueBeats(narrative)
    expect(beats).toEqual([
      { speaker: '沈冰雪', content: '我警告你，乖乖陪我演完这场戏，否则你和王玄生的那个小野种，死！' },
    ])
  })

  it('extracts colon, fullwidth-colon and （声线：…） speaker forms', () => {
    expect(extractRawDialogueBeats('王玄:「走吧」')).toEqual([{ speaker: '王玄', content: '走吧' }])
    expect(extractRawDialogueBeats('王玄：「走吧」')).toEqual([{ speaker: '王玄', content: '走吧' }])
    expect(extractRawDialogueBeats('沈冰雪（声线：女性，冷冽）:「站住」')).toEqual([
      { speaker: '沈冰雪', content: '站住' },
    ])
  })

  it('does NOT treat structural labels or clause-tails before 「…」 as speakers', () => {
    expect(extractRawDialogueBeats('场景「豪森大酒店宴厅」')).toEqual([])
    expect(extractRawDialogueBeats('环境音效：远处「钟声」回响')).toEqual([])
    expect(extractRawDialogueBeats('他说的「天命」不可违')).toEqual([])
  })

  it('dedupes identical speaker+line and skips bare VO content lines', () => {
    const narrative = '王玄 声音(仅音频，无画面文字，嘴部不动)：\n「天命如此」\n王玄「天命如此」\n王玄「天命如此」'
    const beats = extractRawDialogueBeats(narrative)
    // bare 「天命如此」 (VO content, no speaker on its line) is skipped; the two
    // 王玄「天命如此」 collapse to one.
    expect(beats).toEqual([{ speaker: '王玄', content: '天命如此' }])
  })

  it('builds an explicit 说「…」 speech list the model can voice', () => {
    const block = buildSpeechDialogueBlock([
      { speaker: '沈冰雪', content: '我警告你' },
      { speaker: '王玄', content: '住手' },
    ])
    expect(block).toMatch(/配音/)
    expect(block).toContain('沈冰雪说「我警告你」')
    expect(block).toContain('王玄说「住手」')
    expect(block).toMatch(/僅朗讀一次|仅朗读一次/)
  })

  it('returns empty block for no beats (caller appends nothing)', () => {
    expect(buildSpeechDialogueBlock([])).toBe('')
    expect(extractRawDialogueBeats('洞府内，雾气缭绕，无人说话。')).toEqual([])
  })
})
